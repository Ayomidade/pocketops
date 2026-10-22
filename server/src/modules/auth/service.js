import {
  createHash,
  randomBytes,
} from "node:crypto";
import { AppError } from "../../errors/app-error.js";

const oauthStateTtlMs = 10 * 60 * 1000;
const handoffTtlMs = 2 * 60 * 1000;
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const oauthRetentionMs = 24 * 60 * 60 * 1000;
const sessionRetentionMs = 30 * 24 * 60 * 60 * 1000;
const githubAuthorizeUrl = "https://github.com/login/oauth/authorize";

export function hashCredential(value) {
  return createHash("sha256").update(value).digest("hex");
}

function randomCredential() {
  return randomBytes(32).toString("base64url");
}

function safeUser(user) {
  return {
    id: user.id,
    githubUserId: String(user.githubUserId),
    username: user.username,
    email: user.email || null,
    avatarUrl: user.avatarUrl || null,
  };
}

function safeSession(session) {
  return {
    id: session.id,
    expiresAt: session.expiresAt,
  };
}

function authError(status, code, message) {
  return new AppError(status, code, message);
}

export function createAuthService({
  repository,
  githubOAuthClient,
  config,
  clock = () => new Date(),
  credentialGenerator = randomCredential,
}) {
  function requireOAuthConfiguration() {
    if (
      !config.githubOAuthEnabled ||
      !config.githubOAuthClientId ||
      !config.githubOAuthClientSecret ||
      !config.githubOAuthCallbackUrl ||
      !config.mobileAuthRedirectUri ||
      !config.publicApiUrl
    ) {
      throw authError(
        503,
        "AUTH_NOT_CONFIGURED",
        "GitHub sign-in is not configured",
      );
    }
  }

  return {
    async createMobileStart({ redirectUri, completionSecret }) {
      requireOAuthConfiguration();
      if (redirectUri !== config.mobileAuthRedirectUri) {
        throw authError(400, "INVALID_REDIRECT_URI", "Invalid sign-in redirect");
      }

      const state = credentialGenerator();
      const now = clock();
      await repository.createOAuthTransaction({
        stateHash: hashCredential(state),
        completionSecretHash: hashCredential(completionSecret),
        redirectUri,
        expiresAt: new Date(now.getTime() + oauthStateTtlMs),
      });
      const startUrl = new URL("/api/v1/auth/github", config.publicApiUrl);
      startUrl.searchParams.set("state", state);
      return { authorizationUrl: startUrl.toString() };
    },

    async getAuthorizationUrl(state) {
      requireOAuthConfiguration();
      const now = clock();
      const transaction = await repository.findPendingOAuthTransaction(
        hashCredential(state),
        now,
      );
      if (!transaction) {
        throw authError(400, "INVALID_OAUTH_STATE", "Sign-in request expired");
      }

      const url = new URL(githubAuthorizeUrl);
      url.searchParams.set("client_id", config.githubOAuthClientId);
      url.searchParams.set("redirect_uri", config.githubOAuthCallbackUrl);
      url.searchParams.set("scope", "read:user");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async handleCallback({ state, code, providerError, requestId }) {
      requireOAuthConfiguration();
      if (!state || typeof state !== "string" || state.length > 128) {
        throw authError(400, "INVALID_OAUTH_STATE", "Sign-in request is invalid");
      }
      const now = clock();
      const transaction = await repository.consumeOAuthState(
        hashCredential(state),
        now,
        requestId,
      );
      if (!transaction) {
        throw authError(400, "INVALID_OAUTH_STATE", "Sign-in request expired");
      }

      if (providerError) {
        await repository.recordAuthEvent({
          action: "oauth_provider_denied",
          requestId,
        });
        return {
          redirectUrl: this.buildMobileRedirect(
            transaction.redirectUri,
            "access_denied",
          ),
        };
      }
      if (!code || typeof code !== "string" || code.length > 2048) {
        await repository.recordAuthEvent({
          action: "oauth_code_missing",
          requestId,
        });
        return {
          redirectUrl: this.buildMobileRedirect(
            transaction.redirectUri,
            "oauth_failed",
          ),
        };
      }

      let profile;
      try {
        profile = await githubOAuthClient.getIdentity(code);
      } catch {
        await repository.recordAuthEvent({
          action: "oauth_provider_failed",
          requestId,
        });
        return {
          redirectUrl: this.buildMobileRedirect(
            transaction.redirectUri,
            "github_unavailable",
          ),
        };
      }

      const handoff = credentialGenerator();
      const user = await repository.createHandoff({
        transactionId: transaction.id,
        profile,
        handoffHash: hashCredential(handoff),
        expiresAt: new Date(now.getTime() + handoffTtlMs),
        requestId,
      });
      if (!user) {
        throw authError(400, "INVALID_OAUTH_STATE", "Sign-in request expired");
      }

      const redirectUrl = new URL(transaction.redirectUri);
      redirectUrl.searchParams.set("handoff", handoff);
      return { redirectUrl: redirectUrl.toString() };
    },

    buildMobileRedirect(redirectUri, errorCode) {
      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.set("error", errorCode);
      return redirectUrl.toString();
    },

    async exchangeHandoff({
      handoffCode,
      completionSecret,
      deviceLabel,
      requestId,
    }) {
      const now = clock();
      const token = credentialGenerator();
      const result = await repository.exchangeHandoff({
        handoffHash: hashCredential(handoffCode),
        completionSecretHash: hashCredential(completionSecret),
        tokenHash: hashCredential(token),
        expiresAt: new Date(now.getTime() + sessionTtlMs),
        deviceLabel: deviceLabel || null,
        requestId,
        now,
      });
      if (!result) {
        throw authError(401, "INVALID_HANDOFF", "Sign-in could not be completed");
      }
      return {
        token,
        user: safeUser(result.user),
        session: safeSession(result.session),
      };
    },

    async authenticateToken(token) {
      const result = await repository.authenticateSession(
        hashCredential(token),
        clock(),
      );
      if (!result) {
        throw authError(401, "UNAUTHENTICATED", "A valid session is required");
      }
      return {
        user: safeUser(result.user),
        session: safeSession(result.session),
      };
    },

    async rotateSession({
      sessionId,
      replacementToken,
      requestId,
    }) {
      const now = clock();
      const result = await repository.rotateSession({
        currentSessionId: sessionId,
        tokenHash: hashCredential(replacementToken),
        expiresAt: new Date(now.getTime() + sessionTtlMs),
        requestId,
        now,
      });
      if (!result) {
        throw authError(401, "UNAUTHENTICATED", "A valid session is required");
      }
      return {
        user: safeUser(result.user),
        session: safeSession(result.session),
      };
    },

    async logout({ sessionId, userId, requestId }) {
      const revoked = await repository.revokeSession({
        sessionId,
        userId,
        requestId,
        now: clock(),
      });
      if (!revoked) {
        throw authError(401, "UNAUTHENTICATED", "A valid session is required");
      }
      return { loggedOut: true };
    },

    async cleanup() {
      const now = clock();
      return repository.cleanupExpired(
        new Date(now.getTime() - oauthRetentionMs),
        new Date(now.getTime() - sessionRetentionMs),
      );
    },
  };
}

import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors/app-error.js";
import { createGitHubOAuthClient } from "../src/modules/auth/github-oauth.js";
import {
  createAuthService,
  hashCredential,
} from "../src/modules/auth/service.js";

const config = {
  githubOAuthEnabled: true,
  githubOAuthClientId: "client-id",
  githubOAuthClientSecret: "server-secret",
  githubOAuthCallbackUrl:
    "https://api.example.test/api/v1/auth/github/callback",
  mobileAuthRedirectUri: "pocketops://auth/callback",
  publicApiUrl: "https://api.example.test",
};
const completionSecret = "c".repeat(64);
const user = {
  id: "user-uuid",
  githubUserId: "12345",
  username: "pocket-user",
  email: null,
  avatarUrl: null,
};

function createService(overrides = {}) {
  let transactionConsumed = false;
  const repository = {
    createOAuthTransaction: vi.fn(async (values) => values),
    recordAuthEvent: vi.fn(async () => undefined),
    findPendingOAuthTransaction: vi.fn(async () => ({ id: "oauth-id" })),
    consumeOAuthState: vi.fn(async (_hash, _now, requestId) => {
      if (transactionConsumed) return null;
      transactionConsumed = true;
      return {
        id: "oauth-id",
        redirectUri: config.mobileAuthRedirectUri,
        requestId,
      };
    }),
    createHandoff: vi.fn(async () => user),
    exchangeHandoff: vi.fn(async ({ tokenHash }) => ({
      session: {
        id: "session-id",
        tokenHash,
        expiresAt: new Date("2026-11-21T00:00:00Z"),
      },
      user,
    })),
    authenticateSession: vi.fn(async () => null),
    rotateSession: vi.fn(async ({ tokenHash }) => ({
      session: {
        id: "rotated-session",
        tokenHash,
        expiresAt: new Date("2026-11-21T00:00:00Z"),
      },
      user,
    })),
    revokeSession: vi.fn(async () => true),
    cleanupExpired: vi.fn(async () => ({ oauthTransactions: 1, sessions: 2 })),
    ...overrides.repository,
  };
  const credentials = ["s".repeat(43), "h".repeat(43), "t".repeat(43)];
  const service = createAuthService({
    repository,
    githubOAuthClient: {
      getIdentity: vi.fn(async () => ({
        id: "12345",
        login: "pocket-user",
        email: null,
        avatarUrl: null,
      })),
      ...overrides.githubOAuthClient,
    },
    config: { ...config, ...overrides.config },
    clock: () => new Date("2026-10-22T08:00:00Z"),
    credentialGenerator: () => credentials.shift() || "n".repeat(43),
  });
  return { service, repository, credentials };
}

describe("GitHub OAuth identity flow", () => {
  it("persists only hashes and binds startup to the configured native redirect", async () => {
    const { service, repository } = createService();
    const result = await service.createMobileStart({
      redirectUri: config.mobileAuthRedirectUri,
      completionSecret,
    });
    const authorizationUrl = new URL(result.authorizationUrl);

    expect(authorizationUrl.origin).toBe(config.publicApiUrl);
    expect(authorizationUrl.pathname).toBe("/api/v1/auth/github");
    expect(authorizationUrl.searchParams.get("state")).toHaveLength(43);
    expect(repository.createOAuthTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        stateHash: hashCredential("s".repeat(43)),
        completionSecretHash: hashCredential(completionSecret),
        redirectUri: config.mobileAuthRedirectUri,
        expiresAt: new Date("2026-10-22T08:10:00.000Z"),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(completionSecret);
  });

  it("rejects unregistered redirect targets", async () => {
    const { service } = createService();
    await expect(
      service.createMobileStart({
        redirectUri: "https://attacker.example/callback",
        completionSecret,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REDIRECT_URI", status: 400 });
  });

  it("uses backend authorization code flow with state and minimal identity scope", async () => {
    const { service } = createService();
    const result = await service.getAuthorizationUrl("s".repeat(43));
    const url = new URL(result);

    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("state")).toBe("s".repeat(43));
    expect(url.searchParams.get("scope")).toBe("read:user");
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("client_id")).toBe(config.githubOAuthClientId);
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("returns a one-time handoff and does not expose GitHub credentials", async () => {
    const { service, repository } = createService();
    await service.createMobileStart({
      redirectUri: config.mobileAuthRedirectUri,
      completionSecret,
    });
    const result = await service.handleCallback({
      state: "s".repeat(43),
      code: "github-one-time-code",
      requestId: "callback-1",
    });
    const redirect = new URL(result.redirectUrl);

    expect(redirect.protocol).toBe("pocketops:");
    expect(redirect.searchParams.get("handoff")).toHaveLength(43);
    expect(repository.createHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffHash: hashCredential("h".repeat(43)),
        profile: expect.objectContaining({ email: null }),
      }),
    );
    expect(result.redirectUrl).not.toContain("access_token");
    expect(result.redirectUrl).not.toContain("server-secret");
  });

  it("consumes denied and incomplete callbacks and rejects callback replay", async () => {
    const { service } = createService();
    const denied = await service.handleCallback({
      state: "s".repeat(43),
      providerError: "access_denied",
      requestId: "denied-1",
    });
    expect(new URL(denied.redirectUrl).searchParams.get("error")).toBe(
      "access_denied",
    );

    await expect(
      service.handleCallback({
        state: "s".repeat(43),
        code: "replayed-code",
        requestId: "replay-1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OAUTH_STATE", status: 400 });
  });

  it("rejects expired or mismatched state and records missing-code failures safely", async () => {
    const expired = createService({
      repository: {
        consumeOAuthState: vi.fn(async () => null),
      },
    });
    await expect(
      expired.service.handleCallback({
        state: "x".repeat(43),
        code: "github-code",
        requestId: "state-mismatch",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OAUTH_STATE", status: 400 });
    expect(expired.repository.consumeOAuthState).toHaveBeenCalledWith(
      hashCredential("x".repeat(43)),
      expect.any(Date),
      "state-mismatch",
    );

    const { service, repository } = createService();
    const start = await service.createMobileStart({
      redirectUri: config.mobileAuthRedirectUri,
      completionSecret,
    });
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    const result = await service.handleCallback({
      state,
      requestId: "missing-code",
    });
    expect(new URL(result.redirectUrl).searchParams.get("error")).toBe(
      "oauth_failed",
    );
    expect(repository.recordAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "oauth_code_missing" }),
    );
  });

  it("maps GitHub outages to a safe app callback", async () => {
    const { service } = createService({
      githubOAuthClient: {
        getIdentity: vi
          .fn()
          .mockRejectedValue(new Error("provider response contains secrets")),
      },
    });
    await service.createMobileStart({
      redirectUri: config.mobileAuthRedirectUri,
      completionSecret,
    });
    const result = await service.handleCallback({
      state: "s".repeat(43),
      code: "github-code",
      requestId: "outage-1",
    });
    expect(new URL(result.redirectUrl).searchParams.get("error")).toBe(
      "github_unavailable",
    );
    expect(result.redirectUrl).not.toContain("provider response");
  });

  it("exchanges a bound handoff for an opaque session and hashes it at rest", async () => {
    const { service, repository } = createService();
    await service.createMobileStart({
      redirectUri: config.mobileAuthRedirectUri,
      completionSecret,
    });
    await service.handleCallback({
      state: "s".repeat(43),
      code: "github-code",
      requestId: "callback-before-exchange",
    });
    const result = await service.exchangeHandoff({
      handoffCode: "h".repeat(43),
      completionSecret,
      deviceLabel: "PocketOps mobile",
      requestId: "exchange-1",
    });

    expect(result.token).toBe("t".repeat(43));
    expect(result.user.email).toBeNull();
    expect(result.session.id).toBe("session-id");
    expect(JSON.stringify(result)).not.toContain("github-access-token");
    expect(repository.exchangeHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffHash: hashCredential("h".repeat(43)),
        completionSecretHash: hashCredential(completionSecret),
        tokenHash: hashCredential(result.token),
      }),
    );
    expect(repository.exchangeHandoff.mock.calls[0][0].tokenHash).not.toBe(
      result.token,
    );
  });

  it("returns only safe errors for invalid, expired, or replayed credentials", async () => {
    const { service } = createService({
      repository: {
        exchangeHandoff: vi.fn(async () => null),
        authenticateSession: vi.fn(async () => null),
      },
    });
    await expect(
      service.exchangeHandoff({
        handoffCode: "h".repeat(43),
        completionSecret,
        requestId: "bad-exchange",
      }),
    ).rejects.toMatchObject({ code: "INVALID_HANDOFF", status: 401 });
    await expect(
      service.authenticateToken("x".repeat(43)),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("rotates using a client-persistable replacement without returning a second token", async () => {
    const { service, repository } = createService();
    const replacementToken = "a".repeat(64);
    const result = await service.rotateSession({
      sessionId: "session-id",
      userId: user.id,
      replacementToken,
      requestId: "rotate-1",
    });

    expect(result).not.toHaveProperty("token");
    expect(repository.rotateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: hashCredential(replacementToken),
      }),
    );
    expect(repository.revokeSession).not.toHaveBeenCalled();
  });

  it("runs bounded retention cleanup through the repository", async () => {
    const { service, repository } = createService();
    expect(await service.cleanup()).toEqual({
      oauthTransactions: 1,
      sessions: 2,
    });
    expect(repository.cleanupExpired).toHaveBeenCalledWith(
      new Date("2026-10-21T08:00:00.000Z"),
      new Date("2026-09-22T08:00:00.000Z"),
    );
  });
});

describe("GitHub OAuth adapter", () => {
  it("exchanges codes and reads identity server-side without returning provider tokens", async () => {
    const requests = [];
    const fetchImplementation = vi.fn(async (url, options) => {
      requests.push({ url, options });
      if (String(url).includes("/login/oauth/access_token")) {
        return new Response(
          JSON.stringify({ access_token: "github-private-token" }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          id: 456,
          login: "mobile-user",
          email: null,
          avatar_url: "https://avatars.example/456.png",
        }),
        { status: 200 },
      );
    });
    const client = createGitHubOAuthClient({
      clientId: "client-id",
      clientSecret: "server-secret",
      callbackUrl: config.githubOAuthCallbackUrl,
      fetchImplementation,
    });

    const profile = await client.getIdentity("one-time-code", { codeVerifier: "v".repeat(43) });
    expect(profile).toEqual({
      id: "456",
      login: "mobile-user",
      email: null,
      avatarUrl: "https://avatars.example/456.png",
    });
    expect(requests).toHaveLength(2);
    expect(requests[0].options.body).toContain("server-secret");
    expect(JSON.parse(requests[0].options.body).code_verifier).toBe("v".repeat(43));
    expect(requests[0].options.redirect).toBe("error");
    expect(requests[1].options.headers.Authorization).toBe(
      "Bearer github-private-token",
    );
    expect(JSON.stringify(profile)).not.toContain("github-private-token");
  });

  it("sanitizes provider failures", async () => {
    const client = createGitHubOAuthClient({
      clientId: "client-id",
      clientSecret: "server-secret",
      callbackUrl: config.githubOAuthCallbackUrl,
      fetchImplementation: vi
        .fn()
        .mockRejectedValue(new Error("provider leaked its private body")),
    });
    await expect(client.getIdentity("code")).rejects.toBeInstanceOf(AppError);
    await expect(client.getIdentity("code")).rejects.toMatchObject({
      code: "GITHUB_AUTH_UNAVAILABLE",
      status: 502,
    });
  });
});

it("binds the authorization challenge to the matching server-only S256 verifier", async () => {
  const getIdentity = vi.fn(async () => ({ id: "12345", login: "pocket-user" }));
  const { service } = createService({ githubOAuthClient: { getIdentity } });
  const state = "s".repeat(43);
  const authorize = new URL(await service.getAuthorizationUrl(state));
  await service.handleCallback({ state, code: "one-time-code", requestId: "pkce-fixture" });
  const { codeVerifier } = getIdentity.mock.calls[0][1];
  const { createHash } = await import("node:crypto");
  expect(createHash("sha256").update(codeVerifier).digest("base64url")).toBe(authorize.searchParams.get("code_challenge"));
  expect(codeVerifier).toHaveLength(43); expect(authorize.toString()).not.toContain(codeVerifier); expect(codeVerifier).not.toContain(config.githubOAuthClientSecret);
});

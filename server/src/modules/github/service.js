import { oauthPkce } from "../auth/pkce.js";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { AppError } from "../../errors/app-error.js";
import { decryptToken, encryptToken } from "./crypto.js";

const installationLinkTtlMs = 15 * 60_000;
const tokenRefreshMarginMs = 60_000;
const maximumFileBytes = 512 * 1024;
const gitShaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const supportedWebhookEvents = new Set([
  "installation",
  "installation_repositories",
  "github_app_authorization",
]);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeInstallation(installation) {
  return {
    id: installation.id,
    githubInstallationId: String(installation.githubInstallationId),
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    repositorySelection: installation.repositorySelection,
    suspended: Boolean(installation.suspendedAt),
    lastSyncedAt: installation.lastSyncedAt,
  };
}

function safeRepository(repository, selected = false) {
  return {
    id: repository.id,
    githubRepositoryId: String(repository.githubRepositoryId),
    owner: repository.ownerLogin,
    name: repository.name,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    private: repository.isPrivate,
    archived: repository.isArchived,
    selected,
  };
}

function mapRepositoryResponse(repository) {
  return {
    id: String(repository.id),
    ownerId: String(repository.ownerId),
    owner: repository.owner,
    name: repository.name,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    isPrivate: repository.isPrivate,
    isArchived: repository.isArchived,
  };
}

function safeProviderAccount(installation) {
  if (
    !installation ||
    !/^\d+$/.test(String(installation.id)) ||
    !/^\d+$/.test(String(installation.accountId)) ||
    !["User", "Organization", "Enterprise"].includes(
      installation.accountType,
    ) ||
    typeof installation.accountLogin !== "string"
  ) {
    throw new AppError(
      502,
      "GITHUB_INVALID_RESPONSE",
      "GitHub returned invalid installation details",
    );
  }
}

function decodePath(path, allowRoot = false) {
  if (typeof path !== "string" || path.length > 1024) {
    throw new AppError(
      422,
      "INVALID_REPOSITORY_PATH",
      "Repository path is invalid",
    );
  }
  if (allowRoot && path === "") return "";
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    [...path].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    }) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new AppError(
      422,
      "INVALID_REPOSITORY_PATH",
      "Repository path is invalid",
    );
  }
  return path;
}

function validGitRef(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    ![...value].some((character) => character.codePointAt(0) <= 32 || character.codePointAt(0) === 127) &&
    !/[~^:?*\x5b\\]/.test(value) &&
    value
      .split("/")
      .every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"))
  );
}

function decodeCursor(cursor, kind, resourceId, key) {
  if (!cursor) return 1;
  try {
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra !== undefined)
      throw new Error("invalid cursor");
    const expected = createHmac("sha256", key).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new Error("invalid cursor");
    }
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      value.kind !== kind ||
      value.resourceId !== resourceId ||
      !Number.isInteger(value.page) ||
      value.page < 1 ||
      value.page > 100
    ) {
      throw new Error("invalid cursor");
    }
    return value.page;
  } catch {
    throw new AppError(422, "INVALID_CURSOR", "Pagination cursor is invalid");
  }
}

function encodeCursor(kind, resourceId, page, key) {
  if (!page) return null;
  const payload = Buffer.from(
    JSON.stringify({ kind, resourceId, page }),
  ).toString("base64url");
  const signature = createHmac("sha256", key)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function normalizeWebhookPayload(eventType, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(
      400,
      "INVALID_WEBHOOK_PAYLOAD",
      "GitHub webhook payload is invalid",
    );
  }
  const installationId = body.installation?.id;
  const changedRepositories =
    body.repositories ||
    body.repositories_added ||
    body.repositories_removed ||
    [];
  if (!Array.isArray(changedRepositories) || changedRepositories.length > 100) {
    throw new AppError(
      400,
      "INVALID_WEBHOOK_PAYLOAD",
      "GitHub webhook payload is invalid",
    );
  }
  const normalizedChangedRepositories = changedRepositories.map((repo) => {
    if (
      !repo ||
      !/^\d+$/.test(String(repo.id)) ||
      !/^\d+$/.test(String(repo.owner?.id)) ||
      typeof repo.owner?.login !== "string" ||
      typeof repo.name !== "string" ||
      typeof repo.full_name !== "string"
    ) {
      throw new AppError(
        400,
        "INVALID_WEBHOOK_PAYLOAD",
        "GitHub webhook payload is invalid",
      );
    }
    return {
      id: String(repo.id),
      ownerId: String(repo.owner.id),
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch:
        typeof repo.default_branch === "string" ? repo.default_branch : null,
      isPrivate: Boolean(repo.private),
      isArchived: Boolean(repo.archived),
    };
  });
  const payload = {
    action: typeof body.action === "string" ? body.action.slice(0, 80) : null,
    installationId: /^\d+$/.test(String(installationId))
      ? String(installationId)
      : null,
    senderId: /^\d+$/.test(String(body.sender?.id))
      ? String(body.sender.id)
      : null,
    repositories: normalizedChangedRepositories,
    repositoryIds: normalizedChangedRepositories.map((repo) => repo.id),
    account: body.installation?.account
      ? {
          id: String(body.installation.account.id),
          login: String(body.installation.account.login),
          type: String(body.installation.account.type),
        }
      : null,
    permissions: body.installation?.permissions || {},
    repositorySelection: body.installation?.repository_selection || "selected",
    suspendedAt: body.installation?.suspended_at || null,
  };
  if (eventType !== "github_app_authorization" && !payload.installationId) {
    throw new AppError(
      400,
      "INVALID_WEBHOOK_PAYLOAD",
      "GitHub webhook payload is invalid",
    );
  }
  return payload;
}

export function verifyGitHubWebhookSignature(rawBody, signature, secret) {
  if (
    !Buffer.isBuffer(rawBody) ||
    !/^sha256=[a-f0-9]{64}$/i.test(signature || "")
  ) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(signature.slice(7), "hex");
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export function createGitHubService({
  repository,
  adapter,
  config,
  clock = () => new Date(),
  credentialGenerator = () => randomBytes(32).toString("base64url"),
}) {
  function requireConfiguration() {
    if (!config.githubAppEnabled) {
      throw new AppError(
        503,
        "GITHUB_APP_NOT_CONFIGURED",
        "GitHub App integration is not configured",
      );
    }
  }

  function seal(token) {
    return encryptToken(token, config.githubTokenEncryptionKey);
  }

  function open(token) {
    return decryptToken(token, config.githubTokenEncryptionKey);
  }

  async function getMembershipAccessToken(membership, requestId) {
    if (
      membership.installation.removedAt ||
      membership.installation.suspendedAt
    ) {
      throw new AppError(
        404,
        "RESOURCE_NOT_FOUND",
        "GitHub installation was not found",
      );
    }
    try {
      return await repository.withMembershipLock(
        membership.id,
        async (locked, saveTokens) => {
          if (locked.status !== "active") {
            throw new AppError(
              404,
              "RESOURCE_NOT_FOUND",
              "GitHub installation was not found",
            );
          }
          let accessToken = open(locked.githubUserTokenEncrypted);
          if (
            locked.accessTokenExpiresAt.getTime() <=
            clock().getTime() + tokenRefreshMarginMs
          ) {
            if (locked.refreshTokenExpiresAt.getTime() <= clock().getTime()) {
              throw new AppError(
                401,
                "GITHUB_AUTH_REVOKED",
                "Reconnect this GitHub account",
              );
            }
            const refreshed = await adapter.refreshUserToken(
              open(locked.githubRefreshTokenEncrypted),
            );
            await saveTokens({
              githubUserTokenEncrypted: seal(refreshed.accessToken),
              githubRefreshTokenEncrypted: seal(refreshed.refreshToken),
              accessTokenExpiresAt: refreshed.accessExpiresAt,
              refreshTokenExpiresAt: refreshed.refreshExpiresAt,
              lastVerifiedAt: clock(),
            });
            accessToken = refreshed.accessToken;
          }
          return accessToken;
        },
      );
    } catch (error) {
      if (error.status === 401) {
        await repository.revokeMembership(
          membership.id,
          membership.userId,
          requestId,
          clock(),
          "provider_authorization_revoked",
        );
      }
      throw error;
    }
  }

  async function currentInstallationAccess(membership, requestId) {
    const accessToken = await getMembershipAccessToken(membership, requestId);
    let userInstallations;
    try {
      userInstallations = await adapter.getUserInstallations(accessToken);
    } catch (error) {
      if (error.status === 401) {
        await repository.revokeMembership(
          membership.id,
          membership.userId,
          requestId,
          clock(),
          "provider_authorization_revoked",
        );
      }
      throw error;
    }
    const providerInstallation = userInstallations.find(
      (item) =>
        item.id === String(membership.installation.githubInstallationId),
    );
    if (!providerInstallation) {
      await repository.revokeMembership(
        membership.id,
        membership.userId,
        requestId,
        clock(),
        "user_no_longer_authorized",
      );
      throw new AppError(
        404,
        "RESOURCE_NOT_FOUND",
        "GitHub installation was not found",
      );
    }
    let userRepositories;
    let appRepositories;
    try {
      [userRepositories, appRepositories] = await Promise.all([
        adapter.getInstallationRepositories(
          accessToken,
          membership.installation.githubInstallationId,
        ),
        adapter.getAppInstallationRepositories(
          membership.installation.githubInstallationId,
        ),
      ]);
    } catch (error) {
      if ([401, 403, 404].includes(error.status)) {
        if (error.status === 401) {
          await repository.revokeMembership(
            membership.id,
            membership.userId,
            requestId,
            clock(),
            "provider_authorization_revoked",
          );
        }
        throw new AppError(
          404,
          "RESOURCE_NOT_FOUND",
          "GitHub installation was not found",
        );
      }
      throw error;
    }
    const appRepoIds = new Set(appRepositories.map((repo) => repo.id));
    const intersection = userRepositories
      .filter((repo) => appRepoIds.has(repo.id))
      .map(mapRepositoryResponse);
    const reposById = new Map(intersection.map((repo) => [repo.id, repo]));
    await repository.syncRepositoryCatalog(
      membership.installationId,
      appRepositories,
      clock(),
    );
    return {
      accessToken,
      installation: providerInstallation,
      repositories: intersection,
      reposById,
    };
  }

  async function authorizedRepository(userId, repositoryId, requestId) {
    const selection = await repository.getSelectedRepository(
      userId,
      repositoryId,
    );
    if (!selection) {
      throw new AppError(404, "RESOURCE_NOT_FOUND", "Repository was not found");
    }
    const linked = selection.repository;
    const membership = await repository.getMembership(
      userId,
      linked.installationId,
    );
    if (!membership) {
      throw new AppError(404, "RESOURCE_NOT_FOUND", "Repository was not found");
    }
    const access = await currentInstallationAccess(membership, requestId);
    const repo = access.reposById.get(String(linked.githubRepositoryId));
    if (!repo) {
      throw new AppError(404, "RESOURCE_NOT_FOUND", "Repository was not found");
    }
    return { linked, repo, membership, access };
  }

  async function editorRepositoryContext({
    userId,
    repositoryId,
    requestId,
    permission,
    write = false,
  }) {
    const context = await authorizedRepository(userId, repositoryId, requestId);
    if (context.linked.isArchived || context.repo.isArchived) {
      throw new AppError(
        409,
        "REPOSITORY_ARCHIVED",
        "Archived repositories cannot be changed.",
      );
    }
    if (permission) {
      const granted = context.access.installation.permissions?.[permission];
      const level = typeof granted === "string" ? granted : granted?.access;
      if (write ? level !== "write" : !["read", "write"].includes(level)) {
        throw new AppError(
          403,
          "GITHUB_PERMISSION_DENIED",
          "The GitHub App does not have the required repository permission.",
        );
      }
    }
    return context;
  }

  async function editorProviderBranch(context, branch) {
    return adapter.getBranch(
      context.membership.installation.githubInstallationId,
      context.repo.owner,
      context.repo.name,
      branch,
    );
  }

  async function mobileRedirect(status) {
    const redirect = new URL(config.githubAppMobileRedirectUri);
    redirect.searchParams.set("status", status);
    return redirect.toString();
  }

  function callbackFailureRedirect(error) {
    return mobileRedirect(
      error.code === "GITHUB_AUTH_CANCELLED" ? "cancelled" : "failed",
    );
  }

  async function handleOAuthCallback({ state, code, providerError }) {
    requireConfiguration();
    if (!state || state.length > 128) {
      throw new AppError(
        400,
        "INVALID_GITHUB_STATE",
        "GitHub connection request is invalid",
      );
    }
    const now = clock();
    const link = await repository.findLinkByState(hash(state), now);
    if (!link) {
      throw new AppError(
        400,
        "INVALID_GITHUB_STATE",
        "GitHub connection request expired",
      );
    }
    if (providerError) {
      await repository.consumeDeniedLink(link.id, now);
      throw new AppError(
        400,
        providerError === "access_denied" ? "GITHUB_AUTH_CANCELLED" : "GITHUB_AUTH_FAILED",
        "GitHub connection was not authorized",
      );
    }
    if (!code || code.length > 2048) {
      await repository.consumeDeniedLink(link.id, now);
      throw new AppError(
        400,
        "INVALID_GITHUB_CODE",
        "GitHub authorization could not be completed",
      );
    }
    const tokens = await adapter.exchangeUserCode(code, { codeVerifier: oauthPkce(state, config.githubAppClientSecret, "github-app").verifier });
    const identity = await adapter.getAuthenticatedUser(tokens.accessToken);
    if (String(identity.id) !== String(link.githubUserId)) {
      await repository.consumeDeniedLink(link.id, now);
      throw new AppError(
        403,
        "GITHUB_ACCOUNT_MISMATCH",
        "Authorize with the GitHub account signed into PocketOps",
      );
    }
    const installState = credentialGenerator();
    const saved = await repository.authorizeLink({
      linkId: link.id,
      installStateHash: hash(installState),
      accessTokenEncrypted: seal(tokens.accessToken),
      refreshTokenEncrypted: seal(tokens.refreshToken),
      accessTokenExpiresAt: tokens.accessExpiresAt,
      refreshTokenExpiresAt: tokens.refreshExpiresAt,
      now,
    });
    if (!saved) {
      throw new AppError(
        400,
        "INVALID_GITHUB_STATE",
        "GitHub connection request was already used",
      );
    }
    const installationUrl = new URL(
      `/apps/${config.githubAppSlug}/installations/new`,
      "https://github.com",
    );
    installationUrl.searchParams.set("state", installState);
    return installationUrl.toString();
  }

  async function handleInstallationCallback({
    state,
    installationId,
    setupAction,
    requestId,
  }) {
    requireConfiguration();
    if (
      !state ||
      state.length > 128 ||
      !/^\d+$/.test(String(installationId)) ||
      !["install", "update"].includes(setupAction)
    ) {
      throw new AppError(
        400,
        "INVALID_INSTALLATION_CALLBACK",
        "GitHub installation callback is invalid",
      );
    }
    const now = clock();
    const link = await repository.claimInstallationCallback(hash(state), now);
    if (!link) {
      throw new AppError(
        400,
        "INVALID_INSTALLATION_STATE",
        "GitHub installation request expired",
      );
    }
    if (link.refreshTokenExpiresAt <= now) {
      throw new AppError(
        401,
        "GITHUB_AUTH_REVOKED",
        "Restart GitHub connection",
      );
    }
    let accessToken = open(link.accessTokenEncrypted);
    if (
      link.accessTokenExpiresAt <=
      new Date(now.getTime() + tokenRefreshMarginMs)
    ) {
      const refreshed = await adapter.refreshUserToken(
        open(link.refreshTokenEncrypted),
      );
      accessToken = refreshed.accessToken;
      await repository.updateLinkTokens(link.id, {
        accessTokenEncrypted: seal(refreshed.accessToken),
        refreshTokenEncrypted: seal(refreshed.refreshToken),
        accessTokenExpiresAt: refreshed.accessExpiresAt,
        refreshTokenExpiresAt: refreshed.refreshExpiresAt,
      });
      link.accessTokenEncrypted = seal(refreshed.accessToken);
      link.refreshTokenEncrypted = seal(refreshed.refreshToken);
      link.accessTokenExpiresAt = refreshed.accessExpiresAt;
      link.refreshTokenExpiresAt = refreshed.refreshExpiresAt;
    }
    const providerInstallations =
      await adapter.getUserInstallations(accessToken);
    const providerInstallation = providerInstallations.find(
      (item) => item.id === String(installationId),
    );
    if (!providerInstallation || providerInstallation.suspendedAt) {
      throw new AppError(
        403,
        "GITHUB_INSTALLATION_NOT_AUTHORIZED",
        "GitHub did not authorize this installation for the signed-in account",
      );
    }
    safeProviderAccount(providerInstallation);
    const appRepositories =
      await adapter.getAppInstallationRepositories(installationId);
    const completed = await repository.completeInstallation({
      linkId: link.id,
      githubInstallationId: String(installationId),
      installation: providerInstallation,
      repositories: appRepositories,
      now,
      requestId,
    });
    if (!completed) {
      throw new AppError(
        400,
        "INVALID_INSTALLATION_STATE",
        "GitHub installation request was already used",
      );
    }
    return mobileRedirect("connected");
  }

  return {
    async startInstallation({ user }) {
      requireConfiguration();
      const state = credentialGenerator();
      await repository.createLink({
        stateHash: hash(state),
        userId: user.id,
        githubUserId: String(user.githubUserId),
        expiresAt: new Date(clock().getTime() + installationLinkTtlMs),
        createdAt: clock(),
      });
      const authorizationUrl = new URL(
        "https://github.com/login/oauth/authorize",
      );
      authorizationUrl.searchParams.set("client_id", config.githubAppClientId);
      authorizationUrl.searchParams.set(
        "redirect_uri",
        config.githubAppOAuthCallbackUrl,
      );
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("code_challenge", oauthPkce(state, config.githubAppClientSecret, "github-app").challenge);
      authorizationUrl.searchParams.set("scope", "offline_access");
      return { authorizationUrl: authorizationUrl.toString() };
    },

    handleOAuthCallback,
    handleInstallationCallback,

    async listInstallations({ userId, requestId }) {
      requireConfiguration();
      const memberships = await repository.listMemberships(userId);
      const result = [];
      for (const membership of memberships) {
        try {
          const access = await currentInstallationAccess(membership, requestId);
          result.push({
            ...safeInstallation(membership.installation),
            repositoryCount: access.repositories.length,
            selectedRepositoryCount: (
              await repository.listRepositories(
                userId,
                membership.installationId,
              )
            ).length,
          });
        } catch (error) {
          if (error.status === 401 || error.status === 404) continue;
          throw error;
        }
      }
      return result;
    },

    async listInstallationRepositories({ userId, installationId, requestId }) {
      requireConfiguration();
      const membership = await repository.getMembership(userId, installationId);
      if (!membership) {
        throw new AppError(
          404,
          "RESOURCE_NOT_FOUND",
          "GitHub installation was not found",
        );
      }
      const access = await currentInstallationAccess(membership, requestId);
      const selections = await repository.listRepositories(
        userId,
        installationId,
      );
      const selectedIds = new Set(
        selections.map((item) => item.repository.githubRepositoryId),
      );
      return access.repositories.map((repo) => {
        const local = selections.find(
          (item) => item.repository.githubRepositoryId === repo.id,
        )?.repository;
        return local
          ? safeRepository(local, selectedIds.has(repo.id))
          : {
              id: null,
              githubRepositoryId: repo.id,
              owner: repo.owner,
              name: repo.name,
              fullName: repo.fullName,
              defaultBranch: repo.defaultBranch,
              private: repo.isPrivate,
              archived: repo.isArchived,
              selected: false,
            };
      });
    },

    async syncInstallationRepositories({
      userId,
      installationId,
      githubRepositoryIds,
      requestId,
    }) {
      requireConfiguration();
      const membership = await repository.getMembership(userId, installationId);
      if (!membership) {
        throw new AppError(
          404,
          "RESOURCE_NOT_FOUND",
          "GitHub installation was not found",
        );
      }
      const access = await currentInstallationAccess(membership, requestId);
      const authorizedIds = new Set(access.repositories.map((repo) => repo.id));
      if (githubRepositoryIds.some((id) => !authorizedIds.has(id))) {
        throw new AppError(
          404,
          "RESOURCE_NOT_FOUND",
          "One or more repositories are not currently authorized",
        );
      }
      const selected = await repository.replaceSelections(
        userId,
        installationId,
        githubRepositoryIds,
        requestId,
        clock(),
      );
      if (!selected) {
        throw new AppError(
          404,
          "RESOURCE_NOT_FOUND",
          "One or more repositories are not currently authorized",
        );
      }
      return selected;
    },

    async listRepositories({ userId, cursor, limit, search, requestId }) {
      requireConfiguration();
      const page = decodeCursor(
        cursor,
        "repositories",
        userId,
        config.githubTokenEncryptionKey,
      );
      const selected = await repository.listRepositories(userId);
      const byInstallation = new Map();
      for (const item of selected) {
        const id = item.repository.installationId;
        if (!byInstallation.has(id))
          byInstallation.set(id, item.repository.installation);
      }
      const currentIds = new Set();
      for (const [installationId] of byInstallation) {
        const membership = await repository.getMembership(
          userId,
          installationId,
        );
        if (!membership) continue;
        try {
          const access = await currentInstallationAccess(membership, requestId);
          for (const id of access.reposById.keys()) currentIds.add(id);
        } catch (error) {
          if (error.status !== 401 && error.status !== 404) throw error;
        }
      }
      const records = selected
        .filter((item) =>
          currentIds.has(String(item.repository.githubRepositoryId)),
        )
        .map((item) => safeRepository(item.repository, true))
        .filter(
          (repo) =>
            !search ||
            repo.fullName.toLowerCase().includes(search.toLowerCase()),
        );
      const start = (page - 1) * limit;
      return {
        data: records.slice(start, start + limit),
        nextCursor:
          start + limit < records.length
            ? encodeCursor(
                "repositories",
                userId,
                page + 1,
                config.githubTokenEncryptionKey,
              )
            : null,
      };
    },

    async getRepository({ userId, repositoryId, requestId }) {
      requireConfiguration();
      const { repo, membership } = await authorizedRepository(
        userId,
        repositoryId,
        requestId,
      );
      const providerRepo = await adapter.getRepository(
        membership.installation.githubInstallationId,
        repo.owner,
        repo.name,
      );
      return {
        id: repositoryId,
        githubRepositoryId: repo.id,
        owner: providerRepo.owner.login,
        name: providerRepo.name,
        fullName: providerRepo.full_name,
        description: providerRepo.description || null,
        defaultBranch: providerRepo.default_branch || null,
        private: Boolean(providerRepo.private),
        archived: Boolean(providerRepo.archived),
        htmlUrl: providerRepo.html_url,
      };
    },

    async listTree({
      userId,
      repositoryId,
      path = "",
      ref,
      cursor,
      requestId,
    }) {
      requireConfiguration();
      const safePath = decodePath(path, true);
      if (cursor) {
        throw new AppError(
          422,
          "DIRECTORY_CURSOR_UNSUPPORTED",
          "Directory listings are limited to 1000 entries and do not support pagination",
        );
      }
      const { linked, repo, membership } = await authorizedRepository(
        userId,
        repositoryId,
        requestId,
      );
      const result = await adapter.listDirectory(
        membership.installation.githubInstallationId,
        repo.owner,
        repo.name,
        safePath,
        ref || linked.defaultBranch,
      );
      return {
        data: result.entries,
        nextCursor: null,
        directoryLimitReached: Boolean(result.directoryLimitReached),
      };
    },

    async getFile({ userId, repositoryId, path, ref, requestId }) {
      requireConfiguration();
      const safePath = decodePath(path);
      const { linked, repo, membership } = await authorizedRepository(
        userId,
        repositoryId,
        requestId,
      );
      const file = await adapter.getFile(
        membership.installation.githubInstallationId,
        repo.owner,
        repo.name,
        safePath,
        ref || linked.defaultBranch,
      );
      if (!Number.isSafeInteger(file.size) || file.size < 0) {
        throw new AppError(
          502,
          "GITHUB_INVALID_RESPONSE",
          "GitHub returned invalid file metadata",
        );
      }
      if (file.size > maximumFileBytes) {
        throw new AppError(
          413,
          "FILE_TOO_LARGE",
          "Files larger than 512 KiB cannot be previewed",
        );
      }
      const encoded = String(file.content || "").replace(/\s/g, "");
      if (encoded.length > Math.ceil(maximumFileBytes / 3) * 4) {
        throw new AppError(
          413,
          "FILE_TOO_LARGE",
          "Files larger than 512 KiB cannot be previewed",
        );
      }
      if (
        file.encoding !== "base64" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          encoded,
        )
      ) {
        return {
          path: file.path,
          ref: ref || linked.defaultBranch,
          sha: file.sha,
          size: file.size,
          encoding: "binary",
          content: null,
          editable: false,
        };
      }
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length !== file.size || bytes.length > maximumFileBytes) {
        throw new AppError(
          502,
          "GITHUB_INVALID_RESPONSE",
          "GitHub returned inconsistent file content",
        );
      }
      const decodedContent = bytes.toString("utf8");
      const isUtf8 =
        !bytes.includes(0) && Buffer.from(decodedContent, "utf8").equals(bytes);
      const encoding = isUtf8 ? "utf-8" : "binary";
      return {
        path: file.path,
        ref: ref || linked.defaultBranch,
        sha: file.sha,
        size: file.size,
        encoding,
        content: isUtf8 ? decodedContent : null,
        editable: encoding === "utf-8",
      };
    },

    async listBranches({ userId, repositoryId, cursor, requestId }) {
      requireConfiguration();
      const { repo, membership } = await authorizedRepository(
        userId,
        repositoryId,
        requestId,
      );
      const page = decodeCursor(
        cursor,
        "branches",
        repositoryId,
        config.githubTokenEncryptionKey,
      );
      const result = await adapter.listBranches(
        membership.installation.githubInstallationId,
        repo.owner,
        repo.name,
        page,
      );
      return {
        data: result.branches,
        nextCursor: encodeCursor(
          "branches",
          repositoryId,
          result.nextPage,
          config.githubTokenEncryptionKey,
        ),
      };
    },

    async getEditorBranch({ userId, repositoryId, branch, requestId }) {
      if (!validGitRef(branch)) {
        throw new AppError(422, "INVALID_GIT_REF", "Branch name is invalid.");
      }
      const context = await editorRepositoryContext({
        userId,
        repositoryId,
        requestId,
        permission: "contents",
      });
      return editorProviderBranch(context, branch);
    },

    async createFixBranch({
      userId,
      repositoryId,
      branch,
      baseBranch,
      baseSha,
      requestId,
    }) {
      if (
        !validGitRef(branch) ||
        !validGitRef(baseBranch) ||
        !gitShaPattern.test(baseSha) ||
        branch === baseBranch
      ) {
        throw new AppError(422, "INVALID_GIT_REF", "Branch details are invalid.");
      }
      const context = await editorRepositoryContext({
        userId,
        repositoryId,
        requestId,
        permission: "contents",
        write: true,
      });
      if (branch === context.repo.defaultBranch) {
        throw new AppError(
          422,
          "PRODUCTION_BRANCH_WRITE_BLOCKED",
          "Create a new fix branch instead of using the repository default branch.",
        );
      }
      const base = await editorProviderBranch(context, baseBranch);
      if (base.commitSha !== baseSha) {
        throw new AppError(
          409,
          "BASE_VERSION_CONFLICT",
          "The base branch moved. Refresh branch details before creating a fix branch.",
        );
      }
      const created = await adapter.createBranch(
        context.membership.installation.githubInstallationId,
        context.repo.owner,
        context.repo.name,
        branch,
        baseSha,
      );
      return { branch, baseBranch, baseSha, commitSha: created.sha };
    },

    async commitFixFile({
      userId,
      repositoryId,
      branch,
      path,
      content,
      expectedSha,
      commitMessage,
      requestId,
    }) {
      if (
        !validGitRef(branch) ||
        !gitShaPattern.test(expectedSha) ||
        Buffer.byteLength(content, "utf8") > maximumFileBytes
      ) {
        throw new AppError(422, "INVALID_FILE_CHANGE", "File change is invalid.");
      }
      const safePath = decodePath(path);
      const context = await editorRepositoryContext({
        userId,
        repositoryId,
        requestId,
        permission: "contents",
        write: true,
      });
      if (branch === context.repo.defaultBranch) {
        throw new AppError(
          403,
          "PRODUCTION_BRANCH_WRITE_BLOCKED",
          "PocketOps can only commit to a fix branch.",
        );
      }
      const target = await editorProviderBranch(context, branch);
      if (target.protected) {
        throw new AppError(
          403,
          "PROTECTED_BRANCH_WRITE_BLOCKED",
          "GitHub protects this branch. Choose an unprotected fix branch.",
        );
      }
      const current = await adapter.getFile(
        context.membership.installation.githubInstallationId,
        context.repo.owner,
        context.repo.name,
        safePath,
        branch,
      );
      if (
        current.sha !== expectedSha ||
        current.size > maximumFileBytes ||
        current.encoding !== "base64"
      ) {
        throw new AppError(
          current.sha !== expectedSha ? 409 : 422,
          current.sha !== expectedSha
            ? "FILE_VERSION_CONFLICT"
            : "FILE_NOT_EDITABLE",
          current.sha !== expectedSha
            ? "The file changed after it was opened. Reload it before saving."
            : "Only existing UTF-8 text files up to 512 KiB can be edited.",
        );
      }
      const currentBytes = Buffer.from(
        String(current.content || "").replace(/\s/g, ""),
        "base64",
      );
      const currentText = currentBytes.toString("utf8");
      if (
        currentBytes.length !== current.size ||
        currentBytes.includes(0) ||
        !Buffer.from(currentText, "utf8").equals(currentBytes)
      ) {
        throw new AppError(
          422,
          "FILE_NOT_EDITABLE",
          "Only existing UTF-8 text files up to 512 KiB can be edited.",
        );
      }
      return adapter.updateFile(
        context.membership.installation.githubInstallationId,
        context.repo.owner,
        context.repo.name,
        { branch, path: safePath, content, expectedSha, commitMessage },
      );
    },

    async listFixPullRequests({
      userId,
      repositoryId,
      head,
      base,
      state,
      requestId,
    }) {
      const context = await editorRepositoryContext({
        userId,
        repositoryId,
        requestId,
        permission: "pull_requests",
      });
      if (!validGitRef(head) || (base && !validGitRef(base))) {
        throw new AppError(422, "INVALID_GIT_REF", "Branch name is invalid.");
      }
      return adapter.listPullRequests(
        context.membership.installation.githubInstallationId,
        context.repo.owner,
        context.repo.name,
        { head, base, state },
      );
    },

    async createFixPullRequest({
      userId,
      repositoryId,
      head,
      base,
      title,
      body,
      draft,
      requestId,
    }) {
      if (!validGitRef(head) || !validGitRef(base) || head === base) {
        throw new AppError(422, "INVALID_GIT_REF", "Pull request branches are invalid.");
      }
      const context = await editorRepositoryContext({
        userId,
        repositoryId,
        requestId,
        permission: "pull_requests",
        write: true,
      });
      await editorProviderBranch(context, head);
      await editorProviderBranch(context, base);
      return adapter.createPullRequest(
        context.membership.installation.githubInstallationId,
        context.repo.owner,
        context.repo.name,
        { head, base, title, body, draft },
      );
    },

    async acceptWebhook({ rawBody, signature, deliveryId, eventType }) {
      requireConfiguration();
      if (
        !verifyGitHubWebhookSignature(
          rawBody,
          signature,
          config.githubAppWebhookSecret,
        )
      ) {
        throw new AppError(
          401,
          "INVALID_WEBHOOK_SIGNATURE",
          "GitHub webhook signature is invalid",
        );
      }
      if (typeof eventType !== "string" || !/^[a-z_]{1,80}$/.test(eventType)) {
        throw new AppError(
          400,
          "INVALID_WEBHOOK_EVENT",
          "GitHub webhook event is invalid",
        );
      }
      if (
        typeof deliveryId !== "string" ||
        deliveryId.length > 100 ||
        !/^[A-Za-z0-9-]+$/.test(deliveryId)
      ) {
        throw new AppError(
          400,
          "INVALID_WEBHOOK_DELIVERY",
          "GitHub webhook delivery is invalid",
        );
      }
      if (!supportedWebhookEvents.has(eventType)) {
        const created = await repository.upsertWebhookDelivery({
          deliveryId,
          eventType,
          payload: {
            action: null,
            installationId: null,
            senderId: null,
            repositories: [],
            repositoryIds: [],
          },
          now: clock(),
          ignored: true,
        });
        return { accepted: true, duplicate: !created, ignored: true };
      }
      let body;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        throw new AppError(
          400,
          "INVALID_WEBHOOK_PAYLOAD",
          "GitHub webhook payload is invalid",
        );
      }
      const payload = normalizeWebhookPayload(eventType, body);
      const created = await repository.upsertWebhookDelivery({
        deliveryId,
        eventType,
        payload,
        now: clock(),
      });
      return { accepted: true, duplicate: !created, ignored: false };
    },

    callbackFailureRedirect,

    async processNextWebhook() {
      const now = clock();
      const delivery = await repository.claimWebhook(now);
      if (!delivery) return false;
      try {
        await repository.processWebhookEvent({
          eventType: delivery.eventType,
          payload: delivery.payload,
          requestId: `github-webhook-${delivery.deliveryId}`,
          now,
        });
        await repository.finishWebhook(delivery.id, {
          success: true,
          now: clock(),
        });
      } catch (error) {
        await repository.finishWebhook(delivery.id, {
          success: false,
          errorCode: /^[A-Z_]{1,80}$/.test(error.code || "")
            ? error.code
            : "PROCESSING_FAILED",
          now: clock(),
        });
        throw error;
      }
      return true;
    },

    async cleanup() {
      return repository.cleanup(clock());
    },
  };
}

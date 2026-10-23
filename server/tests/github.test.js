import { createHmac, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "../src/modules/github/crypto.js";
import {
  createGitHubService,
  verifyGitHubWebhookSignature,
} from "../src/modules/github/service.js";

const key = Buffer.alloc(32, 17);
const config = {
  githubAppEnabled: true,
  githubAppId: "123",
  githubAppClientId: "client-id",
  githubAppClientSecret: "server-only-secret",
  githubAppSlug: "pocketops",
  githubAppOAuthCallbackUrl:
    "https://api.example.test/api/v1/github/oauth/callback",
  githubAppMobileRedirectUri: "pocketops://github/callback",
  githubAppWebhookSecret: "webhook-secret",
  githubTokenEncryptionKey: key,
};
const now = new Date("2026-10-22T10:00:00.000Z");
const hash = (value) => createHash("sha256").update(value).digest("hex");

function makeRepository(overrides = {}) {
  return {
    createLink: vi.fn(async (link) => link),
    findLinkByState: vi.fn(async (stateHash) =>
      stateHash === hash("s".repeat(43))
        ? {
            id: "link-id",
            stateHash,
            githubUserId: "12345",
            expiresAt: new Date(now.getTime() + 60_000),
          }
        : null,
    ),
    authorizeLink: vi.fn(async () => true),
    consumeDeniedLink: vi.fn(async () => true),
    claimInstallationCallback: vi.fn(async (stateHash) =>
      stateHash === hash("i".repeat(43))
        ? {
            id: "link-id",
            userId: "pocket-user",
            githubUserId: "12345",
            accessTokenEncrypted: encryptToken("user-access", key),
            refreshTokenEncrypted: encryptToken("user-refresh", key),
            accessTokenExpiresAt: new Date(now.getTime() + 60 * 60_000),
            refreshTokenExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
            expiresAt: new Date(now.getTime() + 60_000),
          }
        : null,
    ),
    completeInstallation: vi.fn(async () => ({ id: "internal-installation" })),
    listMemberships: vi.fn(async () => []),
    getMembership: vi.fn(),
    getSelectedRepository: vi.fn(),
    syncRepositoryCatalog: vi.fn(async () => []),
    replaceSelections: vi.fn(async () => []),
    listRepositories: vi.fn(async () => []),
    getMembershipByProviderId: vi.fn(),
    withMembershipLock: vi.fn(async (_id, callback) =>
      callback(membership, async () => {}),
    ),
    updateMembershipTokens: vi.fn(),
    revokeMembership: vi.fn(),
    upsertWebhookDelivery: vi.fn(async () => true),
    claimWebhook: vi.fn(async () => null),
    cleanup: vi.fn(),
    ...overrides,
  };
}

function makeAdapter(overrides = {}) {
  return {
    exchangeUserCode: vi.fn(async () => ({
      accessToken: "github-user-access-token",
      refreshToken: "github-user-refresh-token",
      accessExpiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
      refreshExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    })),
    getAuthenticatedUser: vi.fn(async () => ({
      id: "12345",
      login: "developer",
    })),
    refreshUserToken: vi.fn(async () => ({
      accessToken: "refreshed-user-token",
      refreshToken: "refreshed-user-refresh-token",
      accessExpiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
      refreshExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    })),
    getUserInstallations: vi.fn(async () => [
      {
        id: "987",
        accountId: "555",
        accountLogin: "PocketOrg",
        accountType: "Organization",
        repositorySelection: "selected",
        permissions: { contents: "read", metadata: "read" },
        suspendedAt: null,
      },
    ]),
    getInstallationRepositories: vi.fn(async () => [
      {
        id: "1",
        ownerId: "555",
        owner: "PocketOrg",
        name: "api",
        fullName: "PocketOrg/api",
        defaultBranch: "main",
        isPrivate: true,
        isArchived: false,
      },
      {
        id: "2",
        ownerId: "555",
        owner: "PocketOrg",
        name: "user-only",
        fullName: "PocketOrg/user-only",
        defaultBranch: "main",
        isPrivate: true,
        isArchived: false,
      },
    ]),
    getAppInstallationRepositories: vi.fn(async () => [
      {
        id: "1",
        ownerId: "555",
        owner: "PocketOrg",
        name: "api",
        fullName: "PocketOrg/api",
        defaultBranch: "main",
        isPrivate: true,
        isArchived: false,
      },
      {
        id: "3",
        ownerId: "555",
        owner: "PocketOrg",
        name: "app-only",
        fullName: "PocketOrg/app-only",
        defaultBranch: "main",
        isPrivate: true,
        isArchived: false,
      },
    ]),
    getRepository: vi.fn(),
    listDirectory: vi.fn(),
    getFile: vi.fn(),
    listBranches: vi.fn(),
    ...overrides,
  };
}

const membership = {
  id: "membership-id",
  userId: "pocket-user",
  installationId: "internal-installation",
  githubUserTokenEncrypted: encryptToken("user-access", key),
  githubRefreshTokenEncrypted: encryptToken("user-refresh", key),
  accessTokenExpiresAt: new Date(now.getTime() + 60 * 60_000),
  refreshTokenExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
  status: "active",
  installation: {
    id: "internal-installation",
    githubInstallationId: "987",
    removedAt: null,
    suspendedAt: null,
    accountLogin: "PocketOrg",
    accountType: "Organization",
    repositorySelection: "selected",
    lastSyncedAt: now,
  },
};

function makeService({
  repository = makeRepository(),
  adapter = makeAdapter(),
  ...options
} = {}) {
  return {
    service: createGitHubService({
      repository,
      adapter,
      config,
      clock: () => new Date(now),
      credentialGenerator: () => "i".repeat(43),
      ...options,
    }),
    repository,
    adapter,
  };
}

describe("GitHub App identity and installation authorization", () => {
  it("encrypts GitHub user and refresh tokens with authenticated encryption", () => {
    const encrypted = encryptToken("private-provider-token", key);
    expect(encrypted).not.toContain("private-provider-token");
    expect(decryptToken(encrypted, key)).toBe("private-provider-token");
    const parts = encrypted.split(".");
    parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;
    const tampered = parts.join(".");
    expect(() => decryptToken(tampered, key)).toThrow();
  });

  it("creates a state-bound GitHub App authorization URL without returning credentials", async () => {
    const { service, repository } = makeService({
      credentialGenerator: () => "s".repeat(43),
    });
    const result = await service.startInstallation({
      user: { id: "pocket-user", githubUserId: "12345" },
    });
    const url = new URL(result.authorizationUrl);
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("state")).toBe("s".repeat(43));
    expect(url.searchParams.get("scope")).toBe("offline_access");
    expect(repository.createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        stateHash: hash("s".repeat(43)),
        githubUserId: "12345",
      }),
    );
    expect(result.authorizationUrl).not.toContain(config.githubAppClientSecret);
  });

  it("requires the GitHub App authorization identity to match PocketOps identity", async () => {
    const adapter = makeAdapter({
      getAuthenticatedUser: vi.fn(async () => ({
        id: "99999",
        login: "other-user",
      })),
    });
    const { service, repository } = makeService({ adapter });
    await expect(
      service.handleOAuthCallback({
        state: "s".repeat(43),
        code: "one-time-code",
      }),
    ).rejects.toMatchObject({ status: 403, code: "GITHUB_ACCOUNT_MISMATCH" });
    expect(repository.authorizeLink).not.toHaveBeenCalled();
    expect(repository.consumeDeniedLink).toHaveBeenCalledWith("link-id", now);
  });

  it("binds the installation callback to the verified user and authorizes only the access intersection", async () => {
    const repository = makeRepository();
    const adapter = makeAdapter();
    const { service } = makeService({ repository, adapter });
    const url = await service.handleOAuthCallback({
      state: "s".repeat(43),
      code: "one-time-code",
    });
    expect(new URL(url).pathname).toBe("/apps/pocketops/installations/new");
    expect(new URL(url).searchParams.get("state")).toBe("i".repeat(43));
    expect(repository.authorizeLink).toHaveBeenCalledWith(
      expect.objectContaining({
        installStateHash: hash("i".repeat(43)),
        accessTokenEncrypted: expect.not.stringContaining(
          "github-user-access-token",
        ),
      }),
    );

    const redirect = await service.handleInstallationCallback({
      state: "i".repeat(43),
      installationId: "987",
      setupAction: "install",
      requestId: "installation-callback",
    });
    expect(redirect).toBe("pocketops://github/callback?status=connected");
    expect(repository.completeInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        githubInstallationId: "987",
        repositories: expect.arrayContaining([
          expect.objectContaining({ id: "1", fullName: "PocketOrg/api" }),
          expect.objectContaining({ id: "3", fullName: "PocketOrg/app-only" }),
        ]),
      }),
    );
  });

  it("does not link an installation absent from the signed-in user's live GitHub installations", async () => {
    const adapter = makeAdapter({
      getUserInstallations: vi.fn(async () => []),
    });
    const { service, repository } = makeService({ adapter });
    await expect(
      service.handleInstallationCallback({
        state: "i".repeat(43),
        installationId: "987",
        setupAction: "install",
        requestId: "installation-not-owned",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "GITHUB_INSTALLATION_NOT_AUTHORIZED",
    });
    expect(repository.completeInstallation).not.toHaveBeenCalled();
  });
});

describe("GitHub repository access and webhook safety", () => {
  it("requires both user-visible and installation-visible repository access", async () => {
    const repository = makeRepository({
      getMembership: vi.fn(async () => membership),
    });
    const adapter = makeAdapter();
    const { service } = makeService({ repository, adapter });
    await expect(
      service.listInstallationRepositories({
        userId: "pocket-user",
        installationId: "internal-installation",
        requestId: "list-candidates",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        githubRepositoryId: "1",
        fullName: "PocketOrg/api",
        selected: false,
      }),
    ]);
    expect(repository.syncRepositoryCatalog).toHaveBeenCalledWith(
      "internal-installation",
      expect.arrayContaining([
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({ id: "3" }),
      ]),
      now,
    );
  });

  it("does not persist a selection outside the signed-in user's live access", async () => {
    const repository = makeRepository({
      getMembership: vi.fn(async () => membership),
      replaceSelections: vi.fn(async () => []),
    });
    const { service } = makeService({ repository });
    await expect(
      service.syncInstallationRepositories({
        userId: "pocket-user",
        installationId: "internal-installation",
        githubRepositoryIds: ["3"],
        requestId: "select-app-only",
      }),
    ).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
    expect(repository.replaceSelections).not.toHaveBeenCalled();
  });

  it("lists only explicitly selected repositories that remain in the live access intersection", async () => {
    const selectedRepository = {
      id: "repository-uuid",
      githubRepositoryId: "1",
      installationId: "internal-installation",
      ownerLogin: "PocketOrg",
      name: "api",
      fullName: "PocketOrg/api",
      defaultBranch: "main",
      isPrivate: true,
      isArchived: false,
      installation: membership.installation,
    };
    const repository = makeRepository({
      listRepositories: vi.fn(async () => [
        { repository: selectedRepository },
        {
          repository: {
            ...selectedRepository,
            id: "user-only-uuid",
            githubRepositoryId: "2",
            name: "user-only",
            fullName: "PocketOrg/user-only",
          },
        },
      ]),
      getMembership: vi.fn(async () => membership),
    });
    const { service } = makeService({ repository });
    await expect(
      service.listRepositories({
        userId: "pocket-user",
        limit: 50,
        requestId: "list-selected",
      }),
    ).resolves.toMatchObject({
      data: [
        {
          id: "repository-uuid",
          githubRepositoryId: "1",
          fullName: "PocketOrg/api",
          selected: true,
        },
      ],
      nextCursor: null,
    });
  });

  it("serves directory and branch fixtures only after live selected-repository authorization", async () => {
    const repository = makeRepository({
      getSelectedRepository: vi.fn(async () => ({
        repository: {
          id: "repository-uuid",
          githubRepositoryId: "1",
          installationId: "internal-installation",
          ownerLogin: "PocketOrg",
          name: "api",
          defaultBranch: "main",
        },
      })),
      getMembership: vi.fn(async () => membership),
    });
    const adapter = makeAdapter({
      listDirectory: vi.fn(async () => ({
        entries: [{ name: "index.js", path: "src/index.js", type: "file" }],
        nextPage: 2,
      })),
      listBranches: vi.fn(async () => ({
        branches: [{ name: "main", commitSha: "commit-sha", protected: true }],
        nextPage: null,
      })),
    });
    const { service } = makeService({ repository, adapter });
    const tree = await service.listTree({
      userId: "pocket-user",
      repositoryId: "repository-uuid",
      path: "src",
      requestId: "tree",
    });
    expect(tree.data).toEqual([
      { name: "index.js", path: "src/index.js", type: "file" },
    ]);
    expect(tree.nextCursor).toBeNull();
    await expect(
      service.listTree({
        userId: "pocket-user",
        repositoryId: "repository-uuid",
        path: "src",
        cursor: "unsupported",
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "DIRECTORY_CURSOR_UNSUPPORTED",
    });
    await expect(
      service.listBranches({
        userId: "pocket-user",
        repositoryId: "repository-uuid",
        requestId: "branches",
      }),
    ).resolves.toMatchObject({
      data: [{ name: "main", commitSha: "commit-sha", protected: true }],
      nextCursor: null,
    });
  });

  it("rejects a cross-user or unselected repository before provider access", async () => {
    const repository = makeRepository({
      getSelectedRepository: vi.fn(async () => null),
    });
    const adapter = makeAdapter();
    const { service } = makeService({ repository, adapter });
    await expect(
      service.getRepository({
        userId: "another-user",
        repositoryId: "repository-uuid",
        requestId: "cross-user",
      }),
    ).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
    expect(adapter.getRepository).not.toHaveBeenCalled();
  });

  it("rejects traversal and bounds text-file previews without corrupting binary bytes", async () => {
    const repository = makeRepository({
      getSelectedRepository: vi.fn(async () => ({
        repository: {
          id: "repository-uuid",
          githubRepositoryId: "1",
          installationId: "internal-installation",
          ownerLogin: "PocketOrg",
          name: "api",
          defaultBranch: "main",
        },
      })),
      getMembership: vi.fn(async () => membership),
    });
    const adapter = makeAdapter({
      getFile: vi.fn(async () => ({
        path: "README.md",
        sha: "file-sha",
        size: 5,
        encoding: "base64",
        content: Buffer.from("hello").toString("base64"),
      })),
    });
    const { service } = makeService({ repository, adapter });
    await expect(
      service.getFile({
        userId: "pocket-user",
        repositoryId: "repository-uuid",
        path: "../secrets.env",
        requestId: "traversal",
      }),
    ).rejects.toMatchObject({ status: 422, code: "INVALID_REPOSITORY_PATH" });
    expect(adapter.getFile).not.toHaveBeenCalled();

    await expect(
      service.getFile({
        userId: "pocket-user",
        repositoryId: "repository-uuid",
        path: "README.md",
        requestId: "text-file",
      }),
    ).resolves.toMatchObject({
      content: "hello",
      encoding: "utf-8",
      editable: true,
    });

    adapter.getFile.mockResolvedValue({
      path: "image.bin",
      sha: "binary-sha",
      size: 1,
      encoding: "base64",
      content: "/w==",
    });
    await expect(
      service.getFile({
        userId: "pocket-user",
        repositoryId: "repository-uuid",
        path: "image.bin",
        requestId: "binary-file",
      }),
    ).resolves.toMatchObject({
      content: null,
      encoding: "binary",
      editable: false,
    });

    adapter.getFile.mockResolvedValue({
      path: "large.txt",
      sha: "large-sha",
      size: 512 * 1024 + 1,
      content: "",
    });
    await expect(
      service.getFile({
        userId: "pocket-user",
        repositoryId: "repository-uuid",
        path: "large.txt",
        requestId: "large-file",
      }),
    ).rejects.toMatchObject({ status: 413, code: "FILE_TOO_LARGE" });

    adapter.getFile.mockResolvedValue({
      path: "unavailable.txt",
      sha: "sha",
      size: 5,
      encoding: "none",
      content: "",
    });
    await expect(
      service.getFile({
        userId: "pocket-user",
        repositoryId: "repository-uuid",
        path: "unavailable.txt",
      }),
    ).resolves.toMatchObject({
      encoding: "binary",
      content: null,
      editable: false,
    });
    adapter.getFile.mockResolvedValue({
      path: "bad.txt",
      sha: "sha",
      size: 1,
      encoding: "base64",
      content: Buffer.from("more than one byte").toString("base64"),
    });
    await expect(
      service.getFile({
        userId: "pocket-user",
        repositoryId: "repository-uuid",
        path: "bad.txt",
      }),
    ).rejects.toMatchObject({ status: 502, code: "GITHUB_INVALID_RESPONSE" });
    adapter.getFile.mockResolvedValue({
      path: "large.txt",
      sha: "sha",
      size: 1,
      encoding: "base64",
      content: "A".repeat(700000),
    });
    await expect(
      service.getFile({
        userId: "pocket-user",
        repositoryId: "repository-uuid",
        path: "large.txt",
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("verifies webhook signatures, stores only normalized metadata, and deduplicates deliveries", async () => {
    const repository = makeRepository();
    const { service } = makeService({ repository });
    const rawBody = Buffer.from(
      JSON.stringify({
        action: "removed",
        installation: {
          id: 987,
          account: { id: 555, login: "PocketOrg", type: "Organization" },
        },
        repositories_removed: [
          {
            id: 1,
            name: "api",
            full_name: "PocketOrg/api",
            default_branch: "main",
            private: true,
            archived: false,
            owner: { id: 555, login: "PocketOrg" },
          },
        ],
        sender: { id: 12345, login: "developer" },
        secret: "never-store-this",
      }),
    );
    const signature = `sha256=${createHmac(
      "sha256",
      config.githubAppWebhookSecret,
    )
      .update(rawBody)
      .digest("hex")}`;
    expect(
      verifyGitHubWebhookSignature(
        rawBody,
        signature,
        config.githubAppWebhookSecret,
      ),
    ).toBe(true);
    expect(
      verifyGitHubWebhookSignature(
        rawBody,
        `${signature.slice(0, -1)}0`,
        config.githubAppWebhookSecret,
      ),
    ).toBe(false);
    await expect(
      service.acceptWebhook({
        rawBody,
        signature: "sha256=" + "0".repeat(64),
        deliveryId: "delivery-1",
        eventType: "installation_repositories",
      }),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_WEBHOOK_SIGNATURE" });

    await expect(
      service.acceptWebhook({
        rawBody,
        signature,
        deliveryId: "delivery-1",
        eventType: "installation_repositories",
      }),
    ).resolves.toEqual({ accepted: true, duplicate: false, ignored: false });
    expect(repository.upsertWebhookDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          action: "removed",
          installationId: "987",
          repositoryIds: ["1"],
        }),
      }),
    );
    expect(
      JSON.stringify(repository.upsertWebhookDelivery.mock.calls),
    ).not.toContain("never-store-this");
    repository.upsertWebhookDelivery.mockResolvedValue(false);
    await expect(
      service.acceptWebhook({
        rawBody,
        signature,
        deliveryId: "delivery-1",
        eventType: "installation_repositories",
      }),
    ).resolves.toMatchObject({ duplicate: true });
  });
});

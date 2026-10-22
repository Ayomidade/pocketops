import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors/app-error.js";
import { createGitHubAppAdapter } from "../src/modules/github/adapter.js";

const config = {
  githubAppEnabled: true,
  githubAppId: "123",
  githubAppPrivateKey: "private-key",
  githubAppClientId: "client-id",
  githubAppClientSecret: "server-secret",
  githubAppOAuthCallbackUrl: "https://api.example.test/api/v1/github/oauth/callback",
};

function repository(id) {
  return {
    id: Number(id),
    owner: { id: 555, login: "PocketOrg" },
    name: `repo-${id}`,
    full_name: `PocketOrg/repo-${id}`,
    default_branch: "main",
    private: true,
    archived: false,
  };
}

function pagedResponse(data, page) {
  return {
    data,
    headers: {
      link:
        page === 1
          ? '<https://api.github.com/resource?page=2>; rel="next", <https://api.github.com/resource?page=2>; rel="last"'
          : "",
    },
  };
}

function makeOctokit({ requestImplementation, restOverrides = {} } = {}) {
  return {
    request: requestImplementation || vi.fn(async () => ({ data: [] })),
    rest: {
      users: {
        getAuthenticated: vi.fn(async () => ({
          data: { id: 12345, login: "developer" },
        })),
      },
      repos: {
        get: vi.fn(async () => ({ data: repository(1) })),
        getContent: vi.fn(async () => ({
          data: [{ name: "README.md", path: "README.md", type: "file", sha: "blob", size: 5 }],
          headers: {},
        })),
        listBranches: vi.fn(async () => ({
          data: [{ name: "main", commit: { sha: "commit" }, protected: true }],
          headers: {},
        })),
        ...restOverrides,
      },
    },
  };
}

describe("GitHub App adapter", () => {
  it("exchanges and refreshes expiring user tokens only through the server adapter", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 28800,
            refresh_token_expires_in: 15897600,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-2",
            refresh_token: "refresh-2",
            expires_in: 28800,
            refresh_token_expires_in: 15897600,
          }),
          { status: 200 },
        ),
      );
    const adapter = createGitHubAppAdapter({
      config,
      fetchImplementation,
      AppClass: class {},
      OctokitClass: class {},
    });

    await expect(adapter.exchangeUserCode("one-time-code")).resolves.toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
    await expect(adapter.refreshUserToken("refresh-1")).resolves.toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
    const authorizationRequest = JSON.parse(fetchImplementation.mock.calls[0][1].body);
    expect(authorizationRequest).toMatchObject({
      client_id: "client-id",
      client_secret: "server-secret",
      code: "one-time-code",
      redirect_uri: config.githubAppOAuthCallbackUrl,
    });
    expect(fetchImplementation.mock.calls[1][1].body).toContain(
      '"grant_type":"refresh_token"',
    );
  });

  it("paginates user installation and repository responses and normalizes provider IDs", async () => {
    const octokit = makeOctokit({
      requestImplementation: vi.fn(async (route, parameters) => {
        if (route === "GET /user/installations") {
          return pagedResponse(
            {
              installations: [
                {
                  id: parameters.page === 1 ? 987 : 988,
                  account: {
                    id: 555,
                    login: "PocketOrg",
                    type: "Organization",
                  },
                  repository_selection: "selected",
                  permissions: { contents: "read" },
                },
              ],
            },
            parameters.page,
          );
        }
        if (route === "GET /user/installations/{installation_id}/repositories") {
          return pagedResponse(
            { repositories: [repository(parameters.page)] },
            parameters.page,
          );
        }
        if (route === "GET /installation/repositories") {
          return pagedResponse(
            { repositories: [repository(parameters.page + 10)] },
            parameters.page,
          );
        }
        throw new Error(`Unexpected route ${route}`);
      }),
    });
    class MockOctokit {
      constructor() {
        return octokit;
      }
    }
    class MockApp {
      async getInstallationOctokit() {
        return octokit;
      }
    }
    const adapter = createGitHubAppAdapter({
      config,
      AppClass: MockApp,
      OctokitClass: MockOctokit,
    });

    await expect(adapter.getAuthenticatedUser("user-token")).resolves.toEqual({
      id: "12345",
      login: "developer",
    });
    await expect(adapter.getUserInstallations("user-token")).resolves.toHaveLength(2);
    await expect(
      adapter.getInstallationRepositories("user-token", "987"),
    ).resolves.toMatchObject([
      { id: "1", fullName: "PocketOrg/repo-1" },
      { id: "2", fullName: "PocketOrg/repo-2" },
    ]);
    await expect(adapter.getAppInstallationRepositories("987")).resolves.toMatchObject([
      { id: "11", fullName: "PocketOrg/repo-11" },
      { id: "12", fullName: "PocketOrg/repo-12" },
    ]);
  });

  it("normalizes paginated directory entries and branch metadata", async () => {
    const octokit = makeOctokit({
      restOverrides: {
        getContent: vi.fn(async ({ page }) =>
          pagedResponse(
            [
              {
                name: `file-${page}.js`,
                path: `src/file-${page}.js`,
                type: "file",
                sha: `sha-${page}`,
                size: 12,
              },
            ],
            page,
          ),
        ),
        listBranches: vi.fn(async ({ page }) =>
          pagedResponse(
            [
              {
                name: `branch-${page}`,
                commit: { sha: `commit-${page}` },
                protected: page === 1,
              },
            ],
            page,
          ),
        ),
      },
    });
    class MockApp {
      async getInstallationOctokit() {
        return octokit;
      }
    }
    const adapter = createGitHubAppAdapter({
      config,
      AppClass: MockApp,
      OctokitClass: class {},
    });

    await expect(
      adapter.listDirectory("987", "PocketOrg", "repo", "src", "main", 1),
    ).resolves.toMatchObject({
      entries: [{ name: "file-1.js", path: "src/file-1.js", type: "file" }],
      nextPage: 2,
    });
    await expect(
      adapter.listBranches("987", "PocketOrg", "repo", 1),
    ).resolves.toMatchObject({
      branches: [{ name: "branch-1", commitSha: "commit-1", protected: true }],
      nextPage: 2,
    });
  });

  it("normalizes permission and rate-limit errors without leaking provider details", async () => {
    const forbidden = Object.assign(new Error("private response detail"), {
      status: 403,
      response: { headers: {} },
    });
    const rateLimited = Object.assign(new Error("private response detail"), {
      status: 403,
      response: { headers: { "x-ratelimit-remaining": "0" } },
    });
    const octokit = makeOctokit({
      restOverrides: {
        get: vi.fn().mockRejectedValueOnce(forbidden).mockRejectedValueOnce(rateLimited),
      },
    });
    class MockApp {
      async getInstallationOctokit() {
        return octokit;
      }
    }
    const adapter = createGitHubAppAdapter({
      config,
      AppClass: MockApp,
      OctokitClass: class {},
    });

    await expect(adapter.getRepository("987", "PocketOrg", "repo")).rejects.toMatchObject({
      status: 403,
      code: "GITHUB_PERMISSION_DENIED",
      message: expect.not.stringContaining("private response detail"),
    });
    await expect(adapter.getRepository("987", "PocketOrg", "repo")).rejects.toMatchObject({
      status: 429,
      code: "GITHUB_RATE_LIMITED",
    });
  });

  it("rejects expired-token responses without returning provider error bodies", async () => {
    const adapter = createGitHubAppAdapter({
      config,
      fetchImplementation: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "sensitive provider text",
          }),
          { status: 400 },
        ),
      ),
      AppClass: class {},
      OctokitClass: class {},
    });

    await expect(adapter.refreshUserToken("old-refresh-token")).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(adapter.refreshUserToken("old-refresh-token")).rejects.toMatchObject({
      status: 502,
      code: "GITHUB_UNAVAILABLE",
    });
  });
});

import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { AppError } from "../../errors/app-error.js";

const githubTokenUrl = "https://github.com/login/oauth/access_token";

function providerError(error) {
  if (error.status === 401) {
    return new AppError(
      401,
      "GITHUB_AUTH_REVOKED",
      "GitHub authorization must be renewed",
    );
  }
  if (error.status === 404) {
    return new AppError(
      404,
      "RESOURCE_NOT_FOUND",
      "GitHub resource was not found",
    );
  }
  if (
    error.status === 403 &&
    (error.response?.headers?.["x-ratelimit-remaining"] === "0" ||
      error.response?.headers?.["retry-after"])
  ) {
    return new AppError(
      429,
      "GITHUB_RATE_LIMITED",
      "GitHub rate limit reached; retry later",
    );
  }
  if (error.status === 403) {
    return new AppError(
      403,
      "GITHUB_PERMISSION_DENIED",
      "GitHub denied access to this resource",
    );
  }
  return new AppError(
    502,
    "GITHUB_UNAVAILABLE",
    "GitHub is temporarily unavailable",
  );
}

function writeProviderError(error, conflictCode, conflictMessage) {
  if (error instanceof AppError) throw error;
  if ([409, 422].includes(error.status)) {
    throw new AppError(409, conflictCode, conflictMessage);
  }
  throw providerError(error);
}

function normalizedRepository(repo) {
  return {
    id: String(repo.id),
    ownerId: String(repo.owner?.id),
    owner: repo.owner?.login,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch || null,
    isPrivate: Boolean(repo.private),
    isArchived: Boolean(repo.archived),
  };
}

function nextPage(link = "") {
  const next = link.split(",").find((part) => part.includes('rel="next"'));
  const page = next?.match(/[?&]page=(\d+)/)?.[1];
  return page ? Number(page) : null;
}

async function allPages(requestPage, firstParams, collectionKey = null) {
  const entries = [];
  let page = 1;
  while (page <= 100) {
    const response = await requestPage({ ...firstParams, per_page: 100, page });
    const pageEntries = collectionKey
      ? response.data[collectionKey]
      : response.data;
    if (!Array.isArray(pageEntries)) {
      throw new AppError(
        502,
        "GITHUB_INVALID_RESPONSE",
        "GitHub returned an invalid response",
      );
    }
    entries.push(...pageEntries);
    page = nextPage(response.headers.link || "");
    if (!page) return entries;
  }
  throw new AppError(
    502,
    "GITHUB_PAGINATION_LIMIT",
    "GitHub returned too many pages",
  );
}

export function createGitHubAppAdapter({
  config,
  fetchImplementation = fetch,
  AppClass = App,
  OctokitClass = Octokit,
  timeoutMs = 8000,
}) {
  const app = config.githubAppEnabled
    ? new AppClass({
        appId: config.githubAppId,
        privateKey: config.githubAppPrivateKey,
        // App defaults to @octokit/core, which has no .rest endpoint methods.
        Octokit: OctokitClass,
      })
    : null;

  async function tokenRequest(parameters) {
    try {
      const response = await fetchImplementation(githubTokenUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parameters),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json();
      if (!response.ok || body.error || typeof body.access_token !== "string") {
        throw new Error("GitHub authorization failed");
      }
      return body;
    } catch {
      throw new AppError(
        502,
        "GITHUB_UNAVAILABLE",
        "GitHub authorization could not be completed",
      );
    }
  }

  function userClient(token) {
    return new OctokitClass({
      auth: token,
      request: { timeout: timeoutMs },
    });
  }

  async function readAllInstallationRepos(octokit) {
    return allPages(
      (parameters) =>
        octokit.request("GET /installation/repositories", {
          ...parameters,
          request: { timeout: timeoutMs },
        }),
      {},
      "repositories",
    );
  }

  async function readUserInstallationRepos(octokit, installationId) {
    return allPages(
      (parameters) =>
        octokit.request(
          "GET /user/installations/{installation_id}/repositories",
          {
            installation_id: Number(installationId),
            ...parameters,
            request: { timeout: timeoutMs },
          },
        ),
      {},
      "repositories",
    );
  }

  function normalizeCall(error) {
    if (error instanceof AppError) throw error;
    throw providerError(error);
  }

  return {
    async exchangeUserCode(code, { codeVerifier } = {}) {
      const body = await tokenRequest({
        client_id: config.githubAppClientId,
        client_secret: config.githubAppClientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: config.githubAppOAuthCallbackUrl,
      });
      if (
        typeof body.refresh_token !== "string" ||
        !Number.isFinite(Number(body.expires_in)) ||
        !Number.isFinite(Number(body.refresh_token_expires_in))
      ) {
        throw new AppError(
          502,
          "GITHUB_TOKEN_EXPIRY_REQUIRED",
          "GitHub App expiring user tokens must be enabled",
        );
      }
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        accessExpiresAt: new Date(Date.now() + Number(body.expires_in) * 1000),
        refreshExpiresAt: new Date(
          Date.now() + Number(body.refresh_token_expires_in) * 1000,
        ),
      };
    },

    async refreshUserToken(refreshToken) {
      const body = await tokenRequest({
        client_id: config.githubAppClientId,
        client_secret: config.githubAppClientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      if (
        typeof body.refresh_token !== "string" ||
        !Number.isFinite(Number(body.expires_in)) ||
        !Number.isFinite(Number(body.refresh_token_expires_in))
      ) {
        throw new AppError(
          401,
          "GITHUB_AUTH_REVOKED",
          "GitHub authorization must be renewed",
        );
      }
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        accessExpiresAt: new Date(Date.now() + Number(body.expires_in) * 1000),
        refreshExpiresAt: new Date(
          Date.now() + Number(body.refresh_token_expires_in) * 1000,
        ),
      };
    },

    async getAuthenticatedUser(accessToken) {
      try {
        const { data } =
          await userClient(accessToken).rest.users.getAuthenticated();
        return { id: String(data.id), login: data.login };
      } catch (error) {
        normalizeCall(error);
      }
    },

    async getUserInstallations(accessToken) {
      try {
        const installations = await allPages(
          (parameters) =>
            userClient(accessToken).request("GET /user/installations", {
              ...parameters,
              request: { timeout: timeoutMs },
            }),
          {},
          "installations",
        );
        return installations.map((installation) => ({
          id: String(installation.id),
          accountId: String(installation.account.id),
          accountLogin: installation.account.login,
          accountType: installation.account.type,
          repositorySelection: installation.repository_selection,
          permissions: installation.permissions || {},
          suspendedAt: installation.suspended_at || null,
        }));
      } catch (error) {
        normalizeCall(error);
      }
    },

    async getInstallationRepositories(accessToken, installationId) {
      try {
        const repositories = await readUserInstallationRepos(
          userClient(accessToken),
          installationId,
        );
        return repositories.map(normalizedRepository);
      } catch (error) {
        normalizeCall(error);
      }
    },

    async getAppInstallationRepositories(installationId) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const repositories = await readAllInstallationRepos(octokit);
        return repositories.map(normalizedRepository);
      } catch (error) {
        normalizeCall(error);
      }
    },

    async getRepository(installationId, owner, repo) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const { data } = await octokit.rest.repos.get({ owner, repo });
        return data;
      } catch (error) {
        normalizeCall(error);
      }
    },

    async listDirectory(installationId, owner, repo, path, ref) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
          ref,
          request: { timeout: timeoutMs },
        });
        if (!Array.isArray(data)) {
          throw new AppError(
            422,
            "NOT_A_DIRECTORY",
            "The requested path is not a directory",
          );
        }
        return {
          entries: data.slice(0, 1000).map((item) => ({
            name: item.name,
            path: item.path,
            type: item.submodule_git_url ? "submodule" : item.type,
            sha: item.sha,
            size: item.size,
          })),
          nextPage: null,
          directoryLimitReached: data.length >= 1000,
        };
      } catch (error) {
        normalizeCall(error);
      }
    },

    async getFile(installationId, owner, repo, path, ref) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
          ref,
          request: { timeout: timeoutMs },
        });
        if (Array.isArray(data) || data.type !== "file") {
          throw new AppError(
            422,
            "NOT_A_FILE",
            "The requested path is not a file",
          );
        }
        return data;
      } catch (error) {
        normalizeCall(error);
      }
    },

    async listBranches(installationId, owner, repo, page) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const { data, headers } = await octokit.rest.repos.listBranches({
          owner,
          repo,
          per_page: 100,
          page,
          request: { timeout: timeoutMs },
        });
        return {
          branches: data.map(({ name, commit, protected: isProtected }) => ({
            name,
            commitSha: commit.sha,
            protected: isProtected,
          })),
          nextPage: nextPage(headers.link || ""),
        };
      } catch (error) {
        normalizeCall(error);
      }
    },

    async getBranch(installationId, owner, repo, branch) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const { data } = await octokit.rest.repos.getBranch({
          owner,
          repo,
          branch,
          request: { timeout: timeoutMs },
        });
        return {
          name: data.name,
          commitSha: data.commit.sha,
          protected: Boolean(data.protected),
        };
      } catch (error) {
        normalizeCall(error);
      }
    },

    async createBranch(installationId, owner, repo, branch, baseSha) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const { data } = await octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branch}`,
          sha: baseSha,
          request: { timeout: timeoutMs },
        });
        return { ref: data.ref, sha: data.object.sha };
      } catch (error) {
        if (error.status === 422) {
          throw new AppError(
            409,
            "BRANCH_ALREADY_EXISTS",
            "That branch already exists. Choose a new branch name.",
          );
        }
        writeProviderError(
          error,
          "BRANCH_CREATE_CONFLICT",
          "The branch could not be created from the selected revision.",
        );
      }
    },

    async updateFile(installationId, owner, repo, input) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const { data } = await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: input.path,
          branch: input.branch,
          message: input.commitMessage,
          content: Buffer.from(input.content, "utf8").toString("base64"),
          sha: input.expectedSha,
          request: { timeout: timeoutMs },
        });
        return {
          contentSha: data.content?.sha || null,
          commitSha: data.commit?.sha || null,
        };
      } catch (error) {
        writeProviderError(
          error,
          "FILE_VERSION_CONFLICT",
          "The file changed after it was opened. Reload it before saving.",
        );
      }
    },

    async listPullRequests(installationId, owner, repo, input) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const { data } = await octokit.rest.pulls.list({
          owner,
          repo,
          head: `${owner}:${input.head}`,
          ...(input.base ? { base: input.base } : {}),
          state: input.state || "open",
          per_page: 50,
          request: { timeout: timeoutMs },
        });
        return data.map((item) => ({
          number: item.number,
          title: item.title,
          url: item.html_url,
          state: item.state,
          head: item.head.ref,
          base: item.base.ref,
          draft: Boolean(item.draft),
        }));
      } catch (error) {
        normalizeCall(error);
      }
    },

    async createPullRequest(installationId, owner, repo, input) {
      try {
        const octokit = await app.getInstallationOctokit(
          Number(installationId),
        );
        const { data } = await octokit.rest.pulls.create({
          owner,
          repo,
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
          draft: Boolean(input.draft),
          request: { timeout: timeoutMs },
        });
        return {
          number: data.number,
          title: data.title,
          url: data.html_url,
          state: data.state,
          head: data.head.ref,
          base: data.base.ref,
          draft: Boolean(data.draft),
        };
      } catch (error) {
        writeProviderError(
          error,
          "PULL_REQUEST_CONFLICT",
          "The pull request could not be created for these branches.",
        );
      }
    },
  };
}

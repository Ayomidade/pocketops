import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors/app-error.js";
import { createApp } from "../src/app.js";
import { createGitHubController } from "../src/modules/github/controller.js";

const config = {
  nodeEnv: "test",
  port: 4000,
  databaseUrl: null,
  databaseSsl: false,
  corsOrigins: [],
  logLevel: "silent",
};
const user = {
  id: "user-id",
  githubUserId: "12345",
  username: "developer",
  email: null,
  avatarUrl: null,
};
const session = { id: "session-id", expiresAt: "2026-11-21T00:00:00.000Z" };
const token = "t".repeat(43);

function makeServices(overrides = {}) {
  const authService = {
    authenticateToken: vi.fn(async () => ({ user, session })),
  };
  const githubService = {
    startInstallation: vi.fn(async () => ({
      authorizationUrl: "https://github.com/login/oauth/authorize?state=state",
    })),
    handleOAuthCallback: vi.fn(
      async () => "https://github.com/apps/pocketops/installations/new",
    ),
    handleInstallationCallback: vi.fn(
      async () => "pocketops://github/callback?status=connected",
    ),
    listInstallations: vi.fn(async () => []),
    listInstallationRepositories: vi.fn(async () => []),
    syncInstallationRepositories: vi.fn(async () => []),
    listRepositories: vi.fn(async () => ({ data: [], nextCursor: null })),
    getRepository: vi.fn(async () => ({ id: "repository-id" })),
    listTree: vi.fn(async () => ({ data: [], nextCursor: null })),
    getFile: vi.fn(async () => ({ path: "README.md", content: "hi" })),
    listBranches: vi.fn(async () => ({ data: [], nextCursor: null })),
    getEditorBranch: vi.fn(async () => ({ name: "main", commitSha: "a".repeat(40), protected: true })),
    acceptWebhook: vi.fn(async () => ({ accepted: true, duplicate: false })),
    ...overrides,
  };
  return {
    app: createApp({ config, authService, githubService }),
    authService,
    githubService,
  };
}

describe("GitHub integration API", () => {
  it.each([
    ["oauthCallback", "handleOAuthCallback"],
    ["installationCallback", "handleInstallationCallback"],
  ])(
    "propagates unexpected %s failures to the async error handler",
    async (method, serviceMethod) => {
      const failure = new Error("private provider failure");
      const service = {
        [serviceMethod]: vi.fn().mockRejectedValue(failure),
      };
      const controller = createGitHubController(service);
      await expect(
        controller[method](
          { validated: { query: {} }, id: "callback-test" },
          {},
        ),
      ).rejects.toBe(failure);
    },
  );

  it("requires PocketOps authentication before exposing connected accounts", async () => {
    const githubService = { listInstallations: vi.fn() };
    const app = createApp({
      config,
      githubService,
      authService: {
        authenticateToken: vi.fn(async () => {
          throw new AppError(
            401,
            "UNAUTHENTICATED",
            "A valid session is required",
          );
        }),
      },
    });
    await request(app).get("/api/v1/github/installations").expect(401);
    expect(githubService.listInstallations).not.toHaveBeenCalled();
  });

  it("returns selected branch metadata only after session and repository authorization", async () => {
    const { app, githubService } = makeServices();
    const response = await request(app)
      .get("/api/v1/github/repositories/11111111-1111-4111-8111-111111111111/branches/metadata?branch=fix%2Ftask")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(response.body.data.commitSha).toHaveLength(40);
    expect(githubService.getEditorBranch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, branch: "fix/task" }),
    );
    await request(app)
      .get("/api/v1/github/repositories/11111111-1111-4111-8111-111111111111/branches/metadata?branch=bad%20ref")
      .set("Authorization", `Bearer ${token}`)
      .expect(422);
  });

  it("starts the GitHub App flow only for the authenticated user", async () => {
    const { app, githubService } = makeServices();
    const response = await request(app)
      .post("/api/v1/github/installations/start")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(201);
    expect(response.body.data.authorizationUrl).toContain(
      "github.com/login/oauth/authorize",
    );
    expect(githubService.startInstallation).toHaveBeenCalledWith({
      user,
      requestId: response.body.meta.requestId,
    });
  });

  it("returns provider callback failures to the native app without exposing provider details", async () => {
    const { app } = makeServices({
      handleOAuthCallback: vi.fn(async () => {
        throw new AppError(
          502,
          "GITHUB_UNAVAILABLE",
          "GitHub authorization could not be completed",
        );
      }),
      callbackFailureRedirect: vi.fn(
        async () => "pocketops://github/callback?status=failed",
      ),
    });
    const response = await request(app)
      .get(
        `/api/v1/github/oauth/callback?state=${"s".repeat(43)}&code=one-time-code`,
      )
      .expect(302);
    expect(response.headers.location).toBe(
      "pocketops://github/callback?status=failed",
    );
    expect(response.headers.location).not.toContain("one-time-code");
  });

  it("validates selected repo IDs and hides inaccessible repository resources", async () => {
    const { app, githubService } = makeServices({
      syncInstallationRepositories: vi.fn(async () => {
        throw new AppError(
          404,
          "RESOURCE_NOT_FOUND",
          "Repository was not found",
        );
      }),
      getRepository: vi.fn(async () => {
        throw new AppError(
          404,
          "RESOURCE_NOT_FOUND",
          "Repository was not found",
        );
      }),
    });
    const invalid = await request(app)
      .post("/api/v1/github/installations/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({ installationId: "not-a-uuid", githubRepositoryIds: ["1"] })
      .expect(422);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    await request(app)
      .post("/api/v1/github/installations/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        installationId: "11111111-1111-4111-8111-111111111111",
        githubRepositoryIds: ["1"],
      })
      .expect(404);
    await request(app)
      .get("/api/v1/github/repositories/11111111-1111-4111-8111-111111111111")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
    expect(githubService.getRepository).toHaveBeenCalled();
  });

  it("preserves webhook raw bytes for signature verification and uses the accepted response", async () => {
    const { app, githubService } = makeServices();
    const response = await request(app)
      .post("/api/v1/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Delivery", "delivery-id")
      .set("X-GitHub-Event", "installation")
      .set("X-Hub-Signature-256", `sha256=${"a".repeat(64)}`)
      .send('{"action":"created","installation":{"id":7}}')
      .expect(202);
    expect(
      Buffer.isBuffer(githubService.acceptWebhook.mock.calls[0][0].rawBody),
    ).toBe(true);
    expect(
      githubService.acceptWebhook.mock.calls[0][0].rawBody.toString(),
    ).toBe('{"action":"created","installation":{"id":7}}');
    expect(response.body.data.accepted).toBe(true);
  });

  it("returns safe unavailable and validation errors", async () => {
    const disabled = createApp({ config });
    await request(disabled)
      .get("/api/v1/github/installations")
      .set("Authorization", `Bearer ${token}`)
      .expect(503);
    await request(makeServices().app)
      .get("/api/v1/github/repositories/../../etc/passwd")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });
});

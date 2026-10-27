import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

const config = { nodeEnv: "test", corsOrigins: [], logLevel: "silent" };
const user = {
  id: "user-id",
  githubUserId: "12345",
  username: "developer",
  email: null,
  avatarUrl: null,
};
const token = "t".repeat(43);
const repositoryId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "1a340bbc-183a-40ee-a3b9-56f11d4831d0";

function appFor(editorService) {
  return createApp({
    config,
    authService: { authenticateToken: vi.fn(async () => ({ user, session: {} })) },
    editorService,
  });
}

describe("editor write API", () => {
  it("requires a session, validated inputs, and an idempotency key for writes", async () => {
    const service = { createBranch: vi.fn() };
    const app = appFor(service);
    const path = `/api/v1/github/repositories/${repositoryId}/branches`;
    await request(app).post(path).send({}).expect(401);
    const invalid = await request(app)
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "short")
      .send({ branch: "fix/task", baseBranch: "main", baseSha: "bad" })
      .expect(422);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    expect(service.createBranch).not.toHaveBeenCalled();
  });

  it("passes the authenticated actor and validated idempotency key to branch creation", async () => {
    const service = {
      createBranch: vi.fn(async () => ({
        branch: "fix/task",
        baseBranch: "main",
        baseSha: "a".repeat(40),
        duplicate: false,
      })),
    };
    const response = await request(appFor(service))
      .post(`/api/v1/github/repositories/${repositoryId}/branches`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ branch: "fix/task", baseBranch: "main", baseSha: "a".repeat(40) })
      .expect(201);
    expect(response.body.data.branch).toBe("fix/task");
    expect(service.createBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        repositoryId,
        idempotencyKey,
        branch: "fix/task",
        baseBranch: "main",
      }),
    );
  });

  it("bounds source content before dispatching a commit", async () => {
    const service = { commitFile: vi.fn() };
    const response = await request(appFor(service))
      .put(`/api/v1/github/repositories/${repositoryId}/file`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        branch: "fix/task",
        path: "src/index.js",
        content: "x".repeat(512 * 1024 + 1),
        expectedSha: "a".repeat(40),
        commitMessage: "Fix issue",
      })
      .expect(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(service.commitFile).not.toHaveBeenCalled();
  });

  it("supports authenticated pull-request reads and reports unavailable configuration safely", async () => {
    const service = {
      listPullRequests: vi.fn(async () => []),
    };
    const response = await request(appFor(service))
      .get(`/api/v1/github/repositories/${repositoryId}/pull-requests?head=fix%2Ftask`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(response.body.data).toEqual([]);
    expect(service.listPullRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        repositoryId,
        head: "fix/task",
      }),
    );
    const unavailable = await request(createApp({ config }))
      .get(`/api/v1/github/repositories/${repositoryId}/pull-requests?head=fix`)
      .set("Authorization", `Bearer ${token}`)
      .expect(503);
    expect(unavailable.body.error.code).toBe("EDITOR_NOT_CONFIGURED");
  });
});

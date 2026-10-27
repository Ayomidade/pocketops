import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors/app-error.js";
import { createEditorService, validGitRef } from "../src/modules/editor/service.js";

const userId = "user-id";
const repositoryId = "repository-id";
const sha = "a".repeat(40);
const request = {
  userId,
  repositoryId,
  idempotencyKey: "operation-key-0001",
  requestId: "request-1",
};

function fixtures(overrides = {}) {
  const operations = [];
  const audits = [];
  const repository = {
    beginOperation: vi.fn(async (values) => {
      const existing = operations.find(
        (item) =>
          item.actorUserId === values.actorUserId &&
          item.idempotencyKey === values.idempotencyKey,
      );
      if (existing) return { operation: existing, created: false };
      const operation = {
        id: `operation-${operations.length + 1}`,
        resultMetadata: {},
        ...values,
      };
      operations.push(operation);
      return { operation, created: true };
    }),
    finishOperation: vi.fn(async (input) => {
      const operation = operations.find((item) => item.id === input.id);
      Object.assign(operation, input.values, {
        status: input.status,
        completedAt: new Date(),
      });
      audits.push({ action: input.action, metadata: input.metadata });
      return operation;
    }),
    findFixBranch: vi.fn(async ({ actorUserId, repositoryId, branchName }) =>
      operations.find(
        (item) =>
          item.actorUserId === actorUserId &&
          item.repositoryId === repositoryId &&
          item.operationType === "branch" &&
          item.branchName === branchName &&
          item.status === "succeeded",
      ) || null,
    ),
    operations,
    audits,
  };
  const githubService = {
    createFixBranch: vi.fn(async (input) => ({
      branch: input.branch,
      baseBranch: input.baseBranch,
      baseSha: input.baseSha,
      commitSha: sha,
    })),
    commitFixFile: vi.fn(async () => ({ contentSha: "b".repeat(40), commitSha: "c".repeat(40) })),
    listFixPullRequests: vi.fn(async () => []),
    createFixPullRequest: vi.fn(async (input) => ({
      number: 12,
      url: "https://github.com/org/repo/pull/12",
      state: "open",
      head: input.head,
      base: input.base,
      title: input.title,
      draft: input.draft,
    })),
    ...overrides,
  };
  return {
    repository,
    githubService,
    service: createEditorService({ repository, githubService }),
  };
}

async function createBranch(service, overrides = {}) {
  return service.createBranch({
    ...request,
    branch: "fix/mobile-recovery",
    baseBranch: "main",
    baseSha: sha,
    ...overrides,
  });
}

describe("GitHub editor workflow", () => {
  it("validates Git refs without rejecting slash branches", () => {
    expect(validGitRef("fix/mobile-recovery")).toBe(true);
    for (const ref of ["../main", "bad..name", "bad~name", "refs/heads/.hidden", "trailing.", "bad.lock"]) {
      expect(validGitRef(ref)).toBe(false);
    }
  });

  it("creates a fix branch once and replays its durable idempotent result", async () => {
    const { service, githubService, repository } = fixtures();
    const first = await createBranch(service);
    const replay = await createBranch(service);
    expect(first).toMatchObject({ branch: "fix/mobile-recovery", baseBranch: "main" });
    expect(replay).toEqual(first);
    expect(githubService.createFixBranch).toHaveBeenCalledTimes(1);
    expect(repository.audits).toHaveLength(1);
    expect(repository.audits[0].action).toBe("repository_fix_branch_created");
  });

  it("rejects reuse of an idempotency key with different branch parameters", async () => {
    const { service } = fixtures();
    await createBranch(service);
    await expect(
      createBranch(service, { branch: "fix/other" }),
    ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("returns a durable 409 when the fix branch already exists upstream", async () => {
    const { service, githubService, repository } = fixtures({
      createFixBranch: vi.fn(async () => {
        throw new AppError(409, "BRANCH_ALREADY_EXISTS", "Branch already exists");
      }),
    });
    await expect(createBranch(service)).rejects.toMatchObject({
      status: 409,
      code: "BRANCH_ALREADY_EXISTS",
    });
    await expect(createBranch(service)).rejects.toMatchObject({
      status: 409,
      code: "BRANCH_ALREADY_EXISTS",
    });
    expect(githubService.createFixBranch).toHaveBeenCalledTimes(1);
    expect(repository.operations[0].status).toBe("failed");
  });

  it("makes stale file revisions a durable conflict without a second provider write", async () => {
    const { service, repository, githubService } = fixtures({
      commitFixFile: vi.fn(async () => {
        throw new AppError(409, "FILE_VERSION_CONFLICT", "File moved");
      }),
    });
    await createBranch(service);
    const input = {
      ...request,
      idempotencyKey: "commit-operation-0001",
      branch: "fix/mobile-recovery",
      path: "src/index.js",
      content: "updated source",
      expectedSha: sha,
      commitMessage: "Fix recovery",
    };
    await expect(service.commitFile(input)).rejects.toMatchObject({
      status: 409,
      code: "FILE_VERSION_CONFLICT",
    });
    await expect(service.commitFile(input)).rejects.toMatchObject({
      status: 409,
      code: "FILE_VERSION_CONFLICT",
    });
    expect(githubService.commitFixFile).toHaveBeenCalledTimes(1);
    const operation = repository.operations.find((item) => item.operationType === "commit");
    expect(operation.status).toBe("failed");
    expect(operation.contentSha).not.toContain("updated source");
    expect(repository.audits.at(-1).metadata).not.toHaveProperty("content");
  });

  it("refuses commits to a branch the current user did not create", async () => {
    const { service, githubService, repository } = fixtures();
    await expect(
      service.commitFile({
        ...request,
        branch: "main",
        path: "README.md",
        content: "changed",
        expectedSha: sha,
        commitMessage: "Change README",
      }),
    ).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
    expect(repository.beginOperation).not.toHaveBeenCalled();
    expect(githubService.commitFixFile).not.toHaveBeenCalled();
  });

  it("does not retry a mutation with an ambiguous provider outcome", async () => {
    const { service, githubService, repository } = fixtures({
      createFixBranch: vi.fn(async () => {
        throw new Error("socket closed after request");
      }),
    });
    await expect(createBranch(service)).rejects.toMatchObject({
      status: 409,
      code: "OPERATION_OUTCOME_UNKNOWN",
    });
    await expect(createBranch(service)).rejects.toMatchObject({
      status: 409,
      code: "OPERATION_OUTCOME_UNKNOWN",
    });
    expect(githubService.createFixBranch).toHaveBeenCalledTimes(1);
    expect(repository.operations[0].status).toBe("uncertain");
  });

  it("returns an existing open pull request without creating a duplicate", async () => {
    const { service, githubService } = fixtures({
      listFixPullRequests: vi.fn(async () => [
        {
          number: 12,
          url: "https://github.com/org/repo/pull/12",
          state: "open",
          head: "fix/mobile-recovery",
          base: "main",
          title: "Fix recovery",
          draft: false,
        },
      ]),
    });
    await createBranch(service);
    const result = await service.createPullRequest({
      ...request,
      idempotencyKey: "pull-request-operation",
      head: "fix/mobile-recovery",
      base: "main",
      title: "Fix recovery",
      body: "",
      draft: false,
    });
    expect(result).toMatchObject({ number: 12, duplicate: true, state: "open" });
    expect(githubService.createFixPullRequest).not.toHaveBeenCalled();
  });

  it("rejects files over the byte limit before creating an operation", async () => {
    const { service, repository } = fixtures();
    await createBranch(service);
    await expect(
      service.commitFile({
        ...request,
        idempotencyKey: "oversized-commit-0001",
        branch: "fix/mobile-recovery",
        path: "src/index.js",
        content: "é".repeat(300_000),
        expectedSha: sha,
        commitMessage: "Large update",
      }),
    ).rejects.toMatchObject({ status: 422, code: "FILE_TOO_LARGE" });
    expect(repository.operations.filter((item) => item.operationType === "commit")).toHaveLength(0);
  });
});

import { createHash } from "node:crypto";
import { AppError } from "../../errors/app-error.js";

const maximumFileBytes = 512 * 1024;
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function utf8Size(value) {
  return Buffer.byteLength(value, "utf8");
}

export function validGitRef(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 255 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    [...value].some((character) => character.codePointAt(0) <= 32 || character.codePointAt(0) === 127) ||
    /[~^:?*\x5b\\]/.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"));
}

function resultFor(operation) {
  if (operation.operationType === "branch") {
    return {
      branch: operation.branchName,
      baseBranch: operation.baseBranch,
      baseSha: operation.baseSha,
      duplicate: Boolean(operation.resultMetadata?.duplicate),
    };
  }
  if (operation.operationType === "commit") {
    return {
      branch: operation.branchName,
      path: operation.filePath,
      contentSha: operation.contentSha,
      commitSha: operation.commitSha,
      duplicate: Boolean(operation.resultMetadata?.duplicate),
    };
  }
  return {
    number: operation.pullRequestNumber,
    url: operation.pullRequestUrl,
    state: operation.pullRequestState,
    head: operation.branchName,
    base: operation.baseBranch,
    title: operation.resultMetadata?.title || "",
    draft: Boolean(operation.resultMetadata?.draft),
    duplicate: Boolean(operation.resultMetadata?.duplicate),
  };
}

function safeError(error) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return {
    code: "GITHUB_UNAVAILABLE",
    message: "GitHub is temporarily unavailable",
    status: 502,
  };
}

function isUncertain(error) {
  return !error?.status || error.status >= 500;
}

function replay(operation, requestFingerprint) {
  if (operation.requestFingerprint !== requestFingerprint) {
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key was already used for a different request.",
    );
  }
  if (operation.status === "succeeded") return resultFor(operation);
  if (operation.status === "uncertain") {
    throw new AppError(
      409,
      "OPERATION_OUTCOME_UNKNOWN",
      "GitHub may have applied this change. Refresh repository state before retrying.",
    );
  }
  if (operation.status === "failed") {
    throw new AppError(
      operation.errorStatus || 409,
      operation.errorCode || "GITHUB_WRITE_FAILED",
      operation.errorMessage || "GitHub could not apply this change.",
    );
  }
  throw new AppError(
    409,
    "OPERATION_IN_PROGRESS",
    "This GitHub operation is still being processed.",
  );
}

export function createEditorService({ repository, githubService, clock = () => new Date() }) {
  async function perform({
    userId,
    repositoryId,
    operationType,
    idempotencyKey,
    requestId,
    requestFingerprint,
    fields,
    action,
    auditMetadata,
    mutate,
  }) {
    const { operation, created } = await repository.beginOperation({
      actorUserId: userId,
      repositoryId,
      operationType,
      idempotencyKey,
      requestFingerprint,
      status: "pending",
      requestId,
      ...fields,
      createdAt: clock(),
      updatedAt: clock(),
    });
    if (!created) return replay(operation, requestFingerprint);

    try {
      const result = await mutate();
      await repository.finishOperation({
        id: operation.id,
        status: "succeeded",
        action,
        requestId,
        metadata: { ...auditMetadata, status: "succeeded", ...result },
        values: {
          ...result,
          errorCode: null,
          errorMessage: null,
          resultMetadata: result.resultMetadata || {},
        },
      });
      const operationValues =
        typeof operation.get === "function"
          ? operation.get({ plain: true })
          : operation;
      return resultFor({
        ...operationValues,
        ...result,
        status: "succeeded",
      });
    } catch (error) {
      const failure = safeError(error);
      const status = isUncertain(error) ? "uncertain" : "failed";
      await repository.finishOperation({
        id: operation.id,
        status,
        action,
        requestId,
        metadata: {
          ...auditMetadata,
          status,
          errorCode: failure.code,
        },
        values: {
          errorCode: status === "uncertain" ? "OPERATION_OUTCOME_UNKNOWN" : failure.code,
          errorStatus: status === "uncertain" ? 409 : failure.status,
          errorMessage:
            status === "uncertain"
              ? "GitHub may have applied this change. Refresh repository state before retrying."
              : failure.message,
        },
      });
      if (status === "uncertain") {
        throw new AppError(
          409,
          "OPERATION_OUTCOME_UNKNOWN",
          "GitHub may have applied this change. Refresh repository state before retrying.",
        );
      }
      throw error;
    }
  }

  return {
    async createBranch(input) {
      if (
        !validGitRef(input.branch) ||
        !validGitRef(input.baseBranch) ||
        !shaPattern.test(input.baseSha)
      ) {
        throw new AppError(422, "INVALID_GIT_REF", "Branch details are invalid.");
      }
      if (input.branch === input.baseBranch) {
        throw new AppError(
          422,
          "INVALID_GIT_REF",
          "Choose a new branch name for the fix.",
        );
      }
      const requestFingerprint = fingerprint({
        type: "branch",
        repositoryId: input.repositoryId,
        branch: input.branch,
        baseBranch: input.baseBranch,
        baseSha: input.baseSha,
      });
      return perform({
        ...input,
        operationType: "branch",
        requestFingerprint,
        fields: {
          branchName: input.branch,
          baseBranch: input.baseBranch,
          baseSha: input.baseSha,
        },
        action: "repository_fix_branch_created",
        auditMetadata: {
          repositoryId: input.repositoryId,
          branch: input.branch,
          baseBranch: input.baseBranch,
          baseSha: input.baseSha,
        },
        mutate: async () => {
          const result = await githubService.createFixBranch({
            userId: input.userId,
            repositoryId: input.repositoryId,
            branch: input.branch,
            baseBranch: input.baseBranch,
            baseSha: input.baseSha,
            requestId: input.requestId,
          });
          return {
            branchName: result.branch,
            baseBranch: result.baseBranch,
            baseSha: result.baseSha,
            resultMetadata: { commitSha: result.commitSha },
          };
        },
      });
    },

    async commitFile(input) {
      const contentBytes = utf8Size(input.content);
      if (
        contentBytes > maximumFileBytes ||
        input.content.includes("\0") ||
        !shaPattern.test(input.expectedSha) ||
        !validGitRef(input.branch) ||
        !input.path ||
        input.path.length > 1024 ||
        input.path.startsWith("/") ||
        input.path.endsWith("/") ||
        input.path.includes("\\") ||
        input.path
          .split("/")
          .some((part) => !part || part === "." || part === "..")
      ) {
        throw new AppError(
          422,
          contentBytes > maximumFileBytes ? "FILE_TOO_LARGE" : "INVALID_FILE_CHANGE",
          contentBytes > maximumFileBytes
            ? "Files larger than 512 KiB cannot be committed."
            : "File change details are invalid.",
        );
      }
      if (!input.commitMessage.trim() || input.commitMessage.length > 200) {
        throw new AppError(
          422,
          "INVALID_COMMIT_MESSAGE",
          "Commit messages must be between 1 and 200 characters.",
        );
      }
      const fixBranch = await repository.findFixBranch({
        actorUserId: input.userId,
        repositoryId: input.repositoryId,
        branchName: input.branch,
      });
      if (!fixBranch || fixBranch.baseBranch === input.branch) {
        throw new AppError(
          404,
          "RESOURCE_NOT_FOUND",
          "The selected fix branch was not found.",
        );
      }
      const contentSha = createHash("sha256")
        .update(input.content, "utf8")
        .digest("hex");
      const requestFingerprint = fingerprint({
        type: "commit",
        repositoryId: input.repositoryId,
        branch: input.branch,
        path: input.path,
        expectedSha: input.expectedSha,
        contentSha,
        commitMessage: input.commitMessage,
      });
      return perform({
        ...input,
        operationType: "commit",
        requestFingerprint,
        fields: {
          branchName: input.branch,
          filePath: input.path,
          expectedFileSha: input.expectedSha,
          contentSha,
        },
        action: "repository_file_committed",
        auditMetadata: {
          repositoryId: input.repositoryId,
          branch: input.branch,
          path: input.path,
          expectedSha: input.expectedSha,
          contentSha,
          size: contentBytes,
        },
        mutate: () =>
          githubService.commitFixFile({
            userId: input.userId,
            repositoryId: input.repositoryId,
            branch: input.branch,
            path: input.path,
            content: input.content,
            expectedSha: input.expectedSha,
            commitMessage: input.commitMessage,
            requestId: input.requestId,
          }),
      });
    },

    async listPullRequests(input) {
      const fixBranch = await repository.findFixBranch({
        actorUserId: input.userId,
        repositoryId: input.repositoryId,
        branchName: input.head,
      });
      if (!fixBranch) {
        throw new AppError(404, "RESOURCE_NOT_FOUND", "Branch was not found.");
      }
      return githubService.listFixPullRequests({
        userId: input.userId,
        repositoryId: input.repositoryId,
        head: input.head,
        base: input.base || fixBranch.baseBranch,
        state: input.state,
        requestId: input.requestId,
      });
    },

    async createPullRequest(input) {
      const fixBranch = await repository.findFixBranch({
        actorUserId: input.userId,
        repositoryId: input.repositoryId,
        branchName: input.head,
      });
      if (!fixBranch || input.base !== fixBranch.baseBranch) {
        throw new AppError(
          404,
          "RESOURCE_NOT_FOUND",
          "The selected fix branch was not found.",
        );
      }
      const requestFingerprint = fingerprint({
        type: "pull_request",
        repositoryId: input.repositoryId,
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body || "",
        draft: Boolean(input.draft),
      });
      return perform({
        ...input,
        operationType: "pull_request",
        requestFingerprint,
        fields: { branchName: input.head, baseBranch: input.base },
        action: "repository_pull_request_created",
        auditMetadata: {
          repositoryId: input.repositoryId,
          head: input.head,
          base: input.base,
          draft: Boolean(input.draft),
        },
        mutate: async () => {
          const existing = await githubService.listFixPullRequests({
            userId: input.userId,
            repositoryId: input.repositoryId,
            head: input.head,
            base: input.base,
            state: "open",
            requestId: input.requestId,
          });
          const match = existing.find(
            (pullRequest) =>
              pullRequest.head === input.head && pullRequest.base === input.base,
          );
          if (match) {
            return {
              branchName: match.head,
              baseBranch: match.base,
              pullRequestNumber: match.number,
              pullRequestUrl: match.url,
              pullRequestState: match.state,
              resultMetadata: {
                duplicate: true,
                title: match.title,
                draft: match.draft,
              },
            };
          }
          const created = await githubService.createFixPullRequest({
            userId: input.userId,
            repositoryId: input.repositoryId,
            head: input.head,
            base: input.base,
            title: input.title,
            body: input.body || "",
            draft: Boolean(input.draft),
            requestId: input.requestId,
          });
          return {
            branchName: created.head,
            baseBranch: created.base,
            pullRequestNumber: created.number,
            pullRequestUrl: created.url,
            pullRequestState: created.state,
            resultMetadata: {
              title: created.title,
              draft: created.draft,
            },
          };
        },
      });
    },
  };
}

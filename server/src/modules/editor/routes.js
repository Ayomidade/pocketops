import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { createSessionAuthentication } from "../../middleware/authenticate.js";
import { validate } from "../../middleware/validate.js";
import { createEditorController } from "./controller.js";

const repositoryParams = z.object({ repositoryId: z.string().uuid() }).strict();
const branchBody = z
  .object({
    branch: z.string().min(1).max(255),
    baseBranch: z.string().min(1).max(255),
    baseSha: z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/),
  })
  .strict();
const commitBody = z
  .object({
    branch: z.string().min(1).max(255),
    path: z.string().min(1).max(1024),
    content: z.string().max(512 * 1024),
    expectedSha: z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/),
    commitMessage: z.string().trim().min(1).max(200),
  })
  .strict();
const pullRequestQuery = z
  .object({
    head: z.string().min(1).max(255),
    base: z.string().min(1).max(255).optional(),
    state: z.enum(["open", "closed", "all"]).default("open"),
  })
  .strict();
const pullRequestBody = z
  .object({
    head: z.string().min(1).max(255),
    base: z.string().min(1).max(255),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(4000).default(""),
    draft: z.boolean().default(false),
  })
  .strict();
const idempotencyHeaders = z.object({
  "idempotency-key": z.string().min(16).max(100),
});

function asyncHandler(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

export function createEditorRouter({ service, authService }) {
  const router = Router();
  const controller = service ? createEditorController(service) : null;
  const authenticate = createSessionAuthentication(authService);
  const mutations = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler(request, response) {
      return response.status(429).json({
        success: false,
        error: { code: "EDITOR_RATE_LIMITED", message: "Too many editor requests" },
        meta: { requestId: request.id },
      });
    },
  });
  const reads = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler(request, response) {
      return response.status(429).json({
        success: false,
        error: { code: "EDITOR_RATE_LIMITED", message: "Too many editor requests" },
        meta: { requestId: request.id },
      });
    },
  });

  function requireService(_request, _response, next) {
    if (!controller) {
      return next(
        new AppError(
          503,
          "EDITOR_NOT_CONFIGURED",
          "Repository editing is not configured.",
        ),
      );
    }
    return next();
  }

  router.post(
    "/repositories/:repositoryId/branches",
    requireService,
    mutations,
    authenticate,
    validate(repositoryParams, "params"),
    validate(branchBody),
    validate(idempotencyHeaders, "headers"),
    asyncHandler((request, response) => controller.createBranch(request, response)),
  );
  router.put(
    "/repositories/:repositoryId/file",
    requireService,
    mutations,
    authenticate,
    validate(repositoryParams, "params"),
    validate(commitBody),
    validate(idempotencyHeaders, "headers"),
    asyncHandler((request, response) => controller.commitFile(request, response)),
  );
  router.get(
    "/repositories/:repositoryId/pull-requests",
    requireService,
    reads,
    authenticate,
    validate(repositoryParams, "params"),
    validate(pullRequestQuery, "query"),
    asyncHandler((request, response) => controller.listPullRequests(request, response)),
  );
  router.post(
    "/repositories/:repositoryId/pull-requests",
    requireService,
    mutations,
    authenticate,
    validate(repositoryParams, "params"),
    validate(pullRequestBody),
    validate(idempotencyHeaders, "headers"),
    asyncHandler((request, response) => controller.createPullRequest(request, response)),
  );
  return router;
}

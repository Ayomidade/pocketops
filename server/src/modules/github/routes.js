import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { createSessionAuthentication } from "../../middleware/authenticate.js";
import { validate } from "../../middleware/validate.js";
import { createGitHubController } from "./controller.js";

const uuid = z.string().uuid();
const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const oauthCallbackSchema = z.object({
  state,
  code: z.string().max(2048).optional(),
  error: z.string().max(100).optional(),
});
const installationCallbackSchema = z.object({
  state,
  installation_id: z.string().regex(/^\d{1,20}$/),
  setup_action: z.enum(["install", "update"]),
});
const installationParams = z.object({ installationId: uuid });
const repositoryParams = z.object({ repositoryId: uuid });
const installationSchema = z.object({
  installationId: uuid,
  githubRepositoryIds: z
    .array(z.string().regex(/^\d{1,20}$/))
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
const repositoryQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(100).optional(),
});
const treeQuery = z.object({
  path: z.string().max(1024).optional(),
  ref: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (value) =>
        ![...value].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    )
    .optional(),
  cursor: z.string().max(500).optional(),
});
const fileQuery = z.object({
  path: z.string().max(1024),
  ref: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (value) =>
        ![...value].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    )
    .optional(),
});
const branchesQuery = z.object({ cursor: z.string().max(500).optional() });

function asyncHandler(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

function apiRateLimit(windowMs, limit, code) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler(request, response) {
      return response.status(429).json({
        success: false,
        error: { code, message: "Too many GitHub requests" },
        meta: { requestId: request.id },
      });
    },
  });
}

export function createGitHubRouter({ service, authService }) {
  const router = Router();
  const controller = service ? createGitHubController(service) : null;
  const authenticate = createSessionAuthentication(authService);
  const userRateLimit = apiRateLimit(60_000, 60, "GITHUB_RATE_LIMITED");
  const oauthRateLimit = apiRateLimit(
    15 * 60_000,
    10,
    "GITHUB_AUTH_RATE_LIMITED",
  );

  function requireService(_request, _response, next) {
    if (!controller) {
      return next(
        new AppError(
          503,
          "GITHUB_APP_NOT_CONFIGURED",
          "GitHub App integration is not configured",
        ),
      );
    }
    return next();
  }

  router.get(
    "/oauth/callback",
    requireService,
    oauthRateLimit,
    validate(oauthCallbackSchema, "query"),
    asyncHandler((request, response) =>
      controller.oauthCallback(request, response),
    ),
  );
  router.get(
    "/installations/callback",
    requireService,
    oauthRateLimit,
    validate(installationCallbackSchema, "query"),
    asyncHandler((request, response) =>
      controller.installationCallback(request, response),
    ),
  );
  router.post(
    "/installations/start",
    requireService,
    userRateLimit,
    authenticate,
    validate(z.object({}).strict()),
    asyncHandler((request, response) =>
      controller.startInstallation(request, response),
    ),
  );
  router.get(
    "/installations",
    requireService,
    userRateLimit,
    authenticate,
    asyncHandler((request, response) =>
      controller.installations(request, response),
    ),
  );
  router.get(
    "/installations/:installationId/repositories",
    requireService,
    userRateLimit,
    authenticate,
    validate(installationParams, "params"),
    asyncHandler((request, response) =>
      controller.installationRepositories(request, response),
    ),
  );
  router.post(
    "/installations/sync",
    requireService,
    userRateLimit,
    authenticate,
    validate(installationSchema),
    asyncHandler((request, response) =>
      controller.syncInstallation(request, response),
    ),
  );
  router.get(
    "/repositories",
    requireService,
    userRateLimit,
    authenticate,
    validate(repositoryQuery, "query"),
    asyncHandler((request, response) =>
      controller.repositories(request, response),
    ),
  );
  router.get(
    "/repositories/:repositoryId",
    requireService,
    userRateLimit,
    authenticate,
    validate(repositoryParams, "params"),
    asyncHandler((request, response) =>
      controller.repository(request, response),
    ),
  );
  router.get(
    "/repositories/:repositoryId/tree",
    requireService,
    userRateLimit,
    authenticate,
    validate(repositoryParams, "params"),
    validate(treeQuery, "query"),
    asyncHandler((request, response) => controller.tree(request, response)),
  );
  router.get(
    "/repositories/:repositoryId/file",
    requireService,
    userRateLimit,
    authenticate,
    validate(repositoryParams, "params"),
    validate(fileQuery, "query"),
    asyncHandler((request, response) => controller.file(request, response)),
  );
  router.get(
    "/repositories/:repositoryId/branches",
    requireService,
    userRateLimit,
    authenticate,
    validate(repositoryParams, "params"),
    validate(branchesQuery, "query"),
    asyncHandler((request, response) => controller.branches(request, response)),
  );
  return router;
}

export function createGitHubWebhookRouter({ service }) {
  const router = Router();
  const controller = service ? createGitHubController(service) : null;
  router.post(
    "/",
    apiRateLimit(60_000, 120, "WEBHOOK_RATE_LIMITED"),
    (request, _response, next) => {
      if (!controller) {
        return next(
          new AppError(
            503,
            "WEBHOOK_UNAVAILABLE",
            "GitHub webhook integration is not configured",
          ),
        );
      }
      if (!Buffer.isBuffer(request.body)) {
        return next(
          new AppError(
            400,
            "INVALID_WEBHOOK_BODY",
            "GitHub webhook body is invalid",
          ),
        );
      }
      return next();
    },
    asyncHandler((request, response) => controller.webhook(request, response)),
  );
  return router;
}

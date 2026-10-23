import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { createSessionAuthentication } from "../../middleware/authenticate.js";
import { validate } from "../../middleware/validate.js";
import { createAuthController } from "./controller.js";

const startSchema = z.object({
  redirectUri: z.string().url().max(500),
  completionSecret: z.string().regex(/^[a-f0-9]{64}$/i),
});
const stateSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const callbackSchema = stateSchema.extend({
  code: z.string().max(2048).optional(),
  error: z.string().max(100).optional(),
});
const exchangeSchema = z.object({
  handoffCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  completionSecret: z.string().regex(/^[a-f0-9]{64}$/i),
  deviceLabel: z.string().trim().max(100).optional(),
});
const rotateSchema = z.object({
  replacementToken: z.string().regex(/^(?:[A-Za-z0-9_-]{43}|[a-f0-9]{64})$/i),
});

function asyncHandler(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

function limited(windowMs, limit, code) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler(request, response) {
      return response.status(429).json({
        success: false,
        error: { code, message: "Too many sign-in requests" },
        meta: { requestId: request.id },
      });
    },
  });
}

export function createAuthRouter({ service }) {
  const router = Router();
  const controller = service ? createAuthController(service) : null;
  const oauthStartLimit = limited(15 * 60_000, 10, "AUTH_RATE_LIMITED");
  const oauthCallbackLimit = limited(15 * 60_000, 30, "AUTH_RATE_LIMITED");
  const sessionLimit = limited(60_000, 30, "AUTH_RATE_LIMITED");

  function requireService(_request, _response, next) {
    if (!controller) {
      return next(
        new AppError(
          503,
          "AUTH_UNAVAILABLE",
          "Authentication is temporarily unavailable",
        ),
      );
    }
    return next();
  }

  const authenticate = createSessionAuthentication(service);

  router.post(
    "/mobile/start",
    requireService,
    oauthStartLimit,
    validate(startSchema),
    asyncHandler((request, response) =>
      controller.mobileStart(request, response),
    ),
  );
  router.get(
    ["/github", "/github/start"],
    requireService,
    oauthStartLimit,
    validate(stateSchema, "query"),
    asyncHandler((request, response) =>
      controller.authorizationStart(request, response),
    ),
  );
  router.get(
    "/github/callback",
    requireService,
    oauthCallbackLimit,
    validate(callbackSchema, "query"),
    asyncHandler((request, response) => controller.callback(request, response)),
  );
  router.post(
    "/mobile/exchange",
    requireService,
    sessionLimit,
    validate(exchangeSchema),
    asyncHandler((request, response) => controller.exchange(request, response)),
  );
  router.get(
    "/me",
    requireService,
    sessionLimit,
    authenticate,
    (request, response) => controller.me(request, response),
  );
  router.post(
    "/session/rotate",
    requireService,
    sessionLimit,
    authenticate,
    validate(rotateSchema),
    asyncHandler((request, response) => controller.rotate(request, response)),
  );
  router.post(
    "/logout",
    requireService,
    sessionLimit,
    authenticate,
    asyncHandler((request, response) => controller.logout(request, response)),
  );

  return router;
}

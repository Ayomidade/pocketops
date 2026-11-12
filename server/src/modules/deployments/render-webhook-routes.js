import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { AppError } from "../../errors/app-error.js";

function asyncHandler(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

export function createRenderWebhookRouter({ service }) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  const controller = service ? service : null;
  router.post(
    "/",
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (req, res) =>
        res
          .status(429)
          .json({
            success: false,
            error: {
              code: "WEBHOOK_RATE_LIMITED",
              message: "Too many webhook requests.",
            },
            meta: { requestId: req.id },
          }),
    }),
    (request, _response, next) => {
      if (!controller) {
        return next(
          new AppError(
            503,
            "WEBHOOK_UNAVAILABLE",
            "Render webhook integration is not configured.",
          ),
        );
      }
      if (!Buffer.isBuffer(request.body)) {
        return next(
          new AppError(
            400,
            "INVALID_WEBHOOK_BODY",
            "Render webhook body is invalid.",
          ),
        );
      }
      return next();
    },
    asyncHandler(async (request, response) => {
      const result = await controller.acceptWebhook({
        rawBody: request.body,
        signature: request.get("webhook-signature"),
        deliveryId: request.get("webhook-id"),
        timestamp: request.get("webhook-timestamp"),
      });
      return response
        .status(202)
        .json({ success: true, data: result, meta: { requestId: request.id } });
    }),
  );
  return router;
}

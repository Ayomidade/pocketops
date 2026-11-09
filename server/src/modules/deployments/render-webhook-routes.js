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
    rateLimit(60_000, 120, "WEBHOOK_RATE_LIMITED"),
    (request, _response, next) => {
      if (!controller) {
        return next(
          new AppError(503, "WEBHOOK_UNAVAILABLE", "Render webhook integration is not configured."),
        );
      }
      if (!Buffer.isBuffer(request.body)) {
        return next(new AppError(400, "INVALID_WEBHOOK_BODY", "Render webhook body is invalid."));
      }
      return next();
    },
    asyncHandler(async (request, response) => {
      const result = await controller.acceptWebhook({
        rawBody: request.body,
        signature: request.get("webhook-signature"),
        deliveryId: request.get("webhook-delivery"),
        eventType: request.get("webhook-event"),
      });
      return response.status(202).json({ success: true, data: result, meta: { requestId: request.id } });
    }),
  );
  return router;
}
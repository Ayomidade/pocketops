import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";

const schema = z.object({
  type: z.string().regex(/^[a-z_]{1,80}$/),
  timestamp: z.string().datetime(),
  data: z.object({
    id: z.string().regex(/^evt-[A-Za-z0-9-]{1,80}$/),
    serviceId: z.string().regex(/^srv-[A-Za-z0-9-]{1,80}$/),
  }),
});
const supported = new Set([
  "build_ended",
  "deploy_ended",
  "server_failed",
  "server_available",
]);

// Standard Webhooks: bind the event ID, delivery timestamp and exact raw bytes.
// Signed hints schedule reconciliation; they never grant access or assert recovery.
export function createRenderWebhookService({
  repository,
  secret,
  clock = () => new Date(),
}) {
  const encoded =
    typeof secret === "string" ? secret.replace(/^whsec_/, "") : "";
  const key = Buffer.from(encoded, "base64");
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret || "") || key.length < 24)
    throw new AppError(
      503,
      "RENDER_NOT_CONFIGURED",
      "Configure the Render webhook signing secret.",
    );
  return {
    async acceptWebhook({ rawBody, signature, deliveryId, timestamp }) {
      const now = clock();
      if (
        !Buffer.isBuffer(rawBody) ||
        rawBody.length > 65536 ||
        !/^evt-[A-Za-z0-9-]{1,80}$/.test(deliveryId || "") ||
        !/^\d{10,12}$/.test(timestamp || "") ||
        Math.abs(+now / 1000 - Number(timestamp)) > 300 ||
        typeof signature !== "string" ||
        signature.length > 1000
      )
        throw new AppError(
          401,
          "INVALID_WEBHOOK_SIGNATURE",
          "Render webhook signature is invalid.",
        );
      const expected = createHmac("sha256", key)
        .update(`${deliveryId}.${timestamp}.`)
        .update(rawBody)
        .digest();
      const valid = signature.split(" ").some((part) => {
        const match = /^v1,([A-Za-z0-9+/]+={0,2})$/.exec(part);
        if (!match) return false;
        const value = Buffer.from(match[1], "base64");
        return (
          value.length === expected.length && timingSafeEqual(value, expected)
        );
      });
      if (!valid)
        throw new AppError(
          401,
          "INVALID_WEBHOOK_SIGNATURE",
          "Render webhook signature is invalid.",
        );
      let body;
      try {
        body = schema.parse(JSON.parse(rawBody.toString("utf8")));
      } catch {
        throw new AppError(
          400,
          "INVALID_WEBHOOK_BODY",
          "Render webhook body is invalid.",
        );
      }
      if (
        body.data.id !== deliveryId ||
        Date.parse(body.timestamp) > +now + 300000
      )
        throw new AppError(
          400,
          "INVALID_WEBHOOK_BODY",
          "Render webhook event identity is invalid.",
        );
      if (!supported.has(body.type))
        return { accepted: true, duplicate: false, ignored: true };
      return repository.queueProviderEvent({
        eventId: deliveryId,
        serviceId: body.data.serviceId,
        observedAt: new Date(body.timestamp),
        receivedAt: now,
      });
    },
  };
}

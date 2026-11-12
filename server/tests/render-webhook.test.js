import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createRenderWebhookService } from "../src/modules/deployments/render-webhook.js";
import { createApp } from "../src/app.js";
const key = Buffer.alloc(32, 7),
  secret = `whsec_${key.toString("base64")}`;
const now = new Date("2026-11-09T12:00:00Z"),
  deliveryId = "evt-test-event";
function input(changes = {}) {
  const rawBody = Buffer.from(
    JSON.stringify({
      type: "deploy_ended",
      timestamp: now.toISOString(),
      data: { id: deliveryId, serviceId: "srv-fixture", status: "failed" },
      ...changes,
    }),
  );
  const timestamp = String(+now / 1000);
  return {
    rawBody,
    timestamp,
    deliveryId,
    signature: `v1,${createHmac("sha256", key).update(`${deliveryId}.${timestamp}.`).update(rawBody).digest("base64")}`,
  };
}
function setup() {
  const repository = {
    queueProviderEvent: vi.fn(async () => ({
      accepted: true,
      duplicate: false,
      ignored: false,
    })),
  };
  return {
    repository,
    service: createRenderWebhookService({
      repository,
      secret,
      clock: () => now,
    }),
  };
}
describe("Render Standard Webhooks", () => {
  it("verifies documented signed headers and schedules reconciliation, never a direct incident mutation", async () => {
    const { service, repository } = setup();
    expect(await service.acceptWebhook(input())).toEqual({
      accepted: true,
      duplicate: false,
      ignored: false,
    });
    expect(repository.queueProviderEvent).toHaveBeenCalledWith({
      eventId: deliveryId,
      serviceId: "srv-fixture",
      observedAt: now,
      receivedAt: now,
    });
  });
  it.each([
    { signature: "t=1,v1=bad" },
    { signature: undefined },
    { deliveryId: "evt-replayed" },
    { timestamp: String(+now / 1000 - 301) },
    { timestamp: String(+now / 1000 + 301) },
    { rawBody: Buffer.from("tampered") },
    { rawBody: Buffer.alloc(65537) },
  ])(
    "rejects forgery, replay, future timestamp and oversized messages: %j",
    async (change) => {
      const { service, repository } = setup();
      await expect(
        service.acceptWebhook({ ...input(), ...change }),
      ).rejects.toMatchObject({ status: 401 });
      expect(repository.queueProviderEvent).not.toHaveBeenCalled();
    },
  );
  it("rejects signed invalid data and ignores unsupported events", async () => {
    const { service, repository } = setup();
    await expect(
      service.acceptWebhook(
        input({ data: { id: "evt-other", serviceId: "srv-fixture" } }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await service.acceptWebhook(input({ type: "postgres_created" })),
    ).toMatchObject({ ignored: true });
    expect(repository.queueProviderEvent).not.toHaveBeenCalled();
  });
  it("supports multiple versioned signatures and propagates durable deduplication", async () => {
    const { service, repository } = setup();
    repository.queueProviderEvent.mockResolvedValue({
      accepted: true,
      duplicate: true,
      ignored: false,
    });
    const signed = input();
    expect(
      await service.acceptWebhook({
        ...signed,
        signature: `v1,YmFk ${signed.signature}`,
      }),
    ).toMatchObject({ duplicate: true });
  });
  it("uses raw JSON and documented headers on the public route; 202 is scheduled only", async () => {
    const { service } = setup(),
      signed = input();
    const app = createApp({
      config: { nodeEnv: "test", corsOrigins: [], logLevel: "silent" },
      renderWebhookService: service,
    });
    const result = await request(app)
      .post("/api/v1/webhooks/render")
      .set("Content-Type", "application/json")
      .set("webhook-id", signed.deliveryId)
      .set("webhook-timestamp", signed.timestamp)
      .set("webhook-signature", signed.signature)
      .send(signed.rawBody.toString());
    expect(result.status).toBe(202);
    expect(result.body.data).toEqual({
      accepted: true,
      duplicate: false,
      ignored: false,
    });
    expect((await request(app).get("/health")).status).toBe(200);
  });
  it("leaves health available without optional webhook configuration", async () => {
    const app = createApp({
      config: { nodeEnv: "test", corsOrigins: [], logLevel: "silent" },
    });
    expect((await request(app).get("/health")).status).toBe(200);
    expect(
      (await request(app).post("/api/v1/webhooks/render").send({})).status,
    ).toBe(503);
  });
});

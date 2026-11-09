import { describe, expect, it, vi } from "vitest";
import { createRenderWebhookService } from "../src/modules/deployments/render-webhook.js";

const secret = "render_webhook_secret_fixture";
const deliveryId = "whd-fixture-0000000001";
const projectId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";

async function makeSignature(rawBody, secret) {
  const crypto = await import("node:crypto");
  return `t=${Date.now()},v1=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function makeWebhookBody(status = "build_failed") {
  return JSON.stringify({ event: "deploy", payload: { deploy: { id: "dep-fixture", service_id: "srv-fixture", status, commit: { id: "a".repeat(40) } } } });
}

function setup({ findProjectByServiceId, upsertRenderWebhookDelivery, findOpenAutomaticIncident, createAutomatic }) {
  const repository = {
    findProjectByServiceId: vi.fn(findProjectByServiceId || (() => null)),
    upsertRenderWebhookDelivery: vi.fn(upsertRenderWebhookDelivery || (() => ({ duplicate: false, ignored: false }))),
    findOpenAutomaticIncident: vi.fn(findOpenAutomaticIncident || (() => null)),
    recordIncidentObservation: vi.fn(async () => {}),
  };
  const incidentService = { createAutomatic: vi.fn(createAutomatic || (async () => ({ id: "inc-fixture" }))) };
  const service = createRenderWebhookService({ repository, incidentService, secret });
  return { service, repository, incidentService };
}

describe("Render webhook service", () => {
  it("rejects invalid signature", async () => {
    const { service } = setup({});
    await expect(service.acceptWebhook({ rawBody: Buffer.from(makeWebhookBody()), signature: "t=1,v1=bad", deliveryId, eventType: "deploy" })).rejects.toMatchObject({ code: "INVALID_WEBHOOK_SIGNATURE", status: 401 });
  });

  it("rejects missing signature", async () => {
    const { service } = setup({});
    await expect(service.acceptWebhook({ rawBody: Buffer.from(makeWebhookBody()), signature: null, deliveryId, eventType: "deploy" })).rejects.toMatchObject({ code: "INVALID_WEBHOOK_SIGNATURE", status: 401 });
  });

  it("rejects invalid event type", async () => {
    const { service } = setup({});
    const sig = await makeSignature(makeWebhookBody(), secret);
    await expect(service.acceptWebhook({ rawBody: Buffer.from(makeWebhookBody()), signature: sig, deliveryId, eventType: "invalid_event!" })).rejects.toMatchObject({ code: "INVALID_WEBHOOK_EVENT", status: 400 });
  });

  it("rejects invalid delivery ID", async () => {
    const { service } = setup({});
    const sig = await makeSignature(makeWebhookBody(), secret);
    await expect(service.acceptWebhook({ rawBody: Buffer.from(makeWebhookBody()), signature: sig, deliveryId: "invalid delivery!", eventType: "deploy" })).rejects.toMatchObject({ code: "INVALID_WEBHOOK_DELIVERY", status: 400 });
  });

  it("rejects invalid JSON body", async () => {
    const { service } = setup({});
    const sig = await makeSignature(Buffer.from("not json"), secret);
    await expect(service.acceptWebhook({ rawBody: Buffer.from("not json"), signature: sig, deliveryId, eventType: "deploy" })).rejects.toMatchObject({ code: "INVALID_WEBHOOK_BODY", status: 400 });
  });

  it("ignores unsupported event types", async () => {
    const { service } = setup({});
    const body = JSON.stringify({ event: "ping", payload: {} });
    const sig = await makeSignature(body, secret);
    const result = await service.acceptWebhook({ rawBody: Buffer.from(body), signature: sig, deliveryId, eventType: "ping" });
    expect(result.ignored).toBe(true);
    expect(result.accepted).toBe(true);
  });

  it("ignores unknown projects", async () => {
    const { service, repository } = setup({ findProjectByServiceId: () => null });
    const sig = await makeSignature(makeWebhookBody(), secret);
    const result = await service.acceptWebhook({ rawBody: Buffer.from(makeWebhookBody()), signature: sig, deliveryId, eventType: "deploy" });
    expect(result.reason).toBe("project_not_found");
    expect(repository.findOpenAutomaticIncident).not.toHaveBeenCalled();
  });

  it("ignores non-failure statuses", async () => {
    const { service, repository } = setup({ findProjectByServiceId: () => ({ id: projectId, userId }) });
    const sig = await makeSignature(makeWebhookBody("live"), secret);
    const result = await service.acceptWebhook({ rawBody: Buffer.from(makeWebhookBody("live")), signature: sig, deliveryId, eventType: "deploy" });
    expect(result.reason).toBe("not_a_failure");
    expect(repository.findOpenAutomaticIncident).not.toHaveBeenCalled();
  });

  it("creates automatic incident for failed deploy", async () => {
    const project = { id: projectId, userId };
    const incident = { id: "inc-auto", projectId, automatic: true };
    const { service, repository, incidentService } = setup({
      findProjectByServiceId: () => project,
      findOpenAutomaticIncident: () => null,
      createAutomatic: async () => incident,
    });
    const sig = await makeSignature(makeWebhookBody("build_failed"), secret);
    const result = await service.acceptWebhook({ rawBody: Buffer.from(makeWebhookBody("build_failed")), signature: sig, deliveryId, eventType: "deploy" });
    expect(result.incidentId).toBe("inc-auto");
    expect(result.duplicate).toBe(false);
    expect(incidentService.createAutomatic).toHaveBeenCalledWith({ userId, projectId, title: "Render deployment failed: srv-fixture", severity: "high", requestId: `render-webhook-${deliveryId}`, metadata: expect.objectContaining({ provider: "render", providerServiceId: "srv-fixture", status: "build_failed" }) });
    expect(repository.recordIncidentObservation).toHaveBeenCalledWith({ projectId, eventKey: "render_deploy_failed:srv-fixture", observedAt: expect.any(Date) });
  });

  it("skips when automatic incident exists", async () => {
    const project = { id: projectId, userId };
    const { service, incidentService } = setup({ findProjectByServiceId: () => project, findOpenAutomaticIncident: () => ({ id: "existing" }) });
    const sig = await makeSignature(makeWebhookBody("build_failed"), secret);
    const result = await service.acceptWebhook({ rawBody: Buffer.from(makeWebhookBody("build_failed")), signature: sig, deliveryId, eventType: "deploy" });
    expect(result.duplicate).toBe(true);
    expect(incidentService.createAutomatic).not.toHaveBeenCalled();
  });

  it("detects duplicate deliveries", async () => {
    const project = { id: projectId, userId };
    const { service } = setup({ findProjectByServiceId: () => project, findOpenAutomaticIncident: () => null, upsertRenderWebhookDelivery: () => ({ duplicate: true, ignored: false }) });
    const sig = await makeSignature(makeWebhookBody("build_failed"), secret);
    const result = await service.acceptWebhook({ rawBody: Buffer.from(makeWebhookBody("build_failed")), signature: sig, deliveryId, eventType: "deploy" });
    expect(result.duplicate).toBe(true);
  });
});
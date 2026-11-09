import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../../errors/app-error.js";

const supportedWebhookEvents = new Set(["deploy"]);
const failedStatuses = new Set(["build_failed", "pre_deploy_failed", "update_failed", "canceled"]);

function parseSignature(header) {
  if (typeof header !== "string") return null;
  const parts = {};
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key && value) parts[key] = value;
  }
  return parts.t && parts.v1 ? { t: parts.t, v1: parts.v1 } : null;
}

export function createRenderWebhookService({
  repository,
  incidentService,
  secret,
  clock = () => new Date(),
}) {
  if (!secret) {
    throw new AppError(503, "RENDER_NOT_CONFIGURED", "Render webhook secret is not configured.");
  }

  function verifySignature(rawBody, signatureHeader) {
    const parsed = parseSignature(signatureHeader);
    if (!parsed) return false;
    const expected = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    const provided = Buffer.from(parsed.v1, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (provided.length !== expectedBuf.length) return false;
    return timingSafeEqual(provided, expectedBuf);
  }

  async function upsertWebhookDelivery({ deliveryId, eventType, payload, now, ignored = false }) {
    try {
      return await repository.upsertRenderWebhookDelivery({
        deliveryId,
        eventType,
        payload,
        receivedAt: now,
        ignored,
      });
    } catch (error) {
      if (error?.name === "SequelizeUniqueConstraintError") {
        return { duplicate: true, ignored };
      }
      throw error;
    }
  }

  async function acceptWebhook({ rawBody, signature, deliveryId, eventType }) {
    if (!verifySignature(rawBody, signature)) {
      throw new AppError(401, "INVALID_WEBHOOK_SIGNATURE", "Render webhook signature is invalid.");
    }
    if (typeof eventType !== "string" || !/^[a-z_]{1,80}$/.test(eventType)) {
      throw new AppError(400, "INVALID_WEBHOOK_EVENT", "Render webhook event is invalid.");
    }
    if (typeof deliveryId !== "string" || deliveryId.length > 100 || !/^[A-Za-z0-9-]+$/.test(deliveryId)) {
      throw new AppError(400, "INVALID_WEBHOOK_DELIVERY", "Render webhook delivery is invalid.");
    }

    const now = clock();
    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new AppError(400, "INVALID_WEBHOOK_BODY", "Render webhook body is invalid.");
    }

    const created = await upsertWebhookDelivery({
      deliveryId,
      eventType,
      payload: body,
      now,
      ignored: !supportedWebhookEvents.has(eventType),
    });

    if (created.duplicate) {
      return { accepted: true, duplicate: true, ignored: created.ignored };
    }

    if (!supportedWebhookEvents.has(eventType)) {
      return { accepted: true, duplicate: false, ignored: true };
    }

    const deploy = body?.payload?.deploy || body?.deploy;
    if (!deploy || !deploy.service_id || !deploy.status) {
      return { accepted: true, duplicate: !!created.duplicate, ignored: true };
    }

    const status = String(deploy.status).toLowerCase();
    const isFailure = failedStatuses.has(status);

    const project = await repository.findProjectByServiceId(deploy.service_id);
    if (!project) {
      return { accepted: true, duplicate: !!created.duplicate, ignored: true, reason: "project_not_found" };
    }

    if (!isFailure) {
      return { accepted: true, duplicate: !!created.duplicate, ignored: true, reason: "not_a_failure" };
    }

    // Check for existing open automatic incident for this project to avoid duplicate incidents.
    const existing = await repository.findOpenAutomaticIncident(project.id);
    if (existing) {
      return { accepted: true, duplicate: true, ignored: true, reason: "automatic_incident_exists" };
    }

    const commitSha = deploy.commit?.id || null;
    const startedAt = deploy.started_at || null;
    const finishedAt = deploy.finished_at || null;

    const incident = await incidentService.createAutomatic({
      userId: project.userId,
      projectId: project.id,
      title: `Render deployment failed: ${deploy.service_id}`,
      severity: "high",
      requestId: `render-webhook-${deliveryId}`,
      metadata: {
        provider: "render",
        providerServiceId: deploy.service_id,
        providerDeploymentId: deploy.id || null,
        status,
        providerStatus: status,
        commitSha,
        startedAt,
        finishedAt,
        webhookDeliveryId: deliveryId,
      },
    });

    await repository.recordIncidentObservation({
      projectId: project.id,
      eventKey: `render_deploy_failed:${deploy.service_id}`,
      observedAt: now,
    });

    return {
      accepted: true,
      duplicate: false,
      ignored: false,
      incidentId: incident.id,
    };
  }

  return { acceptWebhook };
}
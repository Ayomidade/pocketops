import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../errors/app-error.js";
import { approvedOrigin } from "./health-adapter.js";
import { healthSummary } from "./policy.js";
const error = (status, code, message) => {
  throw new AppError(status, code, message);
};
const incidentDTO = (i) => ({
  id: i.id,
  projectId: i.projectId,
  title: i.title,
  severity: i.severity,
  status: i.status,
  version: i.version,
  automatic: i.automatic,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  resolvedAt: i.resolvedAt || null,
});
const eventDTO = (e) => ({
  id: e.id,
  actorId: e.actorId || null,
  type: e.eventType,
  metadata: e.metadata,
  createdAt: e.createdAt,
});
const deviceDTO = (d) => ({
  id: d.id,
  platform: d.platform,
  enabled: d.enabled,
});
const page = (rows, limit, dto, cursor = (r) => r.id) => ({
  items: rows.slice(0, limit).map(dto),
  nextCursor: rows.length > limit ? cursor(rows[limit - 1]) : null,
});
export function createIncidentService({
  repository: r,
  deployments,
  probe,
  push,
  vault,
  clock = () => new Date(),
}) {
  const authorize = (userId, id, requestId) =>
    deployments.incidentContext({ userId, id, requestId });
  async function access(userId, id, requestId) {
    const i = await r.find(userId, id);
    if (!i) error(404, "INCIDENT_NOT_FOUND", "Incident not found.");
    const project = await authorize(userId, i.projectId, requestId);
    return { i, project };
  }
  async function verifiedHealth(userId, id, requestId) {
    const ctx = await deployments.incidentContext({
      userId,
      id,
      requestId,
      inspect: true,
    });
    const origin = approvedOrigin(ctx.origin);
    const live = ctx.deployments
      .filter((d) => d.status === "live")
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    const rows = await r.health(id);
    const current = rows.every(
      (h) =>
        h.origin === origin &&
        h.deploymentReference === (live?.providerDeploymentId || null),
    );
    return {
      summary:
        current && origin
          ? healthSummary(rows, clock())
          : healthSummary([], clock()),
      origin,
      deploymentReference: live?.providerDeploymentId || null,
    };
  }
  return {
    async list({ userId, requestId, ...query }) {
      const rows = await r.list(userId, query);
      const visible = [];
      for (const i of rows.slice(0, query.limit)) {
        try {
          await authorize(userId, i.projectId, requestId);
          visible.push(i);
        } catch (e) {
          if (![403, 404, 409].includes(e.status)) throw e;
        }
      }
      return {
        items: visible.map(incidentDTO),
        nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
      };
    },
    async create(input) {
      await authorize(input.userId, input.projectId, input.requestId);
      const requestHash = createHash("sha256")
        .update(JSON.stringify([input.projectId, input.title, input.severity]))
        .digest("hex");
      return incidentDTO(await r.create({ ...input, requestHash }));
    },
    async createAutomatic({
      userId,
      projectId,
      title,
      severity,
      requestId,
      metadata,
    }) {
      const incident = await r.create({
        userId,
        projectId,
        title,
        severity,
        automatic: true,
        idempotencyKey: `auto:${projectId}:${title}`,
        requestHash: createHash("sha256")
          .update(JSON.stringify([projectId, title, severity, "automatic"]))
          .digest("hex"),
      });
      await r.event(
        incident,
        null,
        "incident.created_automatically",
        { source: "render_webhook", ...metadata },
        requestId,
      );
      return incidentDTO(incident);
    },
    async detail({ userId, id, requestId }) {
      const { i, project } = await access(userId, id, requestId);
      return {
        ...incidentDTO(i),
        repositoryId: project.repositoryId,
        health: (await verifiedHealth(userId, i.projectId, requestId)).summary,
        correlation:
          "Project association is confirmed; deployment causes and affected files require evidence.",
      };
    },
    async update(input) {
      await access(input.userId, input.id, input.requestId);
      return incidentDTO(await r.change(input.userId, input.id, input));
    },
    async resolve(input) {
      const { i } = await access(input.userId, input.id, input.requestId);
      const health = await verifiedHealth(
        input.userId,
        i.projectId,
        input.requestId,
      );
      if (health.summary.status !== "verified")
        error(
          409,
          "HEALTH_NOT_VERIFIED",
          "Recent observations must match the current provider origin and live revision.",
        );
      return incidentDTO(
        await r.change(input.userId, input.id, {
          ...input,
          status: "resolved",
          expectedOrigin: health.origin,
          expectedDeployment: health.deploymentReference,
        }),
      );
    },
    async timeline({ userId, id, requestId, limit, cursor }) {
      await access(userId, id, requestId);
      return page(
        await r.timeline(id, { limit, cursor }),
        limit,
        eventDTO,
        (r) =>
          Buffer.from(JSON.stringify({ id: r.id, time: r.createdAt })).toString(
            "base64url",
          ),
      );
    },
    async healthStatus({ userId, id, requestId }) {
      await authorize(userId, id, requestId);
      const monitor = await r.monitor(id);
      return {
        ...(await verifiedHealth(userId, id, requestId)).summary,
        enabled: !!monitor?.enabled,
        healthPath: monitor?.healthPath || "/health",
      };
    },
    async healthChecks({ userId, id, requestId, limit }) {
      await authorize(userId, id, requestId);
      return {
        items: (await r.health(id, limit)).map((h) => ({
          id: h.id,
          status: h.status,
          code: h.code,
          durationMs: h.durationMs,
          checkedAt: h.checkedAt,
          origin: h.origin || null,
          path: h.path,
          deploymentReference: h.deploymentReference || null,
        })),
      };
    },
    async configure(input) {
      const ctx = await deployments.incidentContext({
        userId: input.userId,
        id: input.id,
        requestId: input.requestId,
        inspect: true,
      });
      if (input.enabled && !approvedOrigin(ctx.origin))
        error(
          409,
          "HEALTH_TARGET_UNSUPPORTED",
          "Monitoring requires an active public Render web service with a verified onrender.com origin.",
        );
      await r.configure(input.userId, input.id, input);
      return {
        enabled: input.enabled,
        healthPath: input.healthPath,
        status: "unknown",
      };
    },
    preferences: ({ userId }) => r.preferences(userId),
    setPreferences: ({ userId, enabled }) => r.setPreferences(userId, enabled),
    async devices({ userId }) {
      return { items: (await r.devices(userId)).map(deviceDTO) };
    },
    async register({ userId, sessionId, token, platform }) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const prior = await r.findDeviceByHash(tokenHash);
      if (prior && prior.userId !== userId)
        error(
          409,
          "DEVICE_ALREADY_REGISTERED",
          "Device belongs to another account.",
        );
      const id = prior?.id || randomUUID();
      return deviceDTO(
        await r.register({
          id,
          userId,
          sessionId,
          tokenHash,
          platform,
          enabled: true,
          ...vault.seal(token, userId, id),
        }),
      );
    },
    revoke: ({ userId, id }) => r.revoke(userId, id),
    async processMonitor() {
      const monitor = await r.claimMonitor(clock());
      if (!monitor) return false;
      let disconnected = false;
      let health = {
          status: "unknown",
          code: "PROVIDER_UNAVAILABLE",
          durationMs: 0,
          origin: null,
          deploymentReference: null,
        },
        deployment = null;
      try {
        const ctx = await deployments.incidentContext({
          userId: monitor.userId,
          id: monitor.id,
          requestId: `monitor-${monitor.claimToken}`,
          inspect: true,
        });
        const recent = ctx.deployments
          .filter((d) => Number.isFinite(Date.parse(d.startedAt)))
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
        deployment = recent[0] || null;
        const live = recent.find((d) => d.status === "live");
        const origin = approvedOrigin(ctx.origin);
        health = {
          ...(await probe(origin, monitor.healthPath)),
          origin,
          deploymentReference: live?.providerDeploymentId || null,
        };
      } catch (e) {
        disconnected = [403, 404, 409].includes(e.status);
        if (disconnected) health.code = "ACCESS_UNAVAILABLE";
      }
      await r.recordObservation(monitor, {
        health,
        deployment,
        disconnected,
        at: clock(),
      });
      return true;
    },
    async processNotification() {
      const row = await r.claimNotification(clock());
      if (!row) return false;
      let result;
      try {
        const { device, incident, allowed } = await r.notificationContext(row);
        if (!allowed) {
          await r.finishNotification(row, { status: "canceled" });
          return true;
        }
        await authorize(device.userId, incident.projectId, `push-${row.id}`);
        if (row.status === "receipt") result = await push.receipt(row.ticketId);
        else {
          const [claimed] = await r.markSending(row);
          if (!claimed) return true;
          result = await push.send(
            vault.open(device),
            incident.id,
            row.eventId,
          );
        }
        if (result.code === "DEVICE_NOT_REGISTERED")
          await r.revoke(device.userId, device.id);
      } catch {
        result = { status: "error", code: "NOTIFICATION_UNAVAILABLE" };
      }
      const at = clock();
      const status =
        result.status === "ok"
          ? row.status === "receipt"
            ? "delivered"
            : "receipt"
          : result.ambiguous
            ? "unknown"
            : (result.retryable || result.status === "pending") &&
                row.attempts < 5
              ? row.status === "receipt"
                ? "receipt"
                : "pending"
              : "failed";
      await r.finishNotification(row, {
        status,
        errorCode: result.code || null,
        ...(result.id ? { ticketId: result.id } : {}),
        nextAttemptAt: new Date(
          +at +
            (status === "receipt"
              ? 900000
              : Math.min(300000, 15000 * 2 ** row.attempts)),
        ),
      });
      return true;
    },
  };
}

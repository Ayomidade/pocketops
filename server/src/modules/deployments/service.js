import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError } from "../../errors/app-error.js";

const fail = (status, code, message) => { throw new AppError(status, code, message); };
const connectionDTO = (c) => ({ id: c.id, provider: c.provider, displayName: c.displayName, status: c.status, revokedAt: c.revokedAt || null });
const projectDTO = (p) => ({ id: p.id, name: p.name, repositoryId: p.repositoryId, connectionId: p.connectionId, providerServiceId: p.providerServiceId, status: p.status });
const deploymentDTO = (d) => ({ id: d.id, projectId: d.projectId, providerDeploymentId: d.providerDeploymentId, status: d.status, providerStatus: d.providerStatus, commitSha: d.commitSha || null, startedAt: d.startedAt || null, finishedAt: d.finishedAt || null, healthStatus: "not_checked" });
const operationDTO = (o) => ({ operationId: o.id, projectId: o.projectId, action: o.action, status: o.status, deploymentId: o.deploymentId || null, providerReference: o.providerReference || null,
  targetDeploymentId: o.targetDeploymentId, commitSha: o.commitSha, errorCode: o.errorCode || null, healthStatus: "not_checked", reconciliationRequired: o.status === "unknown" });
const page = (items, limit, dto) => ({ items: items.slice(0, limit).map(dto), nextCursor: items.length > limit ? items[limit - 1].id : null });

export function createDeploymentService({ repository, githubService, adapter, vault, config, clock = () => new Date() }) {
  const signingKey = config.providerEncryptionKeys[config.providerActiveKeyVersion];
  async function connection(userId, id) {
    const c = await repository.findConnection(userId, id);
    if (!c) fail(404, "CONNECTION_NOT_FOUND", "Connection not found.");
    if (c.status !== "active") fail(409, "CONNECTION_DISCONNECTED", "Reconnect Render before continuing.");
    const token = vault.open(c);
    if (c.keyVersion !== config.providerActiveKeyVersion) await repository.rotateConnection(c.id, c.keyVersion, vault.seal(token, c.userId, c.id));
    return { c, token };
  }
  async function providerRead(c, task) {
    try { return await task(); } catch (error) {
      if (error.code === "RENDER_ACCESS_REVOKED") await repository.revokeConnection(c.userId, c.id, "render-access-revoked");
      throw error;
    }
  }
  async function context(userId, id, requestId) {
    const project = await repository.findProject(userId, id);
    if (!project) fail(404, "PROJECT_NOT_FOUND", "Project not found.");
    const { c, token } = await connection(userId, project.connectionId);
    const repo = await githubService.getRepository({ userId, repositoryId: project.repositoryId, requestId });
    const service = await providerRead(c, () => adapter.getService(token, project.providerServiceId));
    if (service.id !== project.providerServiceId || !service.repositoryFullName || service.repositoryFullName.toLowerCase() !== repo.fullName.toLowerCase()) fail(409, "PROJECT_MAPPING_CHANGED", "The service repository changed. Review the mapping in Render.");
    return { project, c, token, service };
  }
  async function target(ctx, targetDeploymentId) {
    const history = await providerRead(ctx.c, () => adapter.listDeployments(ctx.token, ctx.service.id, { limit: 20 }));
    const live = history.items.find((d) => d.status === "live");
    if (!ctx.service.capabilities.canRedeploy || !live?.commitSha) fail(409, "REDEPLOY_UNAVAILABLE", "Redeploy requires a supported Git-backed service with a known live commit.");
    if (targetDeploymentId && live.providerDeploymentId !== targetDeploymentId) fail(409, "DEPLOYMENT_TARGET_CHANGED", "The live deployment changed. Refresh and confirm again.");
    return live;
  }
  function fingerprint(input) { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }
  function assertReplay(op, hash) { if (op.requestHash !== hash) fail(409, "IDEMPOTENCY_CONFLICT", "This idempotency key belongs to a different request."); return operationDTO(op); }
  function signCursor(payload) {
    const body = Buffer.from(JSON.stringify({ ...payload, version: config.providerActiveKeyVersion, expiresAt: clock().getTime() + 5 * 60_000 })).toString("base64url");
    return `${body}.${createHmac("sha256", signingKey).update(body).digest("base64url")}`;
  }
  function parseCursor(cursor, expected) {
    try {
      const [body, signature, extra] = cursor.split(".");
      if (extra) throw new Error();
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      const key = config.providerEncryptionKeys[payload.version];
      const mac = createHmac("sha256", key).update(body).digest();
      const supplied = Buffer.from(signature, "base64url");
      if (supplied.length !== mac.length || !timingSafeEqual(mac, supplied) || payload.expiresAt < clock().getTime() ||
        Object.entries(expected).some(([k, v]) => payload[k] !== v) || !Number.isFinite(Date.parse(payload.from)) || !Number.isFinite(Date.parse(payload.to)) ||
        Date.parse(payload.from) < Date.parse(expected.originalFrom) || Date.parse(payload.to) > Date.parse(expected.originalTo) || Date.parse(payload.from) > Date.parse(payload.to)) throw new Error();
      return { from: payload.from, to: payload.to };
    } catch { fail(422, "INVALID_LOG_CURSOR", "Refresh the log window to continue."); }
  }
  return {
    async connect({ userId, apiKey, displayName, requestId }) {
      // A minimal read validates the key. Render API keys are account credentials, not OAuth scopes.
      await adapter.listServices(apiKey, { limit: 1 });
      const id = randomUUID();
      return connectionDTO(await repository.createConnection({ id, userId, provider: "render", displayName, status: "active", ...vault.seal(apiKey, userId, id) }, requestId));
    },
    async connections({ userId, limit = 20, cursor }) { return page(await repository.listConnections(userId, limit, cursor), limit, connectionDTO); },
    async disconnect({ userId, id, requestId }) { await repository.revokeConnection(userId, id, requestId); return { disconnected: true }; },
    async services({ userId, id, limit, cursor }) { const { c, token } = await connection(userId, id); return providerRead(c, () => adapter.listServices(token, { limit, cursor })); },
    async createProject({ userId, repositoryId, connectionId, providerServiceId, name, requestId }) {
      const { c, token } = await connection(userId, connectionId);
      const repo = await githubService.getRepository({ userId, repositoryId, requestId });
      const service = await providerRead(c, () => adapter.getService(token, providerServiceId));
      if (service.id !== providerServiceId || service.repositoryFullName?.toLowerCase() !== repo.fullName.toLowerCase()) fail(422, "REPOSITORY_SERVICE_MISMATCH", "Choose the GitHub repository connected to this Render service.");
      return projectDTO(await repository.createProject({ id: randomUUID(), userId, repositoryId, connectionId, providerServiceId, name, status: "active" }, requestId));
    },
    async projects({ userId, limit = 20, cursor, requestId }) {
      const rows = await repository.listProjects(userId, limit, cursor);
      const items = [];
      for (const p of rows.slice(0, limit)) {
        // A revoked GitHub repository must not be presented from cached project metadata.
        await githubService.getRepository({ userId, repositoryId: p.repositoryId, requestId });
        items.push(projectDTO(p));
      }
      return { items, nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    },
    async project({ userId, id, requestId }) {
      const ctx = await context(userId, id, requestId);
      let live = null;
      if (ctx.service.capabilities.canRedeploy) {
        try { live = await target(ctx); } catch (error) { if (error.code !== "REDEPLOY_UNAVAILABLE") throw error; }
      }
      const pending = await repository.activeOperation(id);
      return { ...projectDTO(ctx.project), service: ctx.service, capabilities: { ...ctx.service.capabilities, canRedeploy: !!live && config.deploymentsEnabled && !pending },
        pendingOperation: pending ? operationDTO(pending) : null,
        redeployTarget: live ? { providerDeploymentId: live.providerDeploymentId, commitSha: live.commitSha } : null, healthStatus: "not_checked" };
    },
    async updateProject({ userId, id, name, requestId }) { await context(userId, id, requestId); return projectDTO(await repository.updateProject(userId, id, name, requestId)); },
    async deployments({ userId, id, limit, cursor, requestId }) {
      const ctx = await context(userId, id, requestId);
      const list = await providerRead(ctx.c, () => adapter.listDeployments(ctx.token, ctx.service.id, { limit, cursor }));
      const items = [];
      for (const d of list.items) items.push(deploymentDTO(await repository.saveDeployment(id, d)));
      return { items, nextCursor: list.nextCursor };
    },
    async deployment({ userId, id, requestId }) {
      const d = await repository.findDeployment(id);
      if (!d) fail(404, "DEPLOYMENT_NOT_FOUND", "Deployment not found.");
      const ctx = await context(userId, d.projectId, requestId);
      const live = await providerRead(ctx.c, () => adapter.getDeployment(ctx.token, ctx.service.id, d.providerDeploymentId));
      return deploymentDTO(await repository.saveDeployment(d.projectId, live));
    },
    async logs({ userId, id, from, to, cursor, limit = 50, level, requestId }) {
      const ctx = await context(userId, id, requestId);
      if (!ctx.service.capabilities.supportsLogs) fail(409, "LOGS_UNSUPPORTED", "Runtime logs are unavailable for this service type.");
      const end = to || clock().toISOString(); const start = from || new Date(Date.parse(end) - 3600000).toISOString();
      if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) > clock().getTime() + 60000 || Date.parse(end) - Date.parse(start) > 3600000 || Date.parse(start) >= Date.parse(end)) fail(422, "INVALID_LOG_WINDOW", "Select an ordered log window of at most one hour.");
      const binding = { projectId: id, originalFrom: start, originalTo: end, level: level || "" };
      if (cursor && (!from || !to)) fail(422, "INVALID_LOG_CURSOR", "Keep the original time window when paging logs.");
      const window = cursor ? parseCursor(cursor, binding) : { from: start, to: end };
      const result = await providerRead(ctx.c, () => adapter.getLogs(ctx.token, ctx.service, { ...window, limit, level }));
      const next = result.nextWindow;
      const valid = next && Date.parse(next.from) >= Date.parse(start) && Date.parse(next.to) <= Date.parse(end) && Date.parse(next.from) <= Date.parse(next.to) && (next.from !== window.from || next.to !== window.to);
      return { items: result.items, nextCursor: valid ? signCursor({ ...binding, ...next }) : null, truncated: result.truncated, from: start, to: end, redactionNotice: "Common secrets are redacted; application logs can still contain sensitive information." };
    },
    async requestDeployment({ userId, id, action, target: requested, confirmation, idempotencyKey, requestId }) {
      if (!config.deploymentsEnabled) fail(503, "DEPLOYMENTS_DISABLED", "Deployment requests are disabled by the operator.");
      const ctx = await context(userId, id, requestId);
      if (action !== "redeploy" || confirmation !== "DEPLOY" || requested.serviceId !== ctx.service.id) fail(422, "INVALID_CONFIRMATION", "Confirm the exact service before requesting a deployment.");
      const hash = fingerprint({ projectId: id, action, target: requested, confirmation });
      const prior = await repository.findByKey(userId, idempotencyKey);
      if (prior) return assertReplay(prior, hash);
      const live = await target(ctx, requested.deploymentId);
      if (live.commitSha !== requested.commitSha) fail(409, "DEPLOYMENT_TARGET_CHANGED", "The target revision changed. Refresh and confirm again.");
      const { op } = await repository.enqueue({ id: randomUUID(), actorId: userId, projectId: id, action, idempotencyKey, requestHash: hash, targetDeploymentId: live.providerDeploymentId, commitSha: live.commitSha, status: "queued", requestId, nextAttemptAt: clock() });
      return assertReplay(op, hash);
    },
    async operation({ userId, id, requestId }) {
      const op = await repository.findOperation(userId, id);
      if (!op) fail(404, "OPERATION_NOT_FOUND", "Operation not found.");
      await context(userId, op.projectId, requestId);
      return operationDTO(op);
    },
    async processNext() {
      const now = clock(); const op = await repository.claim(now);
      if (!op) return false;
      let dispatched = op.status === "requesting";
      try {
        const ctx = await context(op.actorId, op.projectId, op.requestId);
        if (op.status === "accepted") {
          const d = await providerRead(ctx.c, () => adapter.getDeployment(ctx.token, ctx.service.id, op.providerReference));
          const done = ["live", "failed", "canceled"].includes(d.status);
          const exhausted = op.attempts >= 120;
          await repository.finish(op, { status: d.status === "live" ? "succeeded" : done ? "failed" : exhausted ? "unknown" : "accepted", errorCode: done ? null : exhausted ? "STATUS_VERIFICATION_TIMEOUT" : null, nextAttemptAt: new Date(now.getTime() + 15000) }, d, done ? "deployment.completed" : "deployment.progress");
          return true;
        }
        if (!config.deploymentsEnabled) fail(503, "DEPLOYMENTS_DISABLED", "Deployment requests are disabled.");
        const live = await target(ctx, op.targetDeploymentId);
        if (live.commitSha !== op.commitSha) fail(409, "DEPLOYMENT_TARGET_CHANGED", "Target changed.");
        if (!await repository.dispatch(op, ctx.c.id, clock())) return true;
        dispatched = true;
        const d = await adapter.requestDeployment(ctx.token, ctx.service.id, op.commitSha);
        await repository.finish(op, { status: "accepted", attempts: 0, errorCode: null, nextAttemptAt: new Date(clock().getTime() + 15000) }, d, "deployment.provider_accepted");
      } catch (error) {
        // A DB failure after provider acceptance is also ambiguous. Never resubmit.
        const ambiguous = dispatched && error.ambiguous !== false;
        const accepted = op.status === "accepted";
        const retry = !ambiguous && error.code !== "DEPLOYMENTS_DISABLED" && (error.retryable === true || (error.retryable === undefined && (error.status === 429 || error.status >= 500))) && op.attempts < (accepted ? 120 : 5);
        const status = ambiguous ? "unknown" : retry ? (accepted ? "accepted" : "queued") : accepted ? "unknown" : "failed";
        await repository.finish(op, { status, errorCode: ambiguous ? "PROVIDER_OUTCOME_UNKNOWN" : error instanceof AppError ? error.code : "DEPLOYMENT_PROCESSING_FAILED", nextAttemptAt: new Date(now.getTime() + Math.max(error.retryAfterMs || 0, Math.min(300000, 15000 * 2 ** Math.min(op.attempts, 5))) + Math.floor(Math.random() * 1000)) }, null, `deployment.${status}`);
      }
      return true;
    },
  };
}

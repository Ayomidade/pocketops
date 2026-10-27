import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { DeploymentProvider } from "./provider.js";
import { redactLog } from "./logs.js";

const providerId = z.string().regex(/^[a-z]+-[a-zA-Z0-9]+$/).max(100);
const stamp = z.string().datetime({ offset: true });
const serviceSchema = z.object({ id: providerId, name: z.string().max(1000), ownerId: providerId, type: z.string(), repo: z.string().optional().nullable(), branch: z.string().optional(), suspended: z.string().optional() });
const deploySchema = z.object({ id: providerId, status: z.string(), commit: z.object({ id: z.string().regex(/^[a-f0-9]{40,64}$/i) }).optional().nullable(), startedAt: stamp.optional().nullable(), finishedAt: stamp.optional().nullable() });
const statusMap = { created: "queued", build_in_progress: "building", pre_deploy_in_progress: "building", update_in_progress: "building", live: "live", deactivated: "canceled", build_failed: "failed", pre_deploy_failed: "failed", update_failed: "failed", canceled: "canceled" };
export function renderCapabilities(service) {
  return { canRedeploy: ["web_service", "private_service", "background_worker", "static_site"].includes(service.type) && service.suspended === "not_suspended" && !!service.repositoryFullName,
    canRollback: false, canPromote: false, supportsLogs: ["web_service", "private_service", "background_worker", "cron_job"].includes(service.type), supportsHealthVerification: false };
}
export function githubRepoName(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "").split("/");
    return parts.length === 3 && parts[1] && parts[2] ? `${parts[1]}/${parts[2]}` : null;
  } catch { return null; }
}
function serviceDTO(raw) {
  const s = serviceSchema.parse(raw);
  const dto = { id: s.id, name: s.name.slice(0, 100), ownerId: s.ownerId, type: s.type, branch: s.branch?.slice(0, 255) || null,
    repositoryFullName: githubRepoName(s.repo), suspended: s.suspended === "not_suspended" ? "not_suspended" : "suspended" };
  return { ...dto, capabilities: renderCapabilities(dto) };
}
function deploymentDTO(raw) {
  const d = deploySchema.parse(raw);
  return { providerDeploymentId: d.id, status: statusMap[d.status] || "unknown", providerStatus: statusMap[d.status] ? d.status : "unknown",
    commitSha: d.commit?.id || null, startedAt: d.startedAt || null, finishedAt: d.finishedAt || null, healthStatus: "not_checked" };
}
export class RenderAdapter extends DeploymentProvider {
  constructor({ fetchImpl = fetch, timeoutMs = 10000 } = {}) { super(); this.fetch = fetchImpl; this.timeoutMs = timeoutMs; }
  async call(token, path, { query = {}, body } = {}) {
    const mutation = body !== undefined;
    const url = new URL(`https://api.render.com/v1${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await this.fetch(url, { method: mutation ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(mutation ? { "Content-Type": "application/json" } : {}) },
        ...(mutation ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status;
        const error = new AppError(status === 401 || status === 403 ? 403 : status === 404 || status === 410 ? 404 : status === 429 ? 429 : 502,
          status === 401 || status === 403 ? "RENDER_ACCESS_REVOKED" : status === 429 ? "RENDER_RATE_LIMITED" : status === 404 || status === 410 ? "RENDER_RESOURCE_UNAVAILABLE" : "RENDER_REQUEST_FAILED", "Render could not complete the request.");
        error.ambiguous = mutation && status >= 500;
        error.retryable = status === 429 || status >= 500;
        throw error;
      }
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("Provider response limit"); } chunks.push(Buffer.from(value)); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      const error = new AppError(502, "RENDER_UNAVAILABLE", "Render is unavailable or returned an invalid response.");
      error.ambiguous = mutation; error.retryable = true; throw error;
    }
  }
  async normalize(task, mutation = false) {
    try { return await task(); } catch (cause) {
      if (cause instanceof AppError) throw cause;
      const error = new AppError(502, "RENDER_INVALID_RESPONSE", "Render returned incomplete metadata."); error.ambiguous = mutation; error.retryable = !mutation; throw error;
    }
  }
  listServices(token, { limit = 20, cursor } = {}) {
    return this.normalize(async () => {
      const rows = z.array(z.object({ service: serviceSchema, cursor: z.string().max(1000) })).max(100).parse(await this.call(token, "/services", { query: { limit, cursor, includePreviews: false } }));
      return { items: rows.map((r) => serviceDTO(r.service)), nextCursor: rows.length === limit ? rows.at(-1).cursor : null };
    });
  }
  getService(token, id) { return this.normalize(async () => serviceDTO(await this.call(token, `/services/${encodeURIComponent(id)}`))); }
  listDeployments(token, id, { limit = 20, cursor } = {}) {
    return this.normalize(async () => {
      const rows = z.array(z.object({ deploy: deploySchema, cursor: z.string().max(1000) })).max(100).parse(await this.call(token, `/services/${encodeURIComponent(id)}/deploys`, { query: { limit, cursor } }));
      return { items: rows.map((r) => deploymentDTO(r.deploy)), nextCursor: rows.length === limit ? rows.at(-1).cursor : null };
    });
  }
  getDeployment(token, serviceId, id) { return this.normalize(async () => deploymentDTO(await this.call(token, `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(id)}`))); }
  requestDeployment(token, serviceId, commitSha) {
    return this.normalize(async () => deploymentDTO(await this.call(token, `/services/${encodeURIComponent(serviceId)}/deploys`, { body: { commitId: commitSha, clearCache: "do_not_clear" } })), true);
  }
  getLogs(token, service, { from, to, limit = 50, level }) {
    return this.normalize(async () => {
      const raw = z.object({ logs: z.array(z.object({ id: z.string().max(200), message: z.string(), timestamp: stamp, labels: z.array(z.object({ name: z.string(), value: z.string() })) })).max(100), hasMore: z.boolean(), nextStartTime: stamp, nextEndTime: stamp }).parse(
        await this.call(token, "/logs", { query: { ownerId: service.ownerId, resource: service.id, startTime: from, endTime: to, direction: "backward", limit, level } }));
      const items = []; let bytes = 0;
      for (const log of raw.logs) {
        const resource = log.labels.find((l) => l.name === "resource")?.value;
        if (resource && resource !== service.id) throw new Error("Unexpected log resource");
        const item = { id: log.id, timestamp: log.timestamp, level: ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"].includes(log.labels.find((l) => l.name === "level")?.value) ? log.labels.find((l) => l.name === "level").value : "info", message: redactLog(log.message, [token]) };
        const length = Buffer.byteLength(JSON.stringify(item));
        if (bytes + length > 128 * 1024) return { items, nextWindow: null, truncated: true };
        bytes += length; items.push(item);
      }
      return { items, nextWindow: raw.hasMore ? { from: raw.nextStartTime, to: raw.nextEndTime } : null, truncated: false };
    });
  }
}

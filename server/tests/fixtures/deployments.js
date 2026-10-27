import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { AppError } from "../../src/errors/app-error.js";
import { credentialVault } from "../../src/modules/deployments/crypto.js";
import { createDeploymentService } from "../../src/modules/deployments/service.js";
export const ids = { user: "11111111-1111-4111-8111-111111111111", other: "22222222-2222-4222-8222-222222222222", connection: "33333333-3333-4333-8333-333333333333", project: "44444444-4444-4444-8444-444444444444", repository: "55555555-5555-4555-8555-555555555555" };
export const sha = "a".repeat(40);
export function deploymentFixture() {
  let now = new Date("2026-10-26T10:00:00.000Z");
  const config = { providerEncryptionKeys: { v1: Buffer.alloc(32, 7) }, providerActiveKeyVersion: "v1", deploymentsEnabled: true };
  const vault = credentialVault({ keys: config.providerEncryptionKeys, activeVersion: "v1" });
  const connection = { id: ids.connection, userId: ids.user, provider: "render", displayName: "Staging", status: "active", ...vault.seal("rnd_secret_fixture", ids.user, ids.connection) };
  const project = { id: ids.project, userId: ids.user, repositoryId: ids.repository, connectionId: ids.connection, providerServiceId: "srv-fixture", name: "Staging API", status: "active" };
  const service = { id: "srv-fixture", name: "Staging API", ownerId: "tea-fixture", type: "web_service", repositoryFullName: "test-org/sample", suspended: "not_suspended", capabilities: { canRedeploy: true, canRollback: false, canPromote: false, supportsLogs: true, supportsHealthVerification: false } };
  const live = { providerDeploymentId: "dep-current", status: "live", providerStatus: "live", commitSha: sha, startedAt: now.toISOString(), finishedAt: null, healthStatus: "not_checked" };
  const ops = new Map(); const deployments = new Map(); const audits = [];
  const repository = {
    findConnection: vi.fn(async (u, id) => u === ids.user && id === connection.id ? connection : null),
    listConnections: vi.fn(async (u) => u === ids.user ? [connection] : []),
    createConnection: vi.fn(async (v) => v), rotateConnection: vi.fn(),
    revokeConnection: vi.fn(async (u) => { if (u !== ids.user) throw new AppError(404, "CONNECTION_NOT_FOUND", "Connection not found."); connection.status = "revoked"; connection.encryptedCredentials = null; project.status = "disconnected"; }),
    findProject: vi.fn(async (u, id) => u === ids.user && id === project.id ? project : null), listProjects: vi.fn(async (u) => u === ids.user ? [project] : []),
    createProject: vi.fn(async (v) => v), updateProject: vi.fn(async (_u, _id, name) => ({ ...project, name })),
    findDeployment: vi.fn(async (id) => deployments.get(id)),
    saveDeployment: vi.fn(async (projectId, values) => { const row = { id: randomUUID(), projectId, ...values }; deployments.set(row.id, row); return row; }),
    activeOperation: vi.fn(async () => [...ops.values()].find((op) => !["succeeded", "failed"].includes(op.status))),
    findOperation: vi.fn(async (u, id) => ops.get(id)?.actorId === u ? ops.get(id) : null),
    findByKey: vi.fn(async (u, key) => [...ops.values()].find((op) => op.actorId === u && op.idempotencyKey === key)),
    enqueue: vi.fn(async (values) => { const prior = await repository.findByKey(values.actorId, values.idempotencyKey); if (prior) return { op: prior, created: false }; if (await repository.activeOperation()) throw new AppError(409, "DEPLOYMENT_ALREADY_PENDING", "Pending operation."); const op = { attempts: 0, ...values }; ops.set(op.id, op); audits.push("deployment.queued"); return { op, created: true }; }),
    claim: vi.fn(async (time) => { for (const op of ops.values()) {
      if (op.status === "requesting" && op.claimExpiresAt <= time) { op.status = "unknown"; audits.push("deployment.unknown"); }
      if (!["queued", "validating", "accepted"].includes(op.status) || op.nextAttemptAt > time || (op.claimExpiresAt && op.claimExpiresAt > time)) continue;
      op.status = op.status === "accepted" ? "accepted" : "validating"; op.claimToken = randomUUID(); op.claimExpiresAt = new Date(time.getTime() + 60000); op.attempts += 1;
      // Model instances are snapshots, not a reference to mutable persisted state.
      return { ...op };
    } return null; }),
    dispatch: vi.fn(async (op) => { Object.assign(ops.get(op.id), { status: "requesting" }); audits.push("deployment.requested"); return true; }),
    finish: vi.fn(async (op, values, d, action) => { const current = ops.get(op.id); Object.assign(current, values, { claimToken: null, claimExpiresAt: null });
      if (d) { const row = await repository.saveDeployment(op.projectId, d); Object.assign(current, { providerReference: d.providerDeploymentId, deploymentId: row.id }); } audits.push(action); return current; }),
  };
  const adapter = { listServices: vi.fn(async () => ({ items: [service], nextCursor: null })), getService: vi.fn(async () => service),
    listDeployments: vi.fn(async () => ({ items: [live], nextCursor: null })), getDeployment: vi.fn(async () => ({ ...live, providerDeploymentId: "dep-new", status: "building", providerStatus: "build_in_progress" })),
    requestDeployment: vi.fn(async () => ({ ...live, providerDeploymentId: "dep-new", status: "queued", providerStatus: "created" })),
    getLogs: vi.fn(async () => ({ items: [{ id: "log-1", message: "safe", timestamp: now.toISOString(), level: "info" }], nextWindow: null, truncated: false })) };
  const githubService = { getRepository: vi.fn(async () => ({ id: ids.repository, fullName: "test-org/sample" })) };
  const app = createDeploymentService({ repository, adapter, vault, config, githubService, clock: () => new Date(now) });
  const input = { userId: ids.user, id: ids.project, action: "redeploy", confirmation: "DEPLOY", target: { serviceId: "srv-fixture", deploymentId: "dep-current", commitSha: sha }, idempotencyKey: "a-valid-idempotency-key", requestId: "request-fixture" };
  return { app, repository, adapter, githubService, vault, connection, project, service, live, config, input, ops, audits, advance(ms) { now = new Date(now.getTime() + ms); } };
}

import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors/app-error.js";
import { credentialVault } from "../src/modules/deployments/crypto.js";
import { deploymentFixture, ids } from "./fixtures/deployments.js";

function providerError(status = 502, ambiguous = true) { const error = new AppError(status, "RENDER_UNAVAILABLE", "Safe provider error"); error.ambiguous = ambiguous; error.retryable = true; return error; }
describe("Render connection and deployment services", () => {
  it("binds authenticated encryption to owner, connection and key version and supports rotation", () => {
    const f = deploymentFixture();
    expect(f.connection.encryptedCredentials).not.toContain("rnd_secret_fixture");
    expect(f.vault.open(f.connection)).toBe("rnd_secret_fixture");
    for (const change of [{ userId: ids.other }, { id: ids.other }, { keyVersion: "missing" }, { encryptedCredentials: "broken" }]) expect(() => f.vault.open({ ...f.connection, ...change })).toThrow(/Reconnect/);
    const newVault = credentialVault({ keys: { ...f.config.providerEncryptionKeys, v2: Buffer.alloc(32, 9) }, activeVersion: "v2" });
    expect(newVault.open(f.connection)).toBe("rnd_secret_fixture");
    const rotated = newVault.seal(newVault.open(f.connection), ids.user, ids.connection);
    expect(rotated.keyVersion).toBe("v2"); expect(newVault.open({ ...f.connection, ...rotated })).toBe("rnd_secret_fixture");
  });
  it("validates credentials before storage and never returns credentials or ciphertext", async () => {
    const f = deploymentFixture();
    f.adapter.listServices.mockRejectedValueOnce(new AppError(403, "RENDER_ACCESS_REVOKED", "Invalid key"));
    await expect(f.app.connect({ userId: ids.user, apiKey: "rnd_invalid_key", displayName: "Test", requestId: "connect" })).rejects.toMatchObject({ status: 403 });
    expect(f.repository.createConnection).not.toHaveBeenCalled();
    const result = await f.app.connect({ userId: ids.user, apiKey: "rnd_secret_fixture", displayName: "Test", requestId: "connect" });
    expect(JSON.stringify(result)).not.toMatch(/secret|encrypted|keyVersion/);
    const stored = f.repository.createConnection.mock.calls[0][0]; expect(stored.encryptedCredentials).toBeTruthy(); expect(f.vault.open(stored)).toBe("rnd_secret_fixture");
  });
  it("denies cross-user connection, project, deployment and operation guessing before provider access", async () => {
    const f = deploymentFixture(); const accepted = await f.app.requestDeployment(f.input);
    const d = await f.repository.saveDeployment(ids.project, f.live);
    for (const [name, id] of [["services", ids.connection], ["project", ids.project], ["updateProject", ids.project], ["deployments", ids.project], ["logs", ids.project], ["requestDeployment", ids.project], ["deployment", d.id], ["operation", accepted.operationId]]) {
      await expect(f.app[name]({ ...f.input, userId: ids.other, id })).rejects.toMatchObject({ status: 404 });
    }
    await expect(f.app.disconnect({ userId: ids.other, id: ids.connection })).rejects.toMatchObject({ status: 404 });
  });
  it("checks current repository access and exact provider mapping on each operation", async () => {
    const f = deploymentFixture(); f.service.repositoryFullName = "other/private";
    await expect(f.app.project(f.input)).rejects.toMatchObject({ code: "PROJECT_MAPPING_CHANGED" });
    await expect(f.app.createProject({ userId: ids.user, connectionId: ids.connection, providerServiceId: "srv-fixture", repositoryId: ids.repository })).rejects.toMatchObject({ code: "REPOSITORY_SERVICE_MISMATCH" });
    f.githubService.getRepository.mockRejectedValue(new AppError(404, "RESOURCE_NOT_FOUND", "Access revoked"));
    await expect(f.app.projects(f.input)).rejects.toMatchObject({ status: 404 });
  });
  it("revokes bad credentials, erases stored key and disconnects mapped projects", async () => {
    const f = deploymentFixture(); f.adapter.getService.mockRejectedValue(new AppError(403, "RENDER_ACCESS_REVOKED", "Revoked"));
    await expect(f.app.project(f.input)).rejects.toMatchObject({ status: 403 });
    expect(f.connection.status).toBe("revoked"); expect(f.connection.encryptedCredentials).toBeNull(); expect(f.project.status).toBe("disconnected");
    await expect(f.app.logs(f.input)).rejects.toMatchObject({ code: "CONNECTION_DISCONNECTED" }); expect(f.adapter.getLogs).not.toHaveBeenCalled();
  });
  it("queues and audits one request, rejects key reuse with a different target and does not deploy in the HTTP request", async () => {
    const f = deploymentFixture(); const first = await f.app.requestDeployment(f.input); const replay = await f.app.requestDeployment(f.input);
    expect(first).toEqual(replay); expect(first.status).toBe("queued"); expect(first.healthStatus).toBe("not_checked");
    expect(f.adapter.requestDeployment).not.toHaveBeenCalled(); expect(f.ops.size).toBe(1); expect(f.audits).toEqual(["deployment.queued"]);
    await expect(f.app.requestDeployment({ ...f.input, target: { ...f.input.target, commitSha: "b".repeat(40) } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(f.app.requestDeployment({ ...f.input, idempotencyKey: "a-second-request-key" })).rejects.toMatchObject({ code: "DEPLOYMENT_ALREADY_PENDING" });
  });
  it("requires exact confirmation, supported capability and unchanged live commit", async () => {
    const f = deploymentFixture();
    await expect(f.app.requestDeployment({ ...f.input, confirmation: "yes" })).rejects.toMatchObject({ status: 422 });
    await expect(f.app.requestDeployment({ ...f.input, target: { ...f.input.target, deploymentId: "dep-older" } })).rejects.toMatchObject({ code: "DEPLOYMENT_TARGET_CHANGED" });
    f.service.capabilities.canRedeploy = false;
    await expect(f.app.requestDeployment(f.input)).rejects.toMatchObject({ code: "REDEPLOY_UNAVAILABLE" });
    f.config.deploymentsEnabled = false; await expect(f.app.requestDeployment(f.input)).rejects.toMatchObject({ code: "DEPLOYMENTS_DISABLED" });
  });
  it("separates provider acceptance, deployment progress, live and unverified health", async () => {
    const f = deploymentFixture(); const result = await f.app.requestDeployment(f.input);
    await f.app.processNext(); let op = await f.app.operation({ ...f.input, id: result.operationId });
    expect(op.status).toBe("accepted"); expect(op.healthStatus).toBe("not_checked"); expect(f.adapter.requestDeployment).toHaveBeenCalledTimes(1);
    f.advance(16000); await f.app.processNext(); op = await f.app.operation({ ...f.input, id: result.operationId }); expect(op.status).toBe("accepted");
    f.adapter.getDeployment.mockResolvedValue({ ...f.live, providerDeploymentId: "dep-new" }); f.advance(16000); await f.app.processNext();
    op = await f.app.operation({ ...f.input, id: result.operationId }); expect(op.status).toBe("succeeded"); expect(op.healthStatus).toBe("not_checked");
    expect(f.adapter.requestDeployment).toHaveBeenCalledTimes(1); expect(f.audits).toEqual(expect.arrayContaining(["deployment.queued", "deployment.requested", "deployment.provider_accepted", "deployment.progress", "deployment.completed"]));
  });
  it("retries safe preflight reads with backoff and revalidates revocation before dispatch", async () => {
    const f = deploymentFixture(); await f.app.requestDeployment(f.input);
    f.adapter.getService.mockRejectedValueOnce(providerError()); await f.app.processNext();
    expect([...f.ops.values()][0].status).toBe("queued"); expect(f.adapter.requestDeployment).not.toHaveBeenCalled();
    expect(await f.app.processNext()).toBe(false);
    f.advance(31000); f.githubService.getRepository.mockRejectedValueOnce(new AppError(404, "RESOURCE_NOT_FOUND", "Revoked")); await f.app.processNext();
    expect([...f.ops.values()][0].status).toBe("failed"); expect(f.adapter.requestDeployment).not.toHaveBeenCalled();
  });
  it.each([true, false])("handles ambiguous=%s write response without duplicating accepted requests", async (ambiguous) => {
    const f = deploymentFixture(); await f.app.requestDeployment(f.input);
    f.adapter.requestDeployment.mockRejectedValueOnce(providerError(ambiguous ? 502 : 429, ambiguous)); await f.app.processNext();
    expect([...f.ops.values()][0].status).toBe(ambiguous ? "unknown" : "queued");
    f.advance(31000); await f.app.processNext(); expect(f.adapter.requestDeployment).toHaveBeenCalledTimes(ambiguous ? 1 : 2);
  });
  it("turns an expired dispatched claim into unknown after restart instead of issuing another deploy", async () => {
    const f = deploymentFixture(); await f.app.requestDeployment(f.input);
    const op = [...f.ops.values()][0]; Object.assign(op, { status: "requesting", claimExpiresAt: new Date(0) });
    expect(await f.app.processNext()).toBe(false); expect(op.status).toBe("unknown"); expect(f.adapter.requestDeployment).not.toHaveBeenCalled();
  });
  it("bounds log windows and binds signed pagination to project, time window and level", async () => {
    const f = deploymentFixture();
    await expect(f.app.logs({ ...f.input, from: "2026-10-25T00:00:00Z", to: "2026-10-26T00:00:00Z" })).rejects.toMatchObject({ code: "INVALID_LOG_WINDOW" });
    const window = { from: "2026-10-26T09:00:00.000Z", to: "2026-10-26T10:00:00.000Z" };
    f.adapter.getLogs.mockResolvedValue({ items: [], nextWindow: { from: window.from, to: "2026-10-26T09:30:00.000Z" }, truncated: false });
    const first = await f.app.logs({ ...f.input, ...window }); expect(first.nextCursor).toBeTruthy();
    await f.app.logs({ ...f.input, ...window, cursor: first.nextCursor });
    expect(f.adapter.getLogs).toHaveBeenLastCalledWith(expect.any(String), f.service, expect.objectContaining({ to: "2026-10-26T09:30:00.000Z" }));
    for (const change of [{ cursor: `${first.nextCursor}a` }, { level: "error", cursor: first.nextCursor }, { to: "2026-10-26T09:59:00.000Z", cursor: first.nextCursor }]) await expect(f.app.logs({ ...f.input, ...window, ...change })).rejects.toMatchObject({ code: "INVALID_LOG_CURSOR" });
    f.advance(6 * 60_000); await expect(f.app.logs({ ...f.input, ...window, cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_LOG_CURSOR" });
  });
});

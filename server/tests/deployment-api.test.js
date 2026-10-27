import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { deploymentFixture, ids } from "./fixtures/deployments.js";
const token = "t".repeat(43);
function appFor(f, userId = ids.user) { return createApp({ config: { nodeEnv: "test", corsOrigins: [], logLevel: "silent" }, deploymentService: f.app, authService: { authenticateToken: async () => ({ user: { id: userId }, session: {} }) } }); }
function body(f) { const { action, target, confirmation } = f.input; return { action, target, confirmation }; }
describe("deployment HTTP boundary", () => {
  it("protects every endpoint and bounds all query and mutation inputs", async () => {
    const f = deploymentFixture(); const app = appFor(f);
    for (const [method, path] of [["get", "/provider-connections"], ["post", "/provider-connections/render"], ["delete", `/provider-connections/${ids.connection}`], ["get", `/provider-connections/${ids.connection}/services`], ["get", "/projects"], ["post", "/projects"], ["get", `/projects/${ids.project}`], ["patch", `/projects/${ids.project}`], ["get", `/projects/${ids.project}/logs`], ["get", `/projects/${ids.project}/deployments`], ["post", `/projects/${ids.project}/deployments`], ["get", `/operations/${ids.project}`], ["get", `/deployments/${ids.project}`]]) await request(app)[method](`/api/v1${path}`).expect(401);
    for (const path of ["/projects?limit=999", "/projects?cursor=bad", `/projects/${ids.project}/logs?from=not-a-date`, `/projects/${ids.project}/logs?level=arbitrary`, "/projects/not-an-id", `/projects/${ids.project}?unknown=1`]) await request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).expect(422);
    await request(app).post(`/api/v1/projects/${ids.project}/deployments`).set("Authorization", `Bearer ${token}`).send(body(f)).expect(422);
    await request(app).post("/api/v1/provider-connections/render").set("Authorization", `Bearer ${token}`).send({ apiKey: "x".repeat(513), displayName: "Test" }).expect(422);
  });
  it("returns 202 for durable queued request, one operation on duplicate and 409 on key conflict", async () => {
    const f = deploymentFixture(); const app = appFor(f); const path = `/api/v1/projects/${ids.project}/deployments`;
    const call = (payload) => request(app).post(path).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", f.input.idempotencyKey).send(payload);
    const first = await call(body(f)).expect(202); const second = await call(body(f)).expect(202);
    expect(first.body.data.operationId).toBe(second.body.data.operationId); expect(first.body.data).toMatchObject({ status: "queued", healthStatus: "not_checked" });
    expect(f.adapter.requestDeployment).not.toHaveBeenCalled();
    await call({ ...body(f), target: { ...f.input.target, commitSha: "b".repeat(40) } }).expect(409);
    await request(app).get(`/api/v1/operations/${first.body.data.operationId}`).set("Authorization", `Bearer ${token}`).expect(200);
    await request(appFor(f, ids.other)).get(`/api/v1/operations/${first.body.data.operationId}`).set("Authorization", `Bearer ${token}`).expect(404);
  });
  it("connects, maps only current authorized resources, and safely disconnects without leaking keys", async () => {
    const f = deploymentFixture(); const app = appFor(f);
    const connection = await request(app).post("/api/v1/provider-connections/render").set("Authorization", `Bearer ${token}`).send({ apiKey: "rnd_secret_fixture", displayName: "Test" }).expect(201);
    expect(JSON.stringify(connection.body)).not.toMatch(/rnd_secret|encryptedCredentials/);
    await request(app).post("/api/v1/projects").set("Authorization", `Bearer ${token}`).send({ name: "Test", repositoryId: ids.repository, connectionId: ids.connection, providerServiceId: "srv-fixture" }).expect(201);
    for (const path of [`/projects/${ids.project}`, `/projects/${ids.project}/deployments`, `/projects/${ids.project}/logs`, `/provider-connections/${ids.connection}/services`]) await request(appFor(f, ids.other)).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).expect(404);
    await request(app).delete(`/api/v1/provider-connections/${ids.connection}`).set("Authorization", `Bearer ${token}`).expect(200);
    await request(app).get(`/api/v1/projects/${ids.project}/logs`).set("Authorization", `Bearer ${token}`).expect(409);
    await request(app).get("/health").expect(200);
  });
});

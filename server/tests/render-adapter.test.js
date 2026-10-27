import { describe, expect, it, vi } from "vitest";
import { RenderAdapter, githubRepoName } from "../src/modules/deployments/render-adapter.js";
import { redactLog } from "../src/modules/deployments/logs.js";
const token = "rnd_secret_fixture";
const service = { id: "srv-fixture", name: "Test", ownerId: "tea-fixture", type: "web_service", repo: "https://github.com/test-org/sample.git", suspended: "not_suspended" };
const deploy = { id: "dep-fixture", status: "live", commit: { id: "a".repeat(40) }, startedAt: "2026-10-26T09:00:00.000Z" };
function setup(body, status = 200) { const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status })); return { adapter: new RenderAdapter({ fetchImpl }), fetchImpl }; }
describe("verified Render API adapter", () => {
  it("normalizes paged service metadata without provider settings/secrets", async () => {
    const { adapter, fetchImpl } = setup([{ service: { ...service, envVars: [{ secret: token }], registryCredential: token }, cursor: "page-2" }]);
    const result = await adapter.listServices(token, { limit: 1 }); expect(result.nextCursor).toBe("page-2"); expect(result.items[0].repositoryFullName).toBe("test-org/sample"); expect(JSON.stringify(result)).not.toContain(token);
    expect(result.items[0].capabilities).toMatchObject({ canRedeploy: true, canRollback: false, canPromote: false });
    expect(fetchImpl.mock.calls[0][0].origin).toBe("https://api.render.com"); expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
    expect(githubRepoName("https://evil.test/test-org/sample")).toBeNull();
  });
  it.each([401, 403, 404, 429, 500, 503])("maps %s errors without leaking upstream bodies or credentials", async (status) => {
    const { adapter } = setup({ secret: token, detail: "private message" }, status);
    await expect(adapter.getService(token, "srv-fixture")).rejects.toMatchObject({ status: status === 401 || status === 403 ? 403 : status === 404 ? 404 : status === 429 ? 429 : 502 });
    try { await adapter.getService(token, "srv-fixture"); } catch (e) { expect(e.message).not.toMatch(/secret|private/); }
  });
  it("pins supported redeploys to confirmed commitId and accepts provider 202 only as deployment metadata", async () => {
    const { adapter, fetchImpl } = setup({ ...deploy, status: "created" }, 202);
    const d = await adapter.requestDeployment(token, service.id, deploy.commit.id);
    expect(d.status).toBe("queued"); expect(d.healthStatus).toBe("not_checked");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ commitId: deploy.commit.id, clearCache: "do_not_clear" });
    const partial = setup({ status: "live" }, 202);
    await expect(partial.adapter.requestDeployment(token, service.id, deploy.commit.id)).rejects.toMatchObject({ code: "RENDER_INVALID_RESPONSE", ambiguous: true });
  });
  it("treats lost response, timeout, oversized/invalid body and provider 5xx writes as ambiguous", async () => {
    const adapter = new RenderAdapter({ fetchImpl: vi.fn(async () => { throw new Error(`timeout ${token}`); }) });
    await expect(adapter.requestDeployment(token, service.id, deploy.commit.id)).rejects.toMatchObject({ ambiguous: true, code: "RENDER_UNAVAILABLE" });
    for (const status of [500, 503]) await expect(setup({}, status).adapter.requestDeployment(token, service.id, deploy.commit.id)).rejects.toMatchObject({ ambiguous: true });
    await expect(setup({}, 429).adapter.requestDeployment(token, service.id, deploy.commit.id)).rejects.toMatchObject({ ambiguous: false, retryable: true });
    await expect(setup({ data: "x".repeat(2 * 1024 * 1024) }).adapter.getService(token, service.id)).rejects.toMatchObject({ code: "RENDER_UNAVAILABLE" });
  });
  it("handles partial provider metadata, unsupported services and unknown lifecycle statuses safely", async () => {
    await expect(setup({ id: service.id }).adapter.getService(token, service.id)).rejects.toMatchObject({ code: "RENDER_INVALID_RESPONSE" });
    const staticSite = await setup({ ...service, type: "static_site" }).adapter.getService(token, service.id); expect(staticSite.capabilities.supportsLogs).toBe(false);
    const image = await setup({ ...service, repo: null }).adapter.getService(token, service.id); expect(image.capabilities.canRedeploy).toBe(false);
    const d = await setup({ ...deploy, status: "new_future_status" }).adapter.getDeployment(token, service.id, deploy.id); expect(d.status).toBe("unknown"); expect(d.providerStatus).toBe("unknown");
  });
  it("redacts bounded paginated logs and validates the exact requested resource", async () => {
    const logs = { hasMore: true, nextStartTime: "2026-10-26T09:00:00Z", nextEndTime: "2026-10-26T09:30:00Z", logs: [{ id: "log-1", timestamp: "2026-10-26T09:45:00Z", message: `password=hunter2 Authorization: Bearer ${token} postgres://bob:pass@db.test/x`, labels: [{ name: "resource", value: service.id }, { name: "level", value: "error" }] }] };
    const { adapter, fetchImpl } = setup(logs); const result = await adapter.getLogs(token, service, { from: "2026-10-26T09:00:00Z", to: "2026-10-26T10:00:00Z", limit: 50 });
    expect(JSON.stringify(result)).not.toMatch(/hunter2|rnd_secret_fixture|bob:pass/); expect(result.nextWindow.to).toBe(logs.nextEndTime);
    const url = fetchImpl.mock.calls[0][0]; expect(url.searchParams.get("ownerId")).toBe(service.ownerId); expect(url.searchParams.get("resource")).toBe(service.id);
    expect(redactLog("x".repeat(20000))).toHaveLength(4096);
    logs.logs[0].labels[0].value = "srv-other"; await expect(setup(logs).adapter.getLogs(token, service, {})).rejects.toMatchObject({ code: "RENDER_INVALID_RESPONSE" });
  });
  it("strips common secret formats, keys, JSON/logfmt secrets and terminal control sequences", () => {
    const result = redactLog('api_key="very secret" {"token":"sensitive"} cookie=sessionvalue ghp_fixture -----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----\n\x1b[31mhello\x00');
    // eslint-disable-next-line no-control-regex -- the assertion verifies control characters are stripped
    expect(result).not.toMatch(/very secret|sensitive|sessionvalue|ghp_fixture|\nprivate|\x1b|\x00/); expect(result).toContain("hello");
  });
});

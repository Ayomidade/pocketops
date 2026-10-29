import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { measureJob, requestMetrics } from "../src/logging/metrics.js";
import { redactLog } from "../src/modules/deployments/logs.js";
import { reportQueueHealth } from "../src/logging/queue-health.js";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("beta operational boundaries", () => {
  it.each([
    ["get", "/github/installations"],
    ["get", "/github/repositories"],
    ["get", "/github/repositories/00000000-0000-4000-8000-000000000001"],
    ["get", "/github/repositories/00000000-0000-4000-8000-000000000001/file"],
    ["post", "/github/repositories/00000000-0000-4000-8000-000000000001/branches"],
    ["put", "/github/repositories/00000000-0000-4000-8000-000000000001/file"],
    ["get", "/provider-connections"], ["post", "/provider-connections/render"],
    ["delete", "/provider-connections/00000000-0000-4000-8000-000000000001"],
    ["get", "/projects"], ["post", "/projects"],
    ["get", "/projects/00000000-0000-4000-8000-000000000001/logs"],
    ["post", "/projects/00000000-0000-4000-8000-000000000001/deployments"],
    ["get", "/operations/00000000-0000-4000-8000-000000000001"],
    ["get", "/deployments/00000000-0000-4000-8000-000000000001"],
  ])("rejects unauthenticated %s %s before accessing resources", async (method, path) => {
    const app = createApp({ config: { nodeEnv: "test", logLevel: "silent", corsOrigins: [] }, authService: {}, githubService: {}, editorService: {}, deploymentService: {} });
    await request(app)[method](`/api/v1${path}`).expect(401);
  });
  it("flags ambiguous, failed and aging queues without automatically replaying work", async () => {
    const rows = [{ queue: "deployment", status: "unknown", count: 1, oldestSeconds: 2 }, { queue: "webhook", status: "failed", count: 2, oldestSeconds: 100 }, { queue: "deployment", status: "queued", count: 1, oldestSeconds: 301 }];
    const sequelize = { query: vi.fn(async () => rows) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    await expect(reportQueueHealth(sequelize, logger)).resolves.toEqual(rows);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(sequelize.query).toHaveBeenCalledTimes(1);
  });
  it("emits bounded request labels without URLs, credentials or source", () => {
    const logger = { info: vi.fn() };
    const response = Object.assign(new EventEmitter(), { statusCode: 503 });
    let now = 10;
    requestMetrics(logger, () => now)({ id: "correlation", method: "ATTACK", url: "/secret?token=secret", body: { source: "private" } }, response, vi.fn());
    now = 35; response.emit("finish");
    expect(logger.info.mock.calls[0][0]).toEqual({ event: "http.metric", requestId: "correlation", method: "OTHER", status: 503, durationMs: 25 });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/secret|private/);
  });
  it("reports idle, processed and failing worker iterations without provider error contents", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(measureJob(logger, async () => false)).resolves.toBe(false);
    await expect(measureJob(logger, async () => true)).resolves.toBe(true);
    const failure = new Error("Bearer private-credential");
    await expect(measureJob(logger, async () => { throw failure; })).rejects.toBe(failure);
    expect(logger.info.mock.calls.map(([entry]) => entry.outcome)).toEqual(["idle", "processed"]);
    expect(logger.error.mock.calls[0][0].outcome).toBe("error");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private-credential");
  });
  it("removes OSC hyperlinks/clipboard commands, CSI and bidi log spoofing", () => {
    expect(redactLog("\x1b]52;c;hidden\x07safe\x1b[?25l\u202eevil\u2069\x9b31m")).toBe("safeevil");
    expect(redactLog("ok\x1b]8;;https://secret.invalid")).toBe("ok");
    expect(redactLog("\x1b]8;;https://secret.invalid\x1b\\label\x1b]8;;\x1b\\")).toBe("label");
    expect(Buffer.byteLength(redactLog("é".repeat(10000)))).toBeLessThanOrEqual(4096);
  });
});

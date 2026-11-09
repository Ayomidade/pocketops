import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import {
  createHealthProbe,
  isPublicAddress,
  approvedOrigin,
} from "../src/modules/incidents/health-adapter.js";
import {
  assertTransition,
  healthSummary,
} from "../src/modules/incidents/policy.js";
import { createPushAdapter } from "../src/modules/incidents/push-adapter.js";
import { createIncidentService } from "../src/modules/incidents/service.js";
const id = "00000000-0000-4000-8000-000000000001";
describe("incident security boundaries", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.2",
    "172.16.0.1",
    "0.0.0.0",
    "100.64.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("blocks non-public address %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(false),
  );
  it("only permits canonical provider public origins", () => {
    expect(approvedOrigin("https://fixture.onrender.com")).toBe(
      "https://fixture.onrender.com",
    );
    for (const url of [
      "https://fixture.onrender.com.evil.test",
      "https://localhost",
      "http://fixture.onrender.com",
      "https://user@fixture.onrender.com",
      "https://fixture.onrender.com:8443",
      "https://fixture.onrender.com/redirect",
      "https://127.0.0.1",
    ])
      expect(approvedOrigin(url)).toBeNull();
  });
  it("blocks a mixed public/private DNS answer before connecting", async () => {
    const connect = vi.fn();
    const probe = createHealthProbe({
      resolve: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      request: connect,
    });
    expect(
      await probe("https://fixture.onrender.com", "/health"),
    ).toMatchObject({ status: "unknown", code: "ADDRESS_BLOCKED" });
    expect(connect).not.toHaveBeenCalled();
  });
  it("pins vetted DNS results, retains HTTPS hostname and never follows redirects", async () => {
    const resolve = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);
    const connect = vi.fn((url, options, callback) => {
      expect(url.hostname).toBe("fixture.onrender.com");
      expect(options.agent).toBe(false);
      options.lookup("fixture.onrender.com", {}, (_err, address) =>
        expect(address).toBe("8.8.8.8"),
      );
      const req = new EventEmitter();
      req.destroy = vi.fn();
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 302;
        res.destroy = vi.fn();
        callback(res);
        res.emit("end");
      };
      return req;
    });
    expect(
      await createHealthProbe({ resolve, request: connect })(
        "https://fixture.onrender.com",
        "/health",
      ),
    ).toMatchObject({ status: "unhealthy", code: "REDIRECT_BLOCKED" });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it("caps responses and rejects arbitrary paths without sending a request", async () => {
    const connect = vi.fn((_url, _options, cb) => {
      const req = new EventEmitter();
      req.destroy = vi.fn();
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        res.destroy = vi.fn();
        cb(res);
        res.emit("data", Buffer.alloc(16385));
      };
      return req;
    });
    const probe = createHealthProbe({
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      request: connect,
    });
    expect(
      await probe("https://fixture.onrender.com", "/health"),
    ).toMatchObject({ status: "unknown", code: "RESPONSE_TOO_LARGE" });
    expect(
      await probe("https://fixture.onrender.com", "//internal"),
    ).toMatchObject({ code: "TARGET_NOT_APPROVED" });
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it("requires spaced consistent healthy observations and expires recovery evidence", () => {
    const now = new Date();
    const rows = [0, 60000, 120000].map((age) => ({
      status: "healthy",
      checkedAt: new Date(+now - age),
      origin: "https://fixture.onrender.com",
      path: "/health",
      deploymentReference: "dep-1",
    }));
    expect(healthSummary(rows, now).status).toBe("verified");
    expect(healthSummary(rows.slice(0, 1), now).status).toBe("unknown");
    expect(healthSummary(rows, new Date(+now + 180001)).status).toBe("unknown");
    rows[1].deploymentReference = "dep-older";
    expect(healthSummary(rows, now).status).toBe("unknown");
  });
  it("rejects illegal transitions and requires explicit investigation", () => {
    expect(() => assertTransition("open", "resolved")).toThrow();
    expect(() => assertTransition("resolved", "mitigating")).toThrow();
    expect(() => assertTransition("open", "investigating")).not.toThrow();
  });
  it("never sends private incident details to Expo and classifies ambiguous sends", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { status: "ok", id: "ticket" } })),
    );
    const push = createPushAdapter({ fetchImpl });
    expect(
      await push.send("ExpoPushToken[fixture]", id, "event"),
    ).toMatchObject({ status: "ok", id: "ticket" });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.data).toEqual({ incidentId: id, eventId: "event" });
    expect(body.title).toBe("PocketOps incident update");
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
    expect(
      await createPushAdapter({
        fetchImpl: async () => {
          throw new Error("secret upstream");
        },
      }).send("token", id, "e"),
    ).toMatchObject({ ambiguous: true });
  });
  it("handles revoked devices and pending receipts", async () => {
    const push = createPushAdapter({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: {
              ticket: {
                status: "error",
                details: { error: "DeviceNotRegistered" },
              },
            },
          }),
        ),
    });
    expect(await push.receipt("ticket")).toMatchObject({
      code: "DEVICE_NOT_REGISTERED",
    });
    expect(await push.receipt("missing")).toEqual({ status: "pending" });
  });
  it("denies foreign incidents and does not emit a push after permission revocation", async () => {
    const repository = {
      find: vi.fn(async () => null),
      claimNotification: async () => ({ id: "delivery", status: "pending" }),
      notificationContext: async () => ({
        device: { userId: "u" },
        incident: { projectId: "p" },
        allowed: true,
      }),
      finishNotification: vi.fn(),
    };
    const deployments = {
      incidentContext: vi.fn(async () => {
        throw Object.assign(new Error("revoked"), { status: 403 });
      }),
    };
    const push = { send: vi.fn() };
    const service = createIncidentService({ repository, deployments, push });
    await expect(service.detail({ userId: "other", id })).rejects.toMatchObject(
      { status: 404 },
    );
    expect(deployments.incidentContext).not.toHaveBeenCalled();
    await service.processNotification();
    expect(push.send).not.toHaveBeenCalled();
    expect(repository.finishNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });
  it("protects all new HTTP routes and rejects malformed bodies before service calls", async () => {
    const service = { create: vi.fn() };
    const app = createApp({
      config: { nodeEnv: "test", corsOrigins: [], logLevel: "silent" },
      incidentService: service,
      authService: {
        authenticateToken: async () => ({ user: { id }, session: { id } }),
      },
    });
    for (const [method, path] of [
      ["get", "/incidents"],
      ["post", "/incidents"],
      ["get", `/incidents/${id}`],
      ["patch", `/incidents/${id}`],
      ["post", `/incidents/${id}/resolve`],
      ["get", `/incidents/${id}/timeline`],
      ["get", `/projects/${id}/health-status`],
      ["get", `/projects/${id}/health-checks`],
      ["post", `/projects/${id}/health-checks`],
      ["get", "/notification-preferences"],
      ["patch", "/notification-preferences"],
      ["get", "/devices/push-tokens"],
      ["post", "/devices/push-tokens"],
      ["delete", `/devices/push-tokens/${id}`],
    ])
      await request(app)[method]("/api/v1" + path)
        .expect(401);
    for (const path of [
      "/incidents?limit=200",
      "/incidents?severity=urgent",
      `/incidents/${id}/timeline?cursor=bad`,
    ])
      await request(app)
        .get("/api/v1" + path)
        .set("Authorization", `Bearer ${"t".repeat(43)}`)
        .expect(422);
    await request(app)
      .post("/api/v1/incidents")
      .set("Authorization", `Bearer ${"t".repeat(43)}`)
      .send({ projectId: id, title: "test", severity: "high" })
      .expect(422);
    expect(service.create).not.toHaveBeenCalled();
  });
});

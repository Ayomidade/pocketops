import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

const config = {
  nodeEnv: "test",
  port: 4000,
  databaseUrl: null,
  databaseSsl: false,
  corsOrigins: [],
  logLevel: "silent",
};
const user = {
  id: "user-id",
  githubUserId: "12345",
  username: "developer",
  email: null,
  avatarUrl: null,
};
const session = { id: "session-id", expiresAt: "2026-11-21T00:00:00.000Z" };

function makeAuthService() {
  return {
    createMobileStart: vi.fn(async () => ({
      authorizationUrl: "https://api.example.test/api/v1/auth/github?state=state",
    })),
    getAuthorizationUrl: vi.fn(async () => "https://github.com/login/oauth/authorize"),
    handleCallback: vi.fn(async () => ({
      redirectUrl: "pocketops://auth/callback?handoff=handoff",
    })),
    exchangeHandoff: vi.fn(async () => ({
      token: "t".repeat(43),
      user,
      session,
    })),
    authenticateToken: vi.fn(async () => ({ user, session })),
    rotateSession: vi.fn(async () => ({ user, session })),
    logout: vi.fn(async () => ({ loggedOut: true })),
  };
}

describe("authentication API", () => {
  it("validates mobile start, returns a bound browser URL, and redirects to GitHub", async () => {
    const authService = makeAuthService();
    const app = createApp({ config, authService });
    const body = {
      redirectUri: "pocketops://auth/callback",
      completionSecret: "c".repeat(64),
    };
    const started = await request(app)
      .post("/api/v1/auth/mobile/start")
      .send(body)
      .expect(201);
    expect(started.body.data.authorizationUrl).toContain("/auth/github?state=");
    expect(started.body.meta.requestId).toBe(started.headers["x-request-id"]);

    await request(app)
      .get(`/api/v1/auth/github?state=${"s".repeat(43)}`)
      .expect(302)
      .expect("Location", "https://github.com/login/oauth/authorize");
    expect(authService.createMobileStart).toHaveBeenCalledWith(body);
  });

  it("rejects malformed start and handoff payloads with safe validation errors", async () => {
    const app = createApp({ config, authService: makeAuthService() });
    const response = await request(app)
      .post("/auth/mobile/start")
      .send({
        redirectUri: "https://attacker.example/callback",
        completionSecret: "too-short",
      })
      .expect(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("attacker.example");

    await request(app)
      .post("/auth/mobile/exchange")
      .send({ handoffCode: "replayed", completionSecret: "bad" })
      .expect(422);
  });

  it("requires a valid PocketOps bearer session and returns no credential from /me", async () => {
    const authService = makeAuthService();
    const app = createApp({ config, authService });
    await request(app).get("/auth/me").expect(401);
    await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${"t".repeat(43)}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.user).toEqual(user);
        expect(response.body.data.session).toEqual(session);
        expect(response.body.data).not.toHaveProperty("token");
      });
    expect(authService.authenticateToken).toHaveBeenCalledWith("t".repeat(43));
  });

  it("accepts an idempotently persisted replacement token and revokes on logout", async () => {
    const authService = makeAuthService();
    const app = createApp({ config, authService });
    await request(app)
      .post("/api/v1/auth/session/rotate")
      .set("Authorization", `Bearer ${"t".repeat(43)}`)
      .send({ replacementToken: "a".repeat(64) })
      .expect(200);
    expect(authService.rotateSession).toHaveBeenCalledWith(
      expect.objectContaining({ replacementToken: "a".repeat(64) }),
    );

    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${"t".repeat(43)}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.loggedOut).toBe(true);
      });
  });

  it("returns explicit unavailable errors when the database-backed auth module is not wired", async () => {
    const response = await request(createApp({ config }))
      .get("/api/v1/auth/me")
      .expect(503);
    expect(response.body.error.code).toBe("AUTH_UNAVAILABLE");
  });
});

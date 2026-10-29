import { Writable } from "node:stream";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { errorHandler } from "../src/middleware/errors.js";
import { validate } from "../src/middleware/validate.js";
import { createLogger } from "../src/logging/logger.js";

const config = {
  nodeEnv: "test",
  port: 4000,
  databaseUrl: null,
  databaseSsl: false,
  corsOrigins: ["http://localhost:8081"],
  logLevel: "silent",
};

function makeApp(options = {}) {
  return createApp({ config, ...options });
}

describe("health and readiness", () => {
  it("keeps liveness independent of PostgreSQL state", async () => {
    const authenticate = vi
      .fn()
      .mockRejectedValue(new Error("database unavailable"));
    const response = await request(makeApp({ sequelize: { authenticate } }))
      .get("/api/v1/health")
      .expect(200);

    expect(response.body.data.status).toBe("ok");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("reports readiness only when PostgreSQL is available", async () => {
    const response = await request(
      makeApp({
        sequelize: {
          authenticate: vi.fn().mockRejectedValue(new Error("private detail")),
        },
      }),
    )
      .get("/ready")
      .expect(503);

    expect(response.body.error.code).toBe("NOT_READY");
    expect(JSON.stringify(response.body)).not.toContain("private detail");
  });

  it("reports PostgreSQL readiness and states Redis is not required", async () => {
    const response = await request(
      makeApp({ sequelize: { authenticate: vi.fn().mockResolvedValue() } }),
    )
      .get("/api/v1/ready")
      .expect(200);

    expect(response.body.data.dependencies).toEqual({
      postgres: "ready",
      redis: "not_required",
    });
  });
});

describe("API response and request handling", () => {
  it("correlates response header, metadata and structured request log", async () => {
    const output = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger({ ...config, logLevel: "info" }, destination);
    const response = await request(makeApp({ logger }))
      .get("/health")
      .set("X-Request-ID", "foundation-test-42")
      .set("Authorization", "Bearer do-not-log-this")
      .expect(200);

    await new Promise((resolve) => setImmediate(resolve));
    expect(response.headers["x-request-id"]).toBe("foundation-test-42");
    expect(response.body.meta.requestId).toBe("foundation-test-42");
    expect(output.join("")).toContain("foundation-test-42");
    expect(output.join("")).not.toContain("do-not-log-this");
  });

  it("replaces an invalid request ID with a safe generated ID", async () => {
    const response = await request(makeApp())
      .get("/health")
      .set("X-Request-ID", "invalid request id")
      .expect(200);

    expect(response.headers["x-request-id"]).toMatch(/^[\w.-]{1,100}$/);
    expect(response.body.meta.requestId).toBe(response.headers["x-request-id"]);
  });

  it("returns the stable error shape for unknown routes and malformed JSON", async () => {
    const app = makeApp();
    const missing = await request(app).get("/not-a-route").expect(404);
    const malformed = await request(app)
      .post("/api/v1/test")
      .set("Content-Type", "application/json")
      .send('{"incomplete":')
      .expect(400);

    expect(missing.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
      meta: { requestId: expect.any(String) },
    });
    expect(malformed.body.error.code).toBe("INVALID_JSON");
    expect(malformed.body.meta.requestId).toBe(
      malformed.headers["x-request-id"],
    );
  });

  it("does not return internal error details or stack traces", async () => {
    const app = express();
    app.get("/failure", () => {
      throw new Error("secret database connection detail");
    });
    app.use(errorHandler);
    const response = await request(app).get("/failure").expect(500);

    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain(
      "secret database connection detail",
    );
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });

  it("rejects an unlisted browser origin with a safe error", async () => {
    const response = await request(makeApp())
      .get("/health")
      .set("Origin", "https://unlisted.example")
      .expect(403);

    expect(response.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("uses the shared Zod validation middleware and safe validation error", async () => {
    const app = express();
    app.use((requestValue, _response, next) => {
      requestValue.id = "validation-test";
      return next();
    });
    app.use(express.json());
    app.post(
      "/validated",
      validate(z.object({ name: z.string().min(1) })),
      (_request, response) => response.json({ success: true }),
    );
    app.use((error, requestValue, response, next) =>
      errorHandler(error, requestValue, response, next),
    );

    const response = await request(app)
      .post("/validated")
      .send({ name: "" })
      .expect(422);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("environment configuration", () => {
  it("rejects invalid CORS origins without echoing supplied credentials", () => {
    let failure;
    try {
      loadConfig({
        CORS_ORIGINS: "https://user:private-password@example.test",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("CORS_ORIGINS");
    expect(failure.message).not.toContain("private-password");
    expect(failure.message).not.toContain("example.test");
  });

  it("validates settings without echoing database credentials", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        DATABASE_URL: "not-a-database-url-with-a-password",
      }),
    ).toThrow(/DATABASE_URL must be a valid PostgreSQL connection URL/);

    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "",
      }),
    ).toThrow(/DATABASE_URL is required in production/);
  });

  it("accepts blank optional OAuth values in the copied environment example", () => {
    expect(
      loadConfig({
        NODE_ENV: "development",
        GITHUB_OAUTH_CLIENT_ID: "",
        GITHUB_OAUTH_CLIENT_SECRET: "",
        GITHUB_OAUTH_CALLBACK_URL: "",
        MOBILE_AUTH_REDIRECT_URI: "",
        API_PUBLIC_URL: "",
      }),
    ).toMatchObject({ githubOAuthEnabled: false });
  });

  it("requires all server-side OAuth configuration as a complete set", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        GITHUB_OAUTH_CLIENT_ID: "client-id",
      }),
    ).toThrow(/GitHub OAuth client ID/);
  });

  it("allows partial GitHub App setup but enables access only with the complete set", () => {
    expect(loadConfig({ NODE_ENV: "test", GITHUB_APP_ID: "123" }))
      .toMatchObject({ githubAppEnabled: false });

    const githubAppConfig = {
      NODE_ENV: "test",
      GITHUB_OAUTH_CLIENT_ID: "identity-client",
      GITHUB_OAUTH_CLIENT_SECRET: "identity-secret",
      GITHUB_OAUTH_CALLBACK_URL:
        "https://api.example.test/api/v1/auth/github/callback",
      MOBILE_AUTH_REDIRECT_URI: "pocketops://auth/callback",
      API_PUBLIC_URL: "https://api.example.test",
      GITHUB_APP_ID: "123",
      GITHUB_APP_CLIENT_ID: "app-client",
      GITHUB_APP_CLIENT_SECRET: "app-secret",
      GITHUB_APP_PRIVATE_KEY:
        "-----BEGIN RSA PRIVATE KEY-----\\nkey\\n-----END RSA PRIVATE KEY-----",
      GITHUB_APP_SLUG: "pocketops",
      GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_APP_OAUTH_CALLBACK_URL:
        "https://api.example.test/api/v1/github/oauth/callback",
      GITHUB_APP_SETUP_CALLBACK_URL:
        "https://api.example.test/api/v1/github/installations/callback",
      GITHUB_APP_MOBILE_REDIRECT_URI: "pocketops://github/callback",
      GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    };
    expect(loadConfig(githubAppConfig)).toMatchObject({
      githubAppEnabled: true,
      githubAppId: "123",
      githubAppMobileRedirectUri: "pocketops://github/callback",
      githubTokenEncryptionKey: Buffer.alloc(32, 7),
    });
    for (const key of Object.keys(githubAppConfig).filter((name) =>
      name.startsWith("GITHUB_APP_") || name === "GITHUB_TOKEN_ENCRYPTION_KEY")) {
      const partial = { ...githubAppConfig, [key]: "" };
      expect(loadConfig(partial)).toMatchObject({
        githubAppEnabled: false,
        githubOAuthEnabled: true,
      });
    }
    expect(() => loadConfig({ GITHUB_APP_ID: "invalid" })).toThrow(/numeric GitHub App ID/);
    expect(() => loadConfig({ GITHUB_TOKEN_ENCRYPTION_KEY: "invalid" })).toThrow(/32-byte key/);
    expect(() =>
      loadConfig({
        ...githubAppConfig,
        GITHUB_TOKEN_ENCRYPTION_KEY: "not-a-32-byte-key",
      }),
    ).toThrow(
      /GITHUB_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key/,
    );
  });

  it("accepts valid isolated environment configuration", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        PORT: "4100",
        DATABASE_URL: "postgres://user:password@127.0.0.1:5432/pocketops_test",
        DATABASE_SSL: "false",
        CORS_ORIGINS: "http://localhost:8081",
      }),
    ).toMatchObject({
      nodeEnv: "test",
      port: 4100,
      databaseSsl: false,
      corsOrigins: ["http://localhost:8081"],
    });
  });
});


describe("trusted local reverse proxy", () => {
  it("defaults to no proxy trust and rejects unrestricted trust", () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(() => loadConfig({ TRUST_PROXY: "true" })).toThrow(/TRUST_PROXY/);
  });
  it("accepts proxied requests without trusting arbitrary remote peers", async () => {
    const app = createApp({ config: { ...config, trustProxy: loadConfig({ TRUST_PROXY: "loopback" }).trustProxy } });
    expect(app.get("trust proxy fn")("203.0.113.10")).toBe(false);
    const trust = app.get("trust proxy fn");
    expect(trust("127.0.0.1")).toBe(true);
    const response = await request(app).get("/api/v1/health")
      .set("X-Forwarded-For", "198.51.100.5").expect(200);
    expect(response.headers.ratelimit).toBeDefined();
  });
});

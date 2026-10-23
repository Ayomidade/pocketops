import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import SwaggerParser from "@apidevtools/swagger-parser";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openapi } from "../src/contracts/openapi.js";
import { createAuthRouter } from "../src/modules/auth/routes.js";
import {
  createGitHubRouter,
  createGitHubWebhookRouter,
} from "../src/modules/github/routes.js";

const config = { nodeEnv: "test", corsOrigins: [], logLevel: "silent" };

function routes(router, prefix) {
  return router.stack.flatMap((layer) => {
    if (!layer.route) return [];
    return [layer.route.path]
      .flat()
      .flatMap((path) =>
        Object.keys(layer.route.methods).map((method) =>
          `${method} ${prefix}${path === "/" ? "" : path}`.replace(
            /:(\w+)/g,
            "{$1}",
          ),
        ),
      );
  });
}

describe("implemented OpenAPI contract", () => {
  it("is valid, generated reproducibly, and covers every v1 route", async () => {
    await SwaggerParser.validate(structuredClone(openapi));
    const artifact = await readFile(
      new URL("../../docs/openapi.json", import.meta.url),
      "utf8",
    );
    expect(artifact).toBe(`${JSON.stringify(openapi, null, 2)}\n`);
    const expected = [
      "get /health",
      "get /ready",
      ...routes(createAuthRouter({ service: null }), "/auth"),
      ...routes(
        createGitHubRouter({ service: null, authService: null }),
        "/github",
      ),
      ...routes(
        createGitHubWebhookRouter({ service: null }),
        "/webhooks/github",
      ),
    ];
    const documented = Object.entries(openapi.paths).flatMap(
      ([path, methods]) =>
        Object.keys(methods).map((method) => `${method} ${path}`),
    );
    expect(documented.sort()).toEqual(expected.sort());
  });

  it("validates real health, readiness, error and identity response envelopes", async () => {
    const spec = await SwaggerParser.dereference(structuredClone(openapi));
    const ajv = new Ajv({ strict: false, allErrors: true });
    const user = {
      id: "user-id",
      githubUserId: "123",
      username: "tester",
      email: null,
      avatarUrl: null,
    };
    const session = { id: "session-id", expiresAt: "2026-11-23T00:00:00.000Z" };
    const app = createApp({
      config,
      authService: { authenticateToken: async () => ({ user, session }) },
    });
    for (const [path, status, authenticated] of [
      ["/health", 200],
      ["/ready", 503],
      ["/auth/me", 200, true],
      ["/auth/me", 401],
    ]) {
      const call = request(app).get(`/api/v1${path}`);
      if (authenticated) call.set("Authorization", `Bearer ${"t".repeat(43)}`);
      const response = await call.expect(status);
      const schema = (
        spec.paths[path].get.responses[status] ||
        spec.paths[path].get.responses.default
      ).content["application/json"].schema;
      const validate = ajv.compile(schema);
      expect(validate(response.body), JSON.stringify(validate.errors)).toBe(
        true,
      );
      if (path === "/auth/me" && status === 200) {
        response.body.data.user.providerToken = "must-not-leak";
        expect(validate(response.body)).toBe(false);
      }
    }
  });

  it("requires session auth on repository routes and signature headers on webhooks", () => {
    for (const [path, methods] of Object.entries(openapi.paths)) {
      if (path.startsWith("/github/repositories")) {
        expect(methods.get.security).toEqual([{ PocketOpsSession: [] }]);
      }
    }
    expect(
      openapi.paths["/webhooks/github"].post.parameters.map(
        (item) => item.name,
      ),
    ).toContain("X-Hub-Signature-256");
    expect(openapi.paths["/webhooks/github"].post.responses).toHaveProperty(
      "202",
    );
    expect(openapi.paths).not.toHaveProperty("/projects");
  });
});

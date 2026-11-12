/* eslint-disable no-control-regex -- Reject control characters in incident titles. */
import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { AppError } from "../../errors/app-error.js";
import { createSessionAuthentication } from "../../middleware/authenticate.js";
import { validate } from "../../middleware/validate.js";
import { validHealthPath } from "./health-adapter.js";
import { createIncidentController } from "./controller.js";
const uuid = z.string().uuid();
const severity = z.enum(["low", "medium", "high", "critical"]);
const status = z.enum([
  "open",
  "investigating",
  "mitigating",
  "monitoring",
  "resolved",
]);
const empty = z.object({}).strict();
const page = {
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: uuid.optional(),
};
const cursor = z
  .string()
  .max(500)
  .transform((v, ctx) => {
    try {
      const c = JSON.parse(Buffer.from(v, "base64url").toString("utf8"));
      return z
        .object({ id: uuid, time: z.string().datetime() })
        .strict()
        .parse(c);
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid cursor" });
      return z.NEVER;
    }
  })
  .optional();
export const incidentSchemas = {
  id: z.object({ id: uuid }),
  empty,
  list: z
    .object({
      ...page,
      status: status.optional(),
      severity: severity.optional(),
    })
    .strict(),
  create: z
    .object({
      projectId: uuid,
      title: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/^[^\x00-\x1f\x7f]*$/),
      severity,
    })
    .strict(),
  headers: z.object({
    "idempotency-key": z.string().regex(/^[A-Za-z0-9._-]{16,100}$/),
  }),
  update: z
    .object({
      version: z.number().int().positive(),
      status: status.exclude(["resolved"]).optional(),
      severity: severity.optional(),
    })
    .strict()
    .refine((v) => v.status || v.severity),
  resolve: z
    .object({
      version: z.number().int().positive(),
      confirmation: z.literal("RESOLVE"),
    })
    .strict(),
  timeline: z.object({ limit: page.limit, cursor }).strict(),
  history: z
    .object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor,
    })
    .strict(),
  configure: z
    .object({
      enabled: z.boolean(),
      healthPath: z.string().refine(validHealthPath),
      confirmation: z.literal("MONITOR"),
    })
    .strict(),
  preference: z.object({ enabled: z.boolean() }).strict(),
  device: z
    .object({
      token: z
        .string()
        .max(200)
        .regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
      platform: z.enum(["android", "ios"]),
    })
    .strict(),
};
export function createIncidentRouter({ service, authService }) {
  const router = Router(),
    s = incidentSchemas,
    controller = createIncidentController(service);
  const auth = createSessionAuthentication(authService);
  const limiter = rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        success: false,
        error: {
          code: "INCIDENT_RATE_LIMITED",
          message: "Too many incident requests.",
        },
        meta: { requestId: req.id },
      }),
  });
  const add = (method, path, name, sources, code = 200) =>
    router[method](
      path,
      auth,
      (_req, _res, next) =>
        service
          ? next()
          : next(
              new AppError(
                503,
                "INCIDENTS_UNAVAILABLE",
                "Configure database, GitHub and provider encryption first.",
              ),
            ),
      ...(method === "get" ? [] : [limiter]),
      ...Object.entries(sources).map(([source, schema]) =>
        validate(schema, source),
      ),
      (req, res, next) => controller.handle(name, code, req, res).catch(next),
    );
  add("get", "/incidents", "list", { query: s.list });
  add(
    "post",
    "/incidents",
    "create",
    { query: empty, body: s.create, headers: s.headers },
    201,
  );
  add("get", "/incidents/:id", "detail", { params: s.id, query: empty });
  add("patch", "/incidents/:id", "update", {
    params: s.id,
    query: empty,
    body: s.update,
  });
  add("post", "/incidents/:id/resolve", "resolve", {
    params: s.id,
    query: empty,
    body: s.resolve,
  });
  add("get", "/incidents/:id/timeline", "timeline", {
    params: s.id,
    query: s.timeline,
  });
  add("get", "/projects/:id/health-status", "healthStatus", {
    params: s.id,
    query: empty,
  });
  add("get", "/projects/:id/health-checks", "healthChecks", {
    params: s.id,
    query: s.history,
  });
  add(
    "post",
    "/projects/:id/health-checks",
    "configure",
    { params: s.id, query: empty, body: s.configure },
    202,
  );
  add("get", "/notification-preferences", "preferences", { query: empty });
  add("patch", "/notification-preferences", "setPreferences", {
    query: empty,
    body: s.preference,
  });
  add("get", "/devices/push-tokens", "devices", { query: empty });
  add(
    "post",
    "/devices/push-tokens",
    "register",
    { query: empty, body: s.device },
    201,
  );
  add("delete", "/devices/push-tokens/:id", "revoke", {
    params: s.id,
    query: empty,
  });
  return router;
}

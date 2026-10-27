import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { createSessionAuthentication } from "../../middleware/authenticate.js";
import { validate } from "../../middleware/validate.js";
import { createDeploymentController } from "./controller.js";

export const deploymentSchemas = {
  id: z.object({ id: z.string().uuid() }).strict(),
  page: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(1000).optional() }).strict(),
  dbPage: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().uuid().optional() }).strict(),
  connection: z.object({ apiKey: z.string().trim().min(10).max(512).regex(/^[\x21-\x7e]+$/), displayName: z.string().trim().min(1).max(100) }).strict(),
  project: z.object({ name: z.string().trim().min(1).max(100), repositoryId: z.string().uuid(), connectionId: z.string().uuid(), providerServiceId: z.string().regex(/^srv-[a-zA-Z0-9]+$/).max(100) }).strict(),
  patch: z.object({ name: z.string().trim().min(1).max(100) }).strict(),
  logs: z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).max(2048).optional(), level: z.enum(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]).optional() }).strict(),
  deploy: z.object({ action: z.literal("redeploy"), confirmation: z.literal("DEPLOY"), target: z.object({ serviceId: z.string().regex(/^srv-[a-zA-Z0-9]+$/).max(100), deploymentId: z.string().regex(/^dep-[a-zA-Z0-9]+$/).max(100), commitSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i) }).strict() }).strict(),
  headers: z.object({ "idempotency-key": z.string().regex(/^[A-Za-z0-9._-]{16,100}$/) }),
  empty: z.object({}).strict(),
};
export function createDeploymentRouter({ service, authService }) {
  const router = Router();
  const controller = service ? createDeploymentController(service) : null;
  const auth = createSessionAuthentication(authService);
  const enabled = (_req, _res, next) => controller ? next() : next(new AppError(503, "RENDER_NOT_CONFIGURED", "Render integration is not configured."));
  const writes = rateLimit({ windowMs: 60000, limit: 15, standardHeaders: "draft-7", legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ success: false, error: { code: "DEPLOYMENT_RATE_LIMITED", message: "Too many deployment requests." }, meta: { requestId: req.id } }) });
  const add = (method, path, name, sources, status = 200) => router[method](path, auth, enabled, ...(["post", "patch", "delete"].includes(method) ? [writes] : []),
    ...Object.entries(sources).map(([source, schema]) => validate(schema, source)),
    (req, res, next) => controller.handle(name, status, req, res).catch(next));
  const s = deploymentSchemas;
  add("post", "/provider-connections/render", "connect", { body: s.connection, query: s.empty }, 201);
  add("get", "/provider-connections", "connections", { query: s.dbPage });
  add("delete", "/provider-connections/:id", "disconnect", { params: s.id, query: s.empty });
  add("get", "/provider-connections/:id/services", "services", { params: s.id, query: s.page });
  add("get", "/projects", "projects", { query: s.dbPage });
  add("post", "/projects", "createProject", { body: s.project, query: s.empty }, 201);
  add("get", "/projects/:id", "project", { params: s.id, query: s.empty });
  add("patch", "/projects/:id", "updateProject", { params: s.id, body: s.patch, query: s.empty });
  add("get", "/projects/:id/deployments", "deployments", { params: s.id, query: s.page });
  add("get", "/projects/:id/logs", "logs", { params: s.id, query: s.logs });
  add("post", "/projects/:id/deployments", "requestDeployment", { params: s.id, body: s.deploy, headers: s.headers, query: s.empty }, 202);
  add("get", "/operations/:id", "operation", { params: s.id, query: s.empty });
  add("get", "/deployments/:id", "deployment", { params: s.id, query: s.empty });
  return router;
}

import { createDeploymentRouter } from "./modules/deployments/routes.js";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { AppError } from "./errors/app-error.js";
import { errorResponse, successResponse } from "./lib/responses.js";
import { createLogger, createRequestLogger } from "./logging/logger.js";
import { requestMetrics } from "./logging/metrics.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { createAuthRouter } from "./modules/auth/routes.js";
import { createEditorRouter } from "./modules/editor/routes.js";
import {
  createGitHubRouter,
  createGitHubWebhookRouter,
} from "./modules/github/routes.js";

export function createApp({
  config,
  sequelize = null,
  authService = null,
  githubService = null,
  editorService = null,
  deploymentService = null,
  logger = createLogger(config),
  readyTimeoutMs = 1500,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ?? false);
  app.use(createRequestLogger(logger));
  app.use(requestMetrics(logger));
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(
          new AppError(403, "ORIGIN_NOT_ALLOWED", "Origin not allowed"),
        );
      },
    }),
  );
  app.use(
    "/api/v1/webhooks/github",
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  // Escaped JSON text can expand control-heavy source files by up to 6x.
  app.use(express.json({ limit: "4mb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler(request, response) {
        return response
          .status(429)
          .json(errorResponse("RATE_LIMITED", "Too many requests", request.id));
      },
    }),
  );

  const healthHandler = (request, response) =>
    response.json(
      successResponse({ status: "ok", service: "pocketops-api" }, request.id),
    );
  app.get(["/health", "/api/v1/health"], healthHandler);

  const readyHandler = async (request, response) => {
    if (!sequelize) {
      return response
        .status(503)
        .json(
          errorResponse(
            "NOT_READY",
            "Required dependencies are unavailable",
            request.id,
          ),
        );
    }

    let timeout;
    try {
      await Promise.race([
        sequelize.authenticate(),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Readiness timeout")),
            readyTimeoutMs,
          );
        }),
      ]);
      return response.json(
        successResponse(
          {
            status: "ready",
            dependencies: { postgres: "ready", redis: "not_required" },
          },
          request.id,
        ),
      );
    } catch (error) {
      request.log?.error(
        { dependency: "postgres", errorName: error?.name },
        "Readiness check failed",
      );
      return response
        .status(503)
        .json(
          errorResponse(
            "NOT_READY",
            "Required dependencies are unavailable",
            request.id,
          ),
        );
    } finally {
      clearTimeout(timeout);
    }
  };
  app.get(["/ready", "/api/v1/ready"], readyHandler);

  const authRouter = createAuthRouter({ service: authService });
  app.use("/api/v1/auth", authRouter);
  app.use("/auth", authRouter);
  app.use(
    "/api/v1/github",
    createEditorRouter({ service: editorService, authService }),
  );
  app.use(
    "/api/v1/github",
    createGitHubRouter({ service: githubService, authService }),
  );
  app.use(
    "/api/v1/webhooks/github",
    createGitHubWebhookRouter({ service: githubService }),
  );

  app.use("/api/v1", createDeploymentRouter({ service: deploymentService, authService }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

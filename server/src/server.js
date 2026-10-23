import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./config/database.js";
import { createLogger } from "./logging/logger.js";
import { defineModels } from "./db/models/index.js";
import { createAuthRepository } from "./modules/auth/repository.js";
import { createGitHubOAuthClient } from "./modules/auth/github-oauth.js";
import { createAuthService } from "./modules/auth/service.js";
import { createGitHubAppAdapter } from "./modules/github/adapter.js";
import { createGitHubRepository } from "./modules/github/repository.js";
import { createGitHubService } from "./modules/github/service.js";

export function startServer() {
  const config = loadConfig();
  const sequelize = createDatabase(config);
  const logger = createLogger(config);
  const models = sequelize ? defineModels(sequelize) : null;
  const authService = models
    ? createAuthService({
        repository: createAuthRepository({ sequelize, models }),
        githubOAuthClient: createGitHubOAuthClient({
          clientId: config.githubOAuthClientId,
          clientSecret: config.githubOAuthClientSecret,
          callbackUrl: config.githubOAuthCallbackUrl,
        }),
        config,
      })
    : null;
  const githubService =
    models && config.githubAppEnabled
      ? createGitHubService({
          repository: createGitHubRepository({ sequelize, models }),
          adapter: createGitHubAppAdapter({ config }),
          config,
        })
      : null;
  const app = createApp({
    config,
    sequelize,
    authService,
    githubService,
    logger,
  });
  const server = app.listen(config.port, "0.0.0.0", () => {
    logger.info({ port: config.port }, "PocketOps API listening");
  });
  const cleanupTimer = authService
    ? setInterval(
        () => {
          authService.cleanup().catch((error) => {
            logger.error(
              { errorName: error.name },
              "Authentication retention cleanup failed",
            );
          });
        },
        6 * 60 * 60 * 1000,
      ).unref()
    : null;
  let processingWebhooks = false;
  const webhookTimer = githubService
    ? setInterval(async () => {
        if (processingWebhooks) return;
        processingWebhooks = true;
        try {
          while (await githubService.processNextWebhook()) {
            // Drain available durable deliveries before sleeping again.
          }
        } catch (error) {
          logger.error(
            { errorName: error.name, errorCode: error.code },
            "GitHub webhook processing failed",
          );
        } finally {
          processingWebhooks = false;
        }
      }, 1500).unref()
    : null;
  const githubCleanupTimer = githubService
    ? setInterval(
        () => {
          githubService.cleanup().catch((error) => {
            logger.error(
              { errorName: error.name, errorCode: error.code },
              "GitHub integration cleanup failed",
            );
          });
        },
        6 * 60 * 60 * 1000,
      ).unref()
    : null;

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (cleanupTimer) clearInterval(cleanupTimer);
    if (webhookTimer) clearInterval(webhookTimer);
    if (githubCleanupTimer) clearInterval(githubCleanupTimer);
    logger.info({ signal }, "Shutting down API");
    server.close(async (error) => {
      if (error) {
        logger.error({ errorName: error.name }, "HTTP server shutdown failed");
        process.exitCode = 1;
      }
      try {
        await sequelize?.close();
      } catch (closeError) {
        logger.error(
          { errorName: closeError.name },
          "Database shutdown failed",
        );
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    startServer();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

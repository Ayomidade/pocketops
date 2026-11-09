import { createIncidentRuntime } from "../modules/incidents/runtime.js";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../config/env.js";
import { createDatabase } from "../config/database.js";
import { defineModels } from "../db/models/index.js";
import { createLogger } from "../logging/logger.js";
import { measureJob } from "../logging/metrics.js";
import { reportQueueHealth } from "../logging/queue-health.js";
import { createGitHubAppAdapter } from "../modules/github/adapter.js";
import { createGitHubRepository } from "../modules/github/repository.js";
import { createGitHubService } from "../modules/github/service.js";
import { createDeploymentRuntime } from "../modules/deployments/runtime.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const sequelize = createDatabase(config);
  if (
    !sequelize ||
    !config.githubAppEnabled ||
    !config.providerActiveKeyVersion
  )
    throw new Error(
      "Worker requires PostgreSQL, GitHub App and provider encryption settings.",
    );
  const models = defineModels(sequelize);
  const githubService = createGitHubService({
    repository: createGitHubRepository({ sequelize, models }),
    adapter: createGitHubAppAdapter({ config }),
    config,
  });
  const service = createDeploymentRuntime({
    config,
    sequelize,
    models,
    githubService,
  });
  const incidents = createIncidentRuntime({ config, sequelize, models, deployments: service });
  let stopping = false;
  let nextSnapshot = 0;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      stopping = true;
    });
  try {
    await sequelize.authenticate();
    logger.info("Deployment worker started");
    while (!stopping) {
      if (Date.now() >= nextSnapshot) {
        nextSnapshot = Date.now() + 30000;
        try {
          await reportQueueHealth(sequelize, logger);
        } catch {
          logger.error(
            { event: "queue.snapshot_failed" },
            "Queue monitoring unavailable",
          );
        }
      }
      try {
        const deployment = await measureJob(logger, () => service.processNext());
        const monitor = await incidents.processMonitor();
        const push = await incidents.processNotification();
        if (!deployment && !monitor && !push) await delay(1500);
      } catch {
        await delay(5000);
      }
    }
  } finally {
    await sequelize.close();
  }
}
main().catch(() => {
  console.error(
    "Deployment worker failed to start; check server configuration.",
  );
  process.exitCode = 1;
});

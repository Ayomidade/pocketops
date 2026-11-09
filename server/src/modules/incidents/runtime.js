import { credentialVault } from "../deployments/crypto.js";
import { createIncidentRepository } from "./repository.js";
import { createIncidentService } from "./service.js";
import { createHealthProbe } from "./health-adapter.js";
import { createPushAdapter } from "./push-adapter.js";
export function createIncidentRuntime({
  sequelize,
  models,
  config,
  deployments,
}) {
  if (!models || !deployments || !config.providerActiveKeyVersion) return null;
  return createIncidentService({
    repository: createIncidentRepository({ sequelize, models }),
    deployments,
    probe: createHealthProbe(),
    push: createPushAdapter({ accessToken: config.expoPushAccessToken }),
    vault: credentialVault({
      keys: config.providerEncryptionKeys,
      activeVersion: config.providerActiveKeyVersion,
      namespace: "push",
    }),
  });
}

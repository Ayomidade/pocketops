import { credentialVault } from "./crypto.js";
import { RenderAdapter } from "./render-adapter.js";
import { createDeploymentRepository } from "./repository.js";
import { createDeploymentService } from "./service.js";
export function createDeploymentRuntime({ config, sequelize, models, githubService }) {
  if (!models || !githubService || !config.providerActiveKeyVersion) return null;
  return createDeploymentService({ repository: createDeploymentRepository({ sequelize, models }), githubService,
    adapter: new RenderAdapter(), vault: credentialVault({ keys: config.providerEncryptionKeys, activeVersion: config.providerActiveKeyVersion }), config });
}

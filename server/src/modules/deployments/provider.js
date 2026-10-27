// Provider contract: adapters return allowlisted DTOs and safe AppErrors only.
// No automatic mutation retries. Unknown write outcomes require reconciliation.
export class DeploymentProvider {
  async listServices() { throw new Error("Not implemented"); }
  async getService() { throw new Error("Not implemented"); }
  async listDeployments() { throw new Error("Not implemented"); }
  async getDeployment() { throw new Error("Not implemented"); }
  async getLogs() { throw new Error("Not implemented"); }
  async requestDeployment() { throw new Error("Not implemented"); }
}

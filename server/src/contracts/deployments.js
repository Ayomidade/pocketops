export function registerDeploymentContract({ schemas, endpoint, parameter }) {
  const str = { type: "string" }; const nullable = { type: "string", nullable: true }; const bool = { type: "boolean" };
  const obj = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
  const list = (name) => obj({ items: { type: "array", items: ref(name) }, nextCursor: nullable });
  const cap = obj({ canRedeploy: bool, canRollback: { type: "boolean", enum: [false] }, canPromote: { type: "boolean", enum: [false] }, supportsLogs: bool, supportsHealthVerification: { type: "boolean", enum: [false] } });
  const connection = obj({ id: str, provider: { type: "string", enum: ["render"] }, displayName: str, status: { type: "string", enum: ["active", "revoked"] }, revokedAt: nullable });
  const service = obj({ id: str, name: str, ownerId: str, type: str, branch: nullable, repositoryFullName: nullable, suspended: str, capabilities: cap });
  const project = obj({ id: str, name: str, repositoryId: str, connectionId: str, providerServiceId: str, status: str });
  const health = { type: "string", enum: ["not_checked"] };
  const operation = obj({ operationId: str, projectId: str, action: { type: "string", enum: ["redeploy"] }, status: { type: "string", enum: ["queued", "validating", "requesting", "accepted", "succeeded", "failed", "unknown"] }, deploymentId: nullable, providerReference: nullable, targetDeploymentId: str, commitSha: str, errorCode: nullable, healthStatus: health, reconciliationRequired: bool });
  Object.assign(schemas, {
    ProviderConnection: connection, ProviderConnections: list("ProviderConnection"), RenderService: service, RenderServices: list("RenderService"),
    Project: project, Projects: list("Project"),
    ProjectDetail: obj({ ...project.properties, service: ref("RenderService"), capabilities: cap, pendingOperation: { ...operation, nullable: true }, redeployTarget: { ...obj({ providerDeploymentId: str, commitSha: str }), nullable: true }, healthStatus: health }),
    Deployment: obj({ id: str, projectId: str, providerDeploymentId: str, status: { type: "string", enum: ["queued", "requested", "building", "live", "failed", "canceled", "unknown"] }, providerStatus: str, commitSha: nullable, startedAt: nullable, finishedAt: nullable, healthStatus: health }),
    Deployments: list("Deployment"), DeploymentOperation: operation,
    DeploymentLogs: obj({ items: { type: "array", maxItems: 100, items: obj({ id: str, timestamp: str, level: str, message: { type: "string", maxLength: 4096 } }) }, nextCursor: nullable, truncated: bool, from: str, to: str, redactionNotice: str }),
  });
  const uuid = { type: "string", format: "uuid" };
  const name = { type: "string", minLength: 1, maxLength: 100 };
  const page = [parameter("limit", "query", { type: "integer", minimum: 1, maximum: 50, default: 20 }), parameter("cursor", "query", { type: "string", maxLength: 1000 })];
  endpoint("/provider-connections/render", "post", "connectRender", ref("ProviderConnection"), { status: 201, body: obj({ displayName: name, apiKey: { type: "string", minLength: 10, maxLength: 512, pattern: "^[\\x21-\\x7e]+$", writeOnly: true } }) });
  endpoint("/provider-connections", "get", "listProviderConnections", ref("ProviderConnections"), { parameters: [page[0], parameter("cursor", "query", uuid)] });
  endpoint("/provider-connections/{id}", "delete", "disconnectRender", obj({ disconnected: bool }));
  endpoint("/provider-connections/{id}/services", "get", "listRenderServices", ref("RenderServices"), { parameters: page });
  endpoint("/projects", "get", "listProjects", ref("Projects"), { parameters: [page[0], parameter("cursor", "query", uuid)] });
  endpoint("/projects", "post", "createProject", ref("Project"), { status: 201, body: obj({ name, repositoryId: uuid, connectionId: uuid, providerServiceId: { type: "string", pattern: "^srv-[a-zA-Z0-9]+$", maxLength: 100 } }) });
  endpoint("/projects/{id}", "get", "getProject", ref("ProjectDetail"));
  endpoint("/projects/{id}", "patch", "updateProject", ref("Project"), { body: obj({ name }) });
  endpoint("/projects/{id}/deployments", "get", "listDeployments", ref("Deployments"), { parameters: page });
  endpoint("/projects/{id}/logs", "get", "listDeploymentLogs", ref("DeploymentLogs"), { parameters: ["from", "to"].map((n) => parameter(n, "query", { type: "string", format: "date-time", description: "Ordered window of at most one hour; preserve for cursor pagination." })).concat([
    parameter("limit", "query", { type: "integer", minimum: 1, maximum: 100, default: 50 }), parameter("cursor", "query", { type: "string", maxLength: 2048 }), parameter("level", "query", { type: "string", enum: ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"] }),
  ]) });
  endpoint("/projects/{id}/deployments", "post", "requestRedeployment", ref("DeploymentOperation"), { status: 202, parameters: [parameter("Idempotency-Key", "header", { type: "string", pattern: "^[A-Za-z0-9._-]{16,100}$" }, true)], body: obj({ action: { type: "string", enum: ["redeploy"] }, confirmation: { type: "string", enum: ["DEPLOY"] }, target: obj({ serviceId: { type: "string", pattern: "^srv-[a-zA-Z0-9]+$", maxLength: 100 }, deploymentId: { type: "string", pattern: "^dep-[a-zA-Z0-9]+$", maxLength: 100 }, commitSha: { type: "string", pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" } }) }) });
  endpoint("/operations/{id}", "get", "getDeploymentOperation", ref("DeploymentOperation"));
  endpoint("/deployments/{id}", "get", "getDeployment", ref("Deployment"));
}

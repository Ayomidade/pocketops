import { DataTypes as T } from "sequelize";
export function defineDeploymentModels(sequelize) {
  const uuid = { type: T.UUID, defaultValue: T.UUIDV4, primaryKey: true };
  const str = (field, size = 100) => ({ type: T.STRING(size), field });
  const date = (field) => ({ type: T.DATE, field });
  const define = (name, tableName, attributes) => sequelize.define(name, { id: uuid, ...attributes }, { tableName, underscored: true });
  const ProviderConnection = define("ProviderConnection", "provider_connections", {
    userId: { type: T.UUID, field: "user_id" }, provider: T.STRING(24), displayName: str("display_name"),
    encryptedCredentials: { type: T.TEXT, field: "encrypted_credentials" }, keyVersion: str("key_version", 32), status: T.STRING(24), revokedAt: date("revoked_at"),
  });
  const Project = define("Project", "projects", {
    userId: { type: T.UUID, field: "user_id" }, repositoryId: { type: T.UUID, field: "repository_id" },
    connectionId: { type: T.UUID, field: "connection_id" }, providerServiceId: str("provider_service_id"), name: T.STRING(100), status: T.STRING(24),
  });
  const Deployment = define("Deployment", "deployments", {
    projectId: { type: T.UUID, field: "project_id" }, providerDeploymentId: str("provider_deployment_id"), status: T.STRING(24),
    providerStatus: str("provider_status", 50), commitSha: str("commit_sha", 64), startedAt: date("started_at"), finishedAt: date("finished_at"),
    healthStatus: { ...str("health_status", 24), defaultValue: "not_checked" },
  });
  const OperationRequest = define("OperationRequest", "operation_requests", {
    actorId: { type: T.UUID, field: "actor_id" }, projectId: { type: T.UUID, field: "project_id" }, action: T.STRING(24),
    idempotencyKey: str("idempotency_key"), requestHash: str("request_hash", 64), targetDeploymentId: str("target_deployment_id"), commitSha: str("commit_sha", 64),
    status: T.STRING(24), providerReference: str("provider_reference"), deploymentId: { type: T.UUID, field: "deployment_id" }, errorCode: str("error_code", 80),
    requestId: str("request_id"), attempts: { type: T.INTEGER, defaultValue: 0 }, nextAttemptAt: date("next_attempt_at"),
    claimToken: { type: T.UUID, field: "claim_token" }, claimExpiresAt: date("claim_expires_at"),
  });
  return { ProviderConnection, Project, Deployment, OperationRequest };
}

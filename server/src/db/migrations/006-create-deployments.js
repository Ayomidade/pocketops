import { DataTypes as T } from "sequelize";

export async function up(q, _Sequelize, transaction) {
  const options = { transaction };
  const id = () => ({ type: T.UUID, primaryKey: true, allowNull: false });
  const fk = (model) => ({ type: T.UUID, allowNull: false, references: { model, key: "id" }, onDelete: "RESTRICT" });
  const text = (size) => ({ type: T.STRING(size), allowNull: false });
  const timestamps = () => ({ created_at: { type: T.DATE, allowNull: false, defaultValue: T.NOW }, updated_at: { type: T.DATE, allowNull: false, defaultValue: T.NOW } });
  await q.createTable("provider_connections", {
    id: id(), user_id: fk("users"), provider: text(24), display_name: text(100),
    encrypted_credentials: { type: T.TEXT }, key_version: text(32), status: text(24), revoked_at: { type: T.DATE }, ...timestamps(),
  }, options);
  await q.addConstraint("provider_connections", { fields: ["user_id", "id"], type: "unique", name: "provider_connection_owner_unique", transaction });
  await q.addConstraint("provider_connections", { fields: ["status"], type: "check", where: { status: ["active", "revoked"] }, name: "provider_connection_status_check", transaction });
  await q.createTable("projects", {
    id: id(), user_id: fk("users"), repository_id: fk("repositories"), connection_id: fk("provider_connections"),
    provider_service_id: text(100), name: text(100), status: text(24), ...timestamps(),
  }, options);
  await q.addConstraint("projects", { fields: ["connection_id", "provider_service_id"], type: "unique", name: "project_service_unique", transaction });
  await q.addConstraint("projects", { fields: ["user_id", "provider_service_id"], type: "unique", name: "project_owner_service_unique", transaction });
  await q.sequelize.query('ALTER TABLE projects ADD CONSTRAINT project_connection_owner_fk FOREIGN KEY (user_id, connection_id) REFERENCES provider_connections(user_id, id)', options);
  await q.addIndex("projects", ["user_id", "created_at", "id"], options);
  await q.createTable("deployments", {
    id: id(), project_id: fk("projects"), provider_deployment_id: text(100), status: text(24), provider_status: text(50),
    commit_sha: { type: T.STRING(64) }, started_at: { type: T.DATE }, finished_at: { type: T.DATE },
    health_status: { ...text(24), defaultValue: "not_checked" }, ...timestamps(),
  }, options);
  await q.addConstraint("deployments", { fields: ["project_id", "provider_deployment_id"], type: "unique", name: "deployment_provider_unique", transaction });
  await q.addIndex("deployments", ["project_id", "created_at"], options);
  await q.createTable("operation_requests", {
    id: id(), actor_id: fk("users"), project_id: fk("projects"), action: text(24), idempotency_key: text(100), request_hash: text(64),
    target_deployment_id: text(100), commit_sha: text(64), status: text(24), provider_reference: { type: T.STRING(100) },
    deployment_id: { ...fk("deployments"), allowNull: true }, error_code: { type: T.STRING(80) }, request_id: text(100),
    attempts: { type: T.INTEGER, allowNull: false, defaultValue: 0 }, next_attempt_at: { type: T.DATE, allowNull: false },
    claim_token: { type: T.UUID }, claim_expires_at: { type: T.DATE }, ...timestamps(),
  }, options);
  await q.addConstraint("operation_requests", { fields: ["actor_id", "idempotency_key"], type: "unique", name: "operation_actor_key_unique", transaction });
  await q.addConstraint("operation_requests", { fields: ["status"], type: "check", where: { status: ["queued", "validating", "requesting", "accepted", "succeeded", "failed", "unknown"] }, name: "operation_status_check", transaction });
  await q.sequelize.query("CREATE UNIQUE INDEX operation_project_active_unique ON operation_requests(project_id) WHERE status IN ('queued','validating','requesting','accepted','unknown')", options);
  await q.addIndex("operation_requests", ["status", "next_attempt_at"], options);
  await q.addColumn("auth_audit_events", "operation_request_id", { type: T.UUID, references: { model: "operation_requests", key: "id" }, onDelete: "SET NULL" }, options);
  await q.addIndex("auth_audit_events", ["operation_request_id"], options);
}
export async function down(q, _Sequelize, transaction) {
  const options = { transaction };
  await q.removeColumn("auth_audit_events", "operation_request_id", options);
  for (const table of ["operation_requests", "deployments", "projects", "provider_connections"]) await q.dropTable(table, options);
}

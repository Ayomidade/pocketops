import { DataTypes } from "sequelize";

export async function up(queryInterface, _Sequelize, transaction) {
  await queryInterface.createTable(
    "code_changes",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      actor_user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      repository_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "repositories", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      operation_type: { type: DataTypes.STRING(24), allowNull: false },
      idempotency_key: { type: DataTypes.STRING(100), allowNull: false },
      request_fingerprint: { type: DataTypes.CHAR(64), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false },
      branch_name: { type: DataTypes.STRING(255), allowNull: true },
      base_branch: { type: DataTypes.STRING(255), allowNull: true },
      base_sha: { type: DataTypes.STRING(64), allowNull: true },
      file_path: { type: DataTypes.STRING(1024), allowNull: true },
      expected_file_sha: { type: DataTypes.STRING(64), allowNull: true },
      content_sha: { type: DataTypes.CHAR(64), allowNull: true },
      commit_sha: { type: DataTypes.STRING(64), allowNull: true },
      pull_request_number: { type: DataTypes.INTEGER, allowNull: true },
      pull_request_url: { type: DataTypes.TEXT, allowNull: true },
      pull_request_state: { type: DataTypes.STRING(16), allowNull: true },
      result_metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      error_code: { type: DataTypes.STRING(80), allowNull: true },
      error_status: { type: DataTypes.INTEGER, allowNull: true },
      error_message: { type: DataTypes.STRING(200), allowNull: true },
      request_id: { type: DataTypes.STRING(100), allowNull: false },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    { transaction },
  );
  await queryInterface.addConstraint("code_changes", {
    fields: ["actor_user_id", "idempotency_key"],
    type: "unique",
    name: "code_changes_actor_idempotency_unique",
    transaction,
  });
  await queryInterface.addConstraint("code_changes", {
    fields: ["operation_type"],
    type: "check",
    where: {
      operation_type: ["branch", "commit", "pull_request"],
    },
    name: "code_changes_operation_type_check",
    transaction,
  });
  await queryInterface.addConstraint("code_changes", {
    fields: ["status"],
    type: "check",
    where: { status: ["pending", "succeeded", "failed", "uncertain"] },
    name: "code_changes_status_check",
    transaction,
  });
  await queryInterface.addIndex(
    "code_changes",
    ["repository_id", "actor_user_id", "operation_type", "status"],
    { name: "code_changes_repository_actor_type_status_index", transaction },
  );
  await queryInterface.addColumn(
    "auth_audit_events",
    "code_change_id",
    {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "code_changes", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    { transaction },
  );
  await queryInterface.addIndex("auth_audit_events", ["code_change_id"], {
    name: "auth_audit_code_change_index",
    transaction,
  });
}

export async function down(queryInterface, _Sequelize, transaction) {
  await queryInterface.removeIndex(
    "auth_audit_events",
    "auth_audit_code_change_index",
    { transaction },
  );
  await queryInterface.removeColumn("auth_audit_events", "code_change_id", {
    transaction,
  });
  await queryInterface.dropTable("code_changes", { transaction });
}

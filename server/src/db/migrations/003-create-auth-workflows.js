import { DataTypes } from "sequelize";

export async function up(queryInterface, _Sequelize, transaction) {
  await queryInterface.createTable(
    "oauth_transactions",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      state_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      completion_secret_hash: { type: DataTypes.CHAR(64), allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      redirect_uri: { type: DataTypes.TEXT, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      consumed_at: { type: DataTypes.DATE, allowNull: true },
      handoff_hash: { type: DataTypes.CHAR(64), allowNull: true, unique: true },
      handoff_expires_at: { type: DataTypes.DATE, allowNull: true },
      handoff_consumed_at: { type: DataTypes.DATE, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    { transaction },
  );
  await queryInterface.addIndex("oauth_transactions", ["expires_at"], {
    name: "oauth_transactions_expiry_index",
    transaction,
  });
  await queryInterface.addIndex("oauth_transactions", ["handoff_expires_at"], {
    name: "oauth_transactions_handoff_expiry_index",
    transaction,
  });

  await queryInterface.createTable(
    "auth_audit_events",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      actor_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      action: { type: DataTypes.STRING(64), allowNull: false },
      request_id: { type: DataTypes.STRING(100), allowNull: false },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    { transaction },
  );
  await queryInterface.addIndex(
    "auth_audit_events",
    ["actor_user_id", "created_at"],
    { name: "auth_audit_actor_time_index", transaction },
  );
  await queryInterface.addIndex("auth_audit_events", ["action", "created_at"], {
    name: "auth_audit_action_time_index",
    transaction,
  });
}

export async function down(queryInterface, _Sequelize, transaction) {
  await queryInterface.dropTable("auth_audit_events", { transaction });
  await queryInterface.dropTable("oauth_transactions", { transaction });
}

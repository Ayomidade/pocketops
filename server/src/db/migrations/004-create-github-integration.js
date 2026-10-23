import { DataTypes } from "sequelize";

export async function up(queryInterface, _Sequelize, transaction) {
  await queryInterface.createTable(
    "github_installation_links",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      state_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      install_state_hash: {
        type: DataTypes.CHAR(64),
        allowNull: true,
        unique: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      github_user_id: { type: DataTypes.BIGINT, allowNull: false },
      access_token_encrypted: { type: DataTypes.TEXT, allowNull: true },
      refresh_token_encrypted: { type: DataTypes.TEXT, allowNull: true },
      access_token_expires_at: { type: DataTypes.DATE, allowNull: true },
      refresh_token_expires_at: { type: DataTypes.DATE, allowNull: true },
      authorization_consumed_at: { type: DataTypes.DATE, allowNull: true },
      installation_id: { type: DataTypes.BIGINT, allowNull: true },
      callback_received_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    { transaction },
  );
  await queryInterface.addIndex(
    "github_installation_links",
    ["user_id", "expires_at"],
    { name: "github_installation_links_user_expiry_index", transaction },
  );

  await queryInterface.createTable(
    "github_installations",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      github_installation_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
      },
      github_account_id: { type: DataTypes.BIGINT, allowNull: false },
      account_login: { type: DataTypes.STRING(255), allowNull: false },
      account_type: { type: DataTypes.STRING(30), allowNull: false },
      repository_selection: { type: DataTypes.STRING(20), allowNull: false },
      permissions: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      suspended_at: { type: DataTypes.DATE, allowNull: true },
      removed_at: { type: DataTypes.DATE, allowNull: true },
      last_synced_at: { type: DataTypes.DATE, allowNull: true },
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

  await queryInterface.createTable(
    "installation_memberships",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      installation_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "github_installations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      github_user_id: { type: DataTypes.BIGINT, allowNull: false },
      github_user_token_encrypted: { type: DataTypes.TEXT, allowNull: false },
      github_refresh_token_encrypted: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      access_token_expires_at: { type: DataTypes.DATE, allowNull: false },
      refresh_token_expires_at: { type: DataTypes.DATE, allowNull: false },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "active",
      },
      last_verified_at: { type: DataTypes.DATE, allowNull: true },
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
  await queryInterface.addConstraint("installation_memberships", {
    fields: ["installation_id", "user_id"],
    type: "unique",
    name: "installation_memberships_installation_user_unique",
    transaction,
  });
  await queryInterface.addIndex(
    "installation_memberships",
    ["user_id", "status"],
    { name: "installation_memberships_user_status_index", transaction },
  );

  await queryInterface.createTable(
    "repositories",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      installation_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "github_installations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      github_repository_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
      },
      owner_login: { type: DataTypes.STRING(255), allowNull: false },
      owner_github_id: { type: DataTypes.BIGINT, allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      full_name: { type: DataTypes.STRING(511), allowNull: false },
      default_branch: { type: DataTypes.STRING(255), allowNull: true },
      is_private: { type: DataTypes.BOOLEAN, allowNull: false },
      is_archived: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      removed_at: { type: DataTypes.DATE, allowNull: true },
      last_synced_at: { type: DataTypes.DATE, allowNull: true },
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
  await queryInterface.addIndex(
    "repositories",
    ["installation_id", "removed_at"],
    { name: "repositories_installation_active_index", transaction },
  );

  await queryInterface.createTable(
    "repository_selections",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      repository_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "repositories", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      selected_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    { transaction },
  );
  await queryInterface.addConstraint("repository_selections", {
    fields: ["repository_id", "user_id"],
    type: "unique",
    name: "repository_selections_repo_user_unique",
    transaction,
  });
  await queryInterface.addIndex(
    "repository_selections",
    ["user_id", "selected_at"],
    { name: "repository_selections_user_selected_index", transaction },
  );

  await queryInterface.createTable(
    "webhook_deliveries",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      delivery_id: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      event_type: { type: DataTypes.STRING(80), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending",
      },
      attempt_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      received_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      next_attempt_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      claim_expires_at: { type: DataTypes.DATE, allowNull: true },
      processed_at: { type: DataTypes.DATE, allowNull: true },
      last_error_code: { type: DataTypes.STRING(80), allowNull: true },
    },
    { transaction },
  );
  await queryInterface.addIndex(
    "webhook_deliveries",
    ["status", "next_attempt_at"],
    {
      name: "webhook_deliveries_queue_index",
      transaction,
    },
  );

  await queryInterface.addIndex("webhook_deliveries", ["received_at"], {
    name: "webhook_deliveries_received_index",
    transaction,
  });
}

export async function down(queryInterface, _Sequelize, transaction) {
  for (const table of [
    "webhook_deliveries",
    "repository_selections",
    "repositories",
    "installation_memberships",
    "github_installations",
    "github_installation_links",
  ]) {
    await queryInterface.dropTable(table, { transaction });
  }
}

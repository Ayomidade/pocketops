import { DataTypes } from "sequelize";

export function defineModels(sequelize) {
  const User = sequelize.define(
    "User",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      githubUserId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: "users_github_user_id_unique",
        field: "github_user_id",
      },
      username: { type: DataTypes.STRING(100), allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: true },
      avatarUrl: { type: DataTypes.TEXT, allowNull: true, field: "avatar_url" },
    },
    {
      tableName: "users",
      underscored: true,
    },
  );

  const Session = sequelize.define(
    "Session",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "user_id",
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      tokenHash: {
        type: DataTypes.CHAR(64),
        allowNull: false,
        unique: "sessions_token_hash_unique",
        field: "token_hash",
      },
      deviceLabel: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "device_label",
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "expires_at",
      },
      revokedAt: { type: DataTypes.DATE, allowNull: true, field: "revoked_at" },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "last_used_at",
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "created_at",
      },
    },
    {
      tableName: "sessions",
      timestamps: false,
    },
  );

  const OAuthTransaction = sequelize.define(
    "OAuthTransaction",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      stateHash: {
        type: DataTypes.CHAR(64),
        allowNull: false,
        unique: true,
        field: "state_hash",
      },
      completionSecretHash: {
        type: DataTypes.CHAR(64),
        allowNull: false,
        field: "completion_secret_hash",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "user_id",
      },
      redirectUri: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: "redirect_uri",
      },
      expiresAt: { type: DataTypes.DATE, allowNull: false, field: "expires_at" },
      consumedAt: { type: DataTypes.DATE, allowNull: true, field: "consumed_at" },
      handoffHash: {
        type: DataTypes.CHAR(64),
        allowNull: true,
        unique: true,
        field: "handoff_hash",
      },
      handoffExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "handoff_expires_at",
      },
      handoffConsumedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "handoff_consumed_at",
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "created_at",
      },
    },
    {
      tableName: "oauth_transactions",
      timestamps: false,
    },
  );

  const AuthAuditEvent = sequelize.define(
    "AuthAuditEvent",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      actorUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "actor_user_id",
      },
      action: { type: DataTypes.STRING(64), allowNull: false },
      requestId: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "request_id",
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "created_at",
      },
    },
    { tableName: "auth_audit_events", timestamps: false },
  );

  const GitHubInstallationLink = sequelize.define(
    "GitHubInstallationLink",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      stateHash: {
        type: DataTypes.CHAR(64),
        allowNull: false,
        unique: true,
        field: "state_hash",
      },
      installStateHash: {
        type: DataTypes.CHAR(64),
        allowNull: true,
        unique: true,
        field: "install_state_hash",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "user_id",
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      githubUserId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        field: "github_user_id",
      },
      accessTokenEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "access_token_encrypted",
      },
      refreshTokenEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "refresh_token_encrypted",
      },
      accessTokenExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "access_token_expires_at",
      },
      refreshTokenExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "refresh_token_expires_at",
      },
      authorizationConsumedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "authorization_consumed_at",
      },
      installationId: {
        type: DataTypes.BIGINT,
        allowNull: true,
        field: "installation_id",
      },
      callbackReceivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "callback_received_at",
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "completed_at",
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "expires_at",
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "created_at",
      },
    },
    { tableName: "github_installation_links", timestamps: false },
  );

  const GitHubInstallation = sequelize.define(
    "GitHubInstallation",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      githubInstallationId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
        field: "github_installation_id",
      },
      githubAccountId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        field: "github_account_id",
      },
      accountLogin: { type: DataTypes.STRING(255), allowNull: false, field: "account_login" },
      accountType: { type: DataTypes.STRING(30), allowNull: false, field: "account_type" },
      repositorySelection: {
        type: DataTypes.STRING(20),
        allowNull: false,
        field: "repository_selection",
      },
      permissions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      suspendedAt: { type: DataTypes.DATE, allowNull: true, field: "suspended_at" },
      removedAt: { type: DataTypes.DATE, allowNull: true, field: "removed_at" },
      lastSyncedAt: { type: DataTypes.DATE, allowNull: true, field: "last_synced_at" },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
      updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
    },
    { tableName: "github_installations", timestamps: false },
  );

  const InstallationMembership = sequelize.define(
    "InstallationMembership",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      installationId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "installation_id",
        references: { model: "github_installations", key: "id" },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "user_id",
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      githubUserId: { type: DataTypes.BIGINT, allowNull: false, field: "github_user_id" },
      githubUserTokenEncrypted: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: "github_user_token_encrypted",
      },
      githubRefreshTokenEncrypted: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: "github_refresh_token_encrypted",
      },
      accessTokenExpiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "access_token_expires_at",
      },
      refreshTokenExpiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "refresh_token_expires_at",
      },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "active" },
      lastVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "last_verified_at",
      },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
      updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
    },
    { tableName: "installation_memberships", timestamps: false },
  );

  const GitHubRepository = sequelize.define(
    "GitHubRepository",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      installationId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "installation_id",
        references: { model: "github_installations", key: "id" },
        onDelete: "CASCADE",
      },
      githubRepositoryId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
        field: "github_repository_id",
      },
      ownerLogin: { type: DataTypes.STRING(255), allowNull: false, field: "owner_login" },
      ownerGithubId: { type: DataTypes.BIGINT, allowNull: false, field: "owner_github_id" },
      name: { type: DataTypes.STRING(255), allowNull: false },
      fullName: { type: DataTypes.STRING(511), allowNull: false, field: "full_name" },
      defaultBranch: { type: DataTypes.STRING(255), allowNull: true, field: "default_branch" },
      isPrivate: { type: DataTypes.BOOLEAN, allowNull: false, field: "is_private" },
      isArchived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_archived" },
      removedAt: { type: DataTypes.DATE, allowNull: true, field: "removed_at" },
      lastSyncedAt: { type: DataTypes.DATE, allowNull: true, field: "last_synced_at" },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
      updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
    },
    { tableName: "repositories", timestamps: false },
  );

  const RepositorySelection = sequelize.define(
    "RepositorySelection",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      repositoryId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "repository_id",
        references: { model: "repositories", key: "id" },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "user_id",
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      selectedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "selected_at",
      },
    },
    { tableName: "repository_selections", timestamps: false },
  );

  const WebhookDelivery = sequelize.define(
    "WebhookDelivery",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      deliveryId: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        field: "delivery_id",
      },
      eventType: { type: DataTypes.STRING(80), allowNull: false, field: "event_type" },
      payload: { type: DataTypes.JSONB, allowNull: false },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pending" },
      attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "attempt_count",
      },
      receivedAt: { type: DataTypes.DATE, allowNull: false, field: "received_at" },
      nextAttemptAt: { type: DataTypes.DATE, allowNull: false, field: "next_attempt_at" },
      claimExpiresAt: { type: DataTypes.DATE, allowNull: true, field: "claim_expires_at" },
      processedAt: { type: DataTypes.DATE, allowNull: true, field: "processed_at" },
      lastErrorCode: { type: DataTypes.STRING(80), allowNull: true, field: "last_error_code" },
    },
    { tableName: "webhook_deliveries", timestamps: false },
  );

  User.hasMany(Session, { foreignKey: "userId", as: "sessions" });
  Session.belongsTo(User, { foreignKey: "userId", as: "user" });
  User.hasMany(OAuthTransaction, {
    foreignKey: "userId",
    as: "oauthTransactions",
  });
  OAuthTransaction.belongsTo(User, { foreignKey: "userId", as: "user" });
  User.hasMany(AuthAuditEvent, { foreignKey: "actorUserId", as: "authEvents" });
  AuthAuditEvent.belongsTo(User, { foreignKey: "actorUserId", as: "actor" });
  User.hasMany(GitHubInstallationLink, { foreignKey: "userId", as: "githubInstallationLinks" });
  GitHubInstallationLink.belongsTo(User, { foreignKey: "userId", as: "user" });
  GitHubInstallation.hasMany(InstallationMembership, { foreignKey: "installationId", as: "memberships" });
  InstallationMembership.belongsTo(GitHubInstallation, { foreignKey: "installationId", as: "installation" });
  User.hasMany(InstallationMembership, { foreignKey: "userId", as: "githubMemberships" });
  InstallationMembership.belongsTo(User, { foreignKey: "userId", as: "user" });
  GitHubInstallation.hasMany(GitHubRepository, { foreignKey: "installationId", as: "repositories" });
  GitHubRepository.belongsTo(GitHubInstallation, { foreignKey: "installationId", as: "installation" });
  User.hasMany(RepositorySelection, { foreignKey: "userId", as: "repositorySelections" });
  GitHubRepository.hasMany(RepositorySelection, { foreignKey: "repositoryId", as: "selections" });
  RepositorySelection.belongsTo(User, { foreignKey: "userId", as: "user" });
  RepositorySelection.belongsTo(GitHubRepository, { foreignKey: "repositoryId", as: "repository" });
  return {
    User,
    Session,
    OAuthTransaction,
    AuthAuditEvent,
    GitHubInstallationLink,
    GitHubInstallation,
    InstallationMembership,
    GitHubRepository,
    RepositorySelection,
    WebhookDelivery,
  };
}

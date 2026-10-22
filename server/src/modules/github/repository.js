import { Op } from "sequelize";

function safeInstallation(installation) {
  return {
    id: installation.id,
    githubInstallationId: String(installation.githubInstallationId),
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    repositorySelection: installation.repositorySelection,
    suspended: Boolean(installation.suspendedAt),
    lastSyncedAt: installation.lastSyncedAt,
  };
}

function safeRepository(repository, selected = false) {
  return {
    id: repository.id,
    githubRepositoryId: String(repository.githubRepositoryId),
    owner: repository.ownerLogin,
    name: repository.name,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    private: repository.isPrivate,
    archived: repository.isArchived,
    selected,
    lastSyncedAt: repository.lastSyncedAt,
  };
}

export function createGitHubRepository({ sequelize, models }) {
  const {
    AuthAuditEvent,
    GitHubInstallation,
    GitHubInstallationLink,
    GitHubRepository,
    InstallationMembership,
    RepositorySelection,
    User,
    WebhookDelivery,
  } = models;

  async function recordAudit({ userId = null, action, requestId, metadata = {} }, transaction) {
    await AuthAuditEvent.create(
      {
        actorUserId: userId,
        action,
        requestId,
        metadata,
      },
      { transaction },
    );
  }

  async function upsertRepositories(installationId, repositories, transaction) {
    const saved = [];
    for (const repo of repositories) {
      const [record, created] = await GitHubRepository.findOrCreate({
        where: { githubRepositoryId: repo.id },
        defaults: {
          installationId,
          githubRepositoryId: repo.id,
          ownerLogin: repo.owner,
          ownerGithubId: repo.ownerId,
          name: repo.name,
          fullName: repo.fullName,
          defaultBranch: repo.defaultBranch,
          isPrivate: repo.isPrivate,
          isArchived: repo.isArchived,
          removedAt: null,
          lastSyncedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        transaction,
      });
      if (!created && record.installationId !== installationId) {
        await RepositorySelection.destroy({
          where: { repositoryId: record.id },
          transaction,
        });
      }
      Object.assign(record, {
        installationId,
        ownerLogin: repo.owner,
        ownerGithubId: repo.ownerId,
        name: repo.name,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        isPrivate: repo.isPrivate,
        isArchived: repo.isArchived,
        removedAt: null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      });
      await record.save({ transaction });
      saved.push(record);
    }
    return saved;
  }

  async function reconcileRepositories(installationId, repositories, transaction) {
    const saved = await upsertRepositories(installationId, repositories, transaction);
    const currentIds = saved.map((repo) => repo.id);
    const staleWhere = {
      installationId,
      removedAt: null,
      ...(currentIds.length ? { id: { [Op.notIn]: currentIds } } : {}),
    };
    const stale = await GitHubRepository.findAll({
      where: staleWhere,
      attributes: ["id"],
      transaction,
    });
    if (stale.length) {
      const staleIds = stale.map((repo) => repo.id);
      await GitHubRepository.update(
        { removedAt: new Date(), updatedAt: new Date() },
        { where: { id: staleIds }, transaction },
      );
      await RepositorySelection.destroy({
        where: { repositoryId: staleIds },
        transaction,
      });
    }
    return saved;
  }

  async function upsertInstallation(installation, transaction) {
    const [record, created] = await GitHubInstallation.findOrCreate({
      where: { githubInstallationId: installation.id },
      defaults: {
        githubInstallationId: installation.id,
        githubAccountId: installation.accountId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        repositorySelection: installation.repositorySelection,
        permissions: installation.permissions,
        suspendedAt: installation.suspendedAt,
        removedAt: null,
        lastSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      transaction,
    });
    Object.assign(record, {
      githubAccountId: installation.accountId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      repositorySelection: installation.repositorySelection,
      permissions: installation.permissions,
      suspendedAt: installation.suspendedAt,
      removedAt: null,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    });
    await record.save({ transaction });
    return { record, created };
  }

  return {
    async createLink(values) {
      return GitHubInstallationLink.create(values);
    },

    async findLinkByState(stateHash, now) {
      return GitHubInstallationLink.findOne({
        where: {
          stateHash,
          authorizationConsumedAt: null,
          expiresAt: { [Op.gt]: now },
        },
      });
    },

    async consumeDeniedLink(linkId, now) {
      const [updated] = await GitHubInstallationLink.update(
        { authorizationConsumedAt: now },
        {
          where: {
            id: linkId,
            authorizationConsumedAt: null,
            expiresAt: { [Op.gt]: now },
          },
        },
      );
      return updated === 1;
    },

    async authorizeLink({
      linkId,
      installStateHash,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      now,
    }) {
      return sequelize.transaction(async (transaction) => {
        const link = await GitHubInstallationLink.findByPk(linkId, {
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (
          !link ||
          link.authorizationConsumedAt ||
          link.expiresAt <= now
        ) {
          return false;
        }
        link.installStateHash = installStateHash;
        link.accessTokenEncrypted = accessTokenEncrypted;
        link.refreshTokenEncrypted = refreshTokenEncrypted;
        link.accessTokenExpiresAt = accessTokenExpiresAt;
        link.refreshTokenExpiresAt = refreshTokenExpiresAt;
        link.authorizationConsumedAt = now;
        await link.save({ transaction });
        return true;
      });
    },

    async updateLinkTokens(linkId, tokens) {
      await GitHubInstallationLink.update(
        {
          accessTokenEncrypted: tokens.accessTokenEncrypted,
          refreshTokenEncrypted: tokens.refreshTokenEncrypted,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        },
        { where: { id: linkId, completedAt: null } },
      );
    },

    async claimInstallationCallback(installStateHash, now) {
      return sequelize.transaction(async (transaction) => {
        const link = await GitHubInstallationLink.findOne({
          where: {
            installStateHash,
            authorizationConsumedAt: { [Op.ne]: null },
            callbackReceivedAt: null,
            completedAt: null,
            expiresAt: { [Op.gt]: now },
          },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (!link) return null;
        link.callbackReceivedAt = now;
        await link.save({ transaction });
        return link;
      });
    },

    async completeInstallation({
      linkId,
      githubInstallationId,
      installation,
      repositories,
      now,
      requestId,
    }) {
      return sequelize.transaction(async (transaction) => {
        const link = await GitHubInstallationLink.findByPk(linkId, {
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (
          !link ||
          !link.authorizationConsumedAt ||
          !link.callbackReceivedAt ||
          link.completedAt ||
          link.expiresAt <= now
        ) {
          return null;
        }
        const user = await User.findByPk(link.userId, { transaction });
        if (!user || String(user.githubUserId) !== String(link.githubUserId)) {
          return null;
        }
        link.installationId = githubInstallationId;
        link.completedAt = now;
        await link.save({ transaction });

        const { record: savedInstallation } = await upsertInstallation(
          installation,
          transaction,
        );
        const [membership] = await InstallationMembership.findOrCreate({
          where: {
            installationId: savedInstallation.id,
            userId: user.id,
          },
          defaults: {
            installationId: savedInstallation.id,
            userId: user.id,
            githubUserId: link.githubUserId,
            githubUserTokenEncrypted: link.accessTokenEncrypted,
            githubRefreshTokenEncrypted: link.refreshTokenEncrypted,
            accessTokenExpiresAt: link.accessTokenExpiresAt,
            refreshTokenExpiresAt: link.refreshTokenExpiresAt,
            status: "active",
            lastVerifiedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          transaction,
        });
        Object.assign(membership, {
          githubUserId: link.githubUserId,
          githubUserTokenEncrypted: link.accessTokenEncrypted,
          githubRefreshTokenEncrypted: link.refreshTokenEncrypted,
          accessTokenExpiresAt: link.accessTokenExpiresAt,
          refreshTokenExpiresAt: link.refreshTokenExpiresAt,
          status: "active",
          lastVerifiedAt: now,
          updatedAt: now,
        });
        await membership.save({ transaction });
        await reconcileRepositories(savedInstallation.id, repositories, transaction);
        await recordAudit(
          {
            userId: user.id,
            action: "github_installation_connected",
            requestId,
            metadata: {
              installationId: String(githubInstallationId),
              accountType: installation.accountType,
            },
          },
          transaction,
        );
        return safeInstallation(savedInstallation);
      });
    },

    async listMemberships(userId) {
      return InstallationMembership.findAll({
        where: { userId, status: "active" },
        include: [{ model: GitHubInstallation, as: "installation" }],
        order: [[{ model: GitHubInstallation, as: "installation" }, "accountLogin", "ASC"]],
      });
    },

    async getMembership(userId, installationId) {
      return InstallationMembership.findOne({
        where: { userId, installationId, status: "active" },
        include: [{ model: GitHubInstallation, as: "installation" }],
      });
    },

    async getMembershipByProviderId(userId, githubInstallationId) {
      return InstallationMembership.findOne({
        where: { userId, status: "active" },
        include: [
          {
            model: GitHubInstallation,
            as: "installation",
            where: { githubInstallationId, removedAt: null, suspendedAt: null },
          },
        ],
      });
    },

    async updateMembershipTokens(membershipId, tokens, now) {
      await InstallationMembership.update(
        {
          githubUserTokenEncrypted: tokens.accessTokenEncrypted,
          githubRefreshTokenEncrypted: tokens.refreshTokenEncrypted,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          lastVerifiedAt: now,
          updatedAt: now,
        },
        { where: { id: membershipId, status: "active" } },
      );
    },

    async withMembershipLock(membershipId, callback) {
      return sequelize.transaction(async (transaction) => {
        const membership = await InstallationMembership.findByPk(membershipId, {
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (!membership) return null;
        return callback(membership, async (tokens) => {
          Object.assign(membership, tokens);
          membership.updatedAt = new Date();
          await membership.save({ transaction });
        });
      });
    },

    async markInstallationStatus(installationId, { suspendedAt, removedAt, now }) {
      await GitHubInstallation.update(
        { suspendedAt, removedAt, updatedAt: now },
        { where: { id: installationId } },
      );
    },

    async revokeMembership(membershipId, userId, requestId, now, reason) {
      return sequelize.transaction(async (transaction) => {
        const membership = await InstallationMembership.findOne({
          where: { id: membershipId, userId, status: "active" },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (!membership) return false;
        membership.status = "revoked";
        membership.updatedAt = now;
        await membership.save({ transaction });
        await recordAudit(
          {
            userId,
            action: "github_installation_access_revoked",
            requestId,
            metadata: { reason },
          },
          transaction,
        );
        return true;
      });
    },

    async listRepositories(userId, installationId = null) {
      const where = { userId };
      if (installationId) where["$repository.installation_id$"] = installationId;
      return RepositorySelection.findAll({
        where,
        include: [
          {
            model: GitHubRepository,
            as: "repository",
            where: { removedAt: null },
            include: [{ model: GitHubInstallation, as: "installation" }],
          },
        ],
        order: [[{ model: GitHubRepository, as: "repository" }, "fullName", "ASC"]],
      });
    },

    async getSelectedRepository(userId, repositoryId) {
      return RepositorySelection.findOne({
        where: { userId },
        include: [
          {
            model: GitHubRepository,
            as: "repository",
            where: { id: repositoryId, removedAt: null },
            include: [{ model: GitHubInstallation, as: "installation" }],
          },
        ],
      });
    },

    async syncRepositoryCatalog(installationId, repositories, now) {
      return sequelize.transaction(async (transaction) => {
        const saved = await reconcileRepositories(installationId, repositories, transaction);
        await GitHubInstallation.update(
          { lastSyncedAt: now, updatedAt: now },
          { where: { id: installationId }, transaction },
        );
        return saved;
      });
    },

    async replaceSelections(userId, installationId, githubRepositoryIds, requestId, now) {
      return sequelize.transaction(async (transaction) => {
        const membership = await InstallationMembership.findOne({
          where: { userId, installationId, status: "active" },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (!membership) return null;
        const repositories = await GitHubRepository.findAll({
          where: {
            installationId,
            removedAt: null,
            githubRepositoryId: githubRepositoryIds,
          },
          transaction,
        });
        if (repositories.length !== new Set(githubRepositoryIds).size) return null;
        const allRepositories = await GitHubRepository.findAll({
          where: { installationId },
          attributes: ["id"],
          transaction,
        });
        await RepositorySelection.destroy({
          where: {
            userId,
            repositoryId: { [Op.in]: allRepositories.map((row) => row.id) },
          },
          transaction,
        });
        if (repositories.length) {
          await RepositorySelection.bulkCreate(
            repositories.map((repository) => ({
              userId,
              repositoryId: repository.id,
              selectedAt: now,
            })),
            { transaction },
          );
        }
        await recordAudit(
          {
            userId,
            action: "github_repositories_selected",
            requestId,
            metadata: { count: repositories.length },
          },
          transaction,
        );
        return repositories.map((repository) => safeRepository(repository, true));
      });
    },

    async removeSelections(repositoryIds, transaction = null) {
      return RepositorySelection.destroy({
        where: { repositoryId: { [Op.in]: repositoryIds } },
        transaction,
      });
    },

    async upsertWebhookDelivery({ deliveryId, eventType, payload, now, ignored = false }) {
      try {
        const [, created] = await WebhookDelivery.findOrCreate({
          where: { deliveryId },
          defaults: {
            deliveryId,
            eventType,
            payload,
            status: ignored ? "ignored" : "pending",
            attemptCount: 0,
            receivedAt: now,
            nextAttemptAt: now,
          },
        });
        return created;
      } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") return false;
        throw error;
      }
    },

    async claimWebhook(now, leaseMs = 30_000) {
      return sequelize.transaction(async (transaction) => {
        const delivery = await WebhookDelivery.findOne({
          where: {
            [Op.or]: [
              { status: "pending", nextAttemptAt: { [Op.lte]: now } },
              { status: "processing", claimExpiresAt: { [Op.lt]: now } },
            ],
          },
          order: [["receivedAt", "ASC"]],
          lock: transaction.LOCK.UPDATE,
          skipLocked: true,
          transaction,
        });
        if (!delivery) return null;
        delivery.status = "processing";
        delivery.attemptCount += 1;
        delivery.claimExpiresAt = new Date(now.getTime() + leaseMs);
        await delivery.save({ transaction });
        return delivery.get({ plain: true });
      });
    },

    async finishWebhook(deliveryId, { success, errorCode = null, now, maxAttempts = 8 }) {
      const delivery = await WebhookDelivery.findByPk(deliveryId);
      if (!delivery) return;
      delivery.claimExpiresAt = null;
      delivery.lastErrorCode = errorCode;
      if (success) {
        delivery.status = "processed";
        delivery.processedAt = now;
      } else if (delivery.attemptCount >= maxAttempts) {
        delivery.status = "failed";
      } else {
        delivery.status = "pending";
        delivery.nextAttemptAt = new Date(
          now.getTime() + Math.min(15 * 60_000, 1000 * 2 ** delivery.attemptCount),
        );
      }
      await delivery.save();
    },

    async processWebhookEvent({ eventType, payload, requestId, now }) {
      return sequelize.transaction(async (transaction) => {
        if (eventType === "github_app_authorization" && payload.senderId) {
          await recordAudit(
            {
              action: "github_user_authorization_revoked",
              requestId,
              metadata: { githubUserId: String(payload.senderId) },
            },
            transaction,
          );
          const memberships = await InstallationMembership.findAll({
            where: { githubUserId: payload.senderId, status: "active" },
            transaction,
          });
          for (const membership of memberships) {
            membership.status = "revoked";
            membership.updatedAt = now;
            await membership.save({ transaction });
            await recordAudit(
              {
                userId: membership.userId,
                action: "github_user_authorization_revoked",
                requestId,
                metadata: { githubUserId: String(payload.senderId) },
              },
              transaction,
            );
          }
          return;
        }
        if (!payload.installationId) return;
        const installation = await GitHubInstallation.findOne({
          where: { githubInstallationId: payload.installationId },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (
          !installation &&
          eventType === "installation" &&
          payload.action === "created" &&
          payload.account
        ) {
          await upsertInstallation(
            {
              id: payload.installationId,
              accountId: payload.account.id,
              accountLogin: payload.account.login,
              accountType: payload.account.type,
              repositorySelection: payload.repositorySelection,
              permissions: payload.permissions,
              suspendedAt: payload.suspendedAt,
            },
            transaction,
          );
          await recordAudit(
            {
              action: "github_installation_created",
              requestId,
              metadata: { installationId: String(payload.installationId) },
            },
            transaction,
          );
          return;
        }
        if (payload.action === "deleted") {
          if (!installation) return;
          installation.removedAt = now;
          installation.updatedAt = now;
          await installation.save({ transaction });
          await recordAudit(
            {
              action: "github_installation_deleted",
              requestId,
              metadata: { installationId: String(payload.installationId) },
            },
            transaction,
          );
          const memberships = await InstallationMembership.findAll({
            where: { installationId: installation.id, status: "active" },
            transaction,
          });
          for (const membership of memberships) {
            membership.status = "revoked";
            membership.updatedAt = now;
            await membership.save({ transaction });
            await recordAudit(
              {
                userId: membership.userId,
                action: "github_installation_removed",
                requestId,
                metadata: { installationId: String(payload.installationId) },
              },
              transaction,
            );
          }
          await GitHubRepository.update(
            { removedAt: now, updatedAt: now },
            { where: { installationId: installation.id, removedAt: null }, transaction },
          );
          await RepositorySelection.destroy({
            where: {
              repositoryId: {
                [Op.in]: await GitHubRepository.findAll({
                  where: { installationId: installation.id },
                  attributes: ["id"],
                  transaction,
                }).then((rows) => rows.map((row) => row.id)),
              },
            },
            transaction,
          });
          return;
        }
        if (!installation) return;
        if (payload.action === "suspend" || payload.action === "unsuspend") {
          installation.suspendedAt = payload.action === "suspend" ? now : null;
          installation.updatedAt = now;
          await installation.save({ transaction });
          await recordAudit(
            {
              action: `github_installation_${payload.action}ed`,
              requestId,
              metadata: { installationId: String(payload.installationId) },
            },
            transaction,
          );
        }
        if (eventType === "installation" && payload.action === "new_permissions_accepted") {
          installation.permissions = payload.permissions;
          installation.repositorySelection = payload.repositorySelection;
          installation.updatedAt = now;
          await installation.save({ transaction });
          await recordAudit(
            {
              action: "github_installation_permissions_updated",
              requestId,
              metadata: { installationId: String(payload.installationId) },
            },
            transaction,
          );
        }
        if (eventType === "installation_repositories") {
          const repositories = await GitHubRepository.findAll({
            where: {
              installationId: installation.id,
              githubRepositoryId: payload.repositoryIds,
            },
            transaction,
          });
          const existingIds = repositories.map((repository) => repository.id);
          if (payload.action === "removed" && existingIds.length) {
            await GitHubRepository.update(
              { removedAt: now, updatedAt: now },
              { where: { id: existingIds }, transaction },
            );
            await RepositorySelection.destroy({
              where: { repositoryId: existingIds },
              transaction,
            });
          }
          if (payload.action === "added" && payload.repositories?.length) {
            await upsertRepositories(installation.id, payload.repositories, transaction);
          }
          await recordAudit(
            {
              action: "github_installation_repositories_changed",
              requestId,
              metadata: {
                installationId: String(payload.installationId),
                change: payload.action,
                repositoryCount: payload.repositoryIds.length,
              },
            },
            transaction,
          );
        }
      });
    },

    async cleanup(now) {
      await GitHubInstallationLink.destroy({
        where: { expiresAt: { [Op.lt]: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      });
      await WebhookDelivery.destroy({
        where: {
          status: { [Op.in]: ["processed", "failed", "ignored"] },
          receivedAt: { [Op.lt]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        },
      });
    },
  };
}

export { safeInstallation, safeRepository };

import { timingSafeEqual } from "node:crypto";
import { Op } from "sequelize";

function safeEqualHash(first, second) {
  const firstBuffer = Buffer.from(first || "", "hex");
  const secondBuffer = Buffer.from(second || "", "hex");
  return (
    firstBuffer.length === 32 &&
    secondBuffer.length === 32 &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}

export function createAuthRepository({ sequelize, models }) {
  const { AuthAuditEvent, OAuthTransaction, Session, User } = models;

  async function recordEvent(
    { actorUserId = null, action, requestId, metadata = {} },
    transaction,
  ) {
    await AuthAuditEvent.create(
      { actorUserId, action, requestId, metadata },
      { transaction },
    );
  }

  return {
    async createOAuthTransaction(values) {
      return OAuthTransaction.create(values);
    },

    async recordAuthEvent(event) {
      return recordEvent(event);
    },

    async findPendingOAuthTransaction(stateHash, now) {
      return OAuthTransaction.findOne({
        where: {
          stateHash,
          consumedAt: null,
          expiresAt: { [Op.gt]: now },
        },
        attributes: ["id"],
      });
    },

    async consumeOAuthState(stateHash, now, requestId) {
      return sequelize.transaction(async (transaction) => {
        const oauthTransaction = await OAuthTransaction.findOne({
          where: {
            stateHash,
            consumedAt: null,
            expiresAt: { [Op.gt]: now },
          },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (!oauthTransaction) return null;

        oauthTransaction.consumedAt = now;
        await oauthTransaction.save({ transaction });
        await recordEvent(
          {
            action: "oauth_callback_accepted",
            requestId,
          },
          transaction,
        );
        return oauthTransaction;
      });
    },

    async createHandoff({
      transactionId,
      profile,
      handoffHash,
      expiresAt,
      requestId,
    }) {
      return sequelize.transaction(async (transaction) => {
        const oauthTransaction = await OAuthTransaction.findByPk(
          transactionId,
          { lock: transaction.LOCK.UPDATE, transaction },
        );
        if (!oauthTransaction || !oauthTransaction.consumedAt || oauthTransaction.handoffHash) {
          return null;
        }

        const [user] = await User.findOrCreate({
          where: { githubUserId: String(profile.id) },
          defaults: {
            githubUserId: String(profile.id),
            username: profile.login,
            email: profile.email || null,
            avatarUrl: profile.avatarUrl || null,
          },
          transaction,
        });
        user.username = profile.login;
        user.email = profile.email || null;
        user.avatarUrl = profile.avatarUrl || null;
        await user.save({ transaction });

        oauthTransaction.handoffHash = handoffHash;
        oauthTransaction.handoffExpiresAt = expiresAt;
        oauthTransaction.userId = user.id;
        await oauthTransaction.save({ transaction });
        await recordEvent(
          {
            actorUserId: user.id,
            action: "oauth_identity_verified",
            requestId,
          },
          transaction,
        );
        return user;
      });
    },

    async exchangeHandoff({
      handoffHash,
      completionSecretHash,
      tokenHash,
      expiresAt,
      deviceLabel,
      requestId,
      now,
    }) {
      return sequelize.transaction(async (transaction) => {
        const oauthTransaction = await OAuthTransaction.findOne({
          where: {
            handoffHash,
            handoffConsumedAt: null,
            handoffExpiresAt: { [Op.gt]: now },
          },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (
          !oauthTransaction ||
          !safeEqualHash(
            oauthTransaction.completionSecretHash,
            completionSecretHash,
          ) ||
          !oauthTransaction.userId
        ) {
          return null;
        }

        const user = await User.findOne({
          where: { id: oauthTransaction.userId },
          transaction,
        });
        if (!user) return null;

        oauthTransaction.handoffConsumedAt = now;
        await oauthTransaction.save({
          fields: ["handoffConsumedAt"],
          transaction,
        });
        const session = await Session.create(
          {
            userId: user.id,
            tokenHash,
            expiresAt,
            deviceLabel,
          },
          { transaction },
        );
        await recordEvent(
          { actorUserId: user.id, action: "session_created", requestId },
          transaction,
        );
        return { session, user };
      });
    },

    async authenticateSession(tokenHash, now) {
      const session = await Session.findOne({
        where: {
          tokenHash,
          revokedAt: null,
          expiresAt: { [Op.gt]: now },
        },
      });
      if (!session) return null;
      const user = await User.findByPk(session.userId);
      if (!user) return null;

      session.lastUsedAt = now;
      await session.save({ fields: ["lastUsedAt"] });
      return { session, user };
    },

    async rotateSession({
      currentSessionId,
      tokenHash,
      expiresAt,
      requestId,
      now,
    }) {
      return sequelize.transaction(async (transaction) => {
        const current = await Session.findOne({
          where: {
            id: currentSessionId,
            revokedAt: null,
            expiresAt: { [Op.gt]: now },
          },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (!current) return null;
        const user = await User.findByPk(current.userId, { transaction });
        if (!user) return null;

        current.revokedAt = now;
        await current.save({ fields: ["revokedAt"], transaction });
        const next = await Session.create(
          {
            userId: current.userId,
            tokenHash,
            deviceLabel: current.deviceLabel,
            expiresAt,
          },
          { transaction },
        );
        await recordEvent(
          {
            actorUserId: current.userId,
            action: "session_rotated",
            requestId,
          },
          transaction,
        );
        return { session: next, user };
      });
    },

    async revokeSession({ sessionId, userId, requestId, now }) {
      return sequelize.transaction(async (transaction) => {
        const session = await Session.findOne({
          where: { id: sessionId, userId, revokedAt: null },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (!session) return false;

        session.revokedAt = now;
        await session.save({ fields: ["revokedAt"], transaction });
        await recordEvent(
          { actorUserId: userId, action: "session_revoked", requestId },
          transaction,
        );
        return true;
      });
    },

    async cleanupExpired(oauthRetentionDate, sessionRetentionDate) {
      const [oauthTransactions, sessions] = await Promise.all([
        OAuthTransaction.destroy({
          where: { createdAt: { [Op.lt]: oauthRetentionDate } },
        }),
        Session.destroy({
          where: {
            [Op.or]: [
              { expiresAt: { [Op.lt]: sessionRetentionDate } },
              { revokedAt: { [Op.lt]: sessionRetentionDate } },
            ],
          },
        }),
      ]);
      return { oauthTransactions, sessions };
    },
  };
}

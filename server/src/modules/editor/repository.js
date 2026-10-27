function isUniqueViolation(error) {
  return (
    error?.name === "SequelizeUniqueConstraintError" ||
    error?.original?.code === "23505"
  );
}

export function createEditorRepository({ sequelize, models }) {
  const { AuthAuditEvent, CodeChange } = models;

  return {
    async beginOperation(values) {
      try {
        const operation = await CodeChange.create(values);
        return { operation, created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const operation = await CodeChange.findOne({
          where: {
            actorUserId: values.actorUserId,
            idempotencyKey: values.idempotencyKey,
          },
        });
        if (!operation) throw error;
        return { operation, created: false };
      }
    },

    findFixBranch({ actorUserId, repositoryId, branchName }) {
      return CodeChange.findOne({
        where: {
          actorUserId,
          repositoryId,
          operationType: "branch",
          branchName,
          status: "succeeded",
        },
        order: [["createdAt", "DESC"]],
      });
    },

    async finishOperation({
      id,
      status,
      action,
      requestId,
      metadata,
      values = {},
    }) {
      return sequelize.transaction(async (transaction) => {
        const operation = await CodeChange.findByPk(id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!operation || operation.status !== "pending") return operation;
        Object.assign(operation, {
          ...values,
          status,
          completedAt: new Date(),
          updatedAt: new Date(),
        });
        await operation.save({ transaction });
        await AuthAuditEvent.create(
          {
            actorUserId: operation.actorUserId,
            codeChangeId: operation.id,
            action,
            requestId,
            metadata: { operationType: operation.operationType, status, ...metadata },
          },
          { transaction },
        );
        return operation;
      });
    },
  };
}

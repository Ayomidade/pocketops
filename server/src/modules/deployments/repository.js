import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { AppError } from "../../errors/app-error.js";
const unique = (error) => error?.name === "SequelizeUniqueConstraintError";

export function createDeploymentRepository({ sequelize, models }) {
  const { ProviderConnection: Connection, Project, Deployment, OperationRequest: Operation, AuthAuditEvent: Audit } = models;
  const audit = (values, transaction) => Audit.create(values, { transaction });
  const operationAudit = (op, action, transaction) => audit({ actorUserId: op.actorId, operationRequestId: op.id, action, requestId: op.requestId,
    metadata: { projectId: op.projectId, status: op.status, providerReference: op.providerReference || null, errorCode: op.errorCode || null } }, transaction);
  return {
    findConnection: (userId, id) => Connection.findOne({ where: { id, userId } }),
    listConnections: (userId, limit, cursor) => Connection.findAll({ where: { userId, ...(cursor ? { id: { [Op.gt]: cursor } } : {}) }, order: [["id", "ASC"]], limit: limit + 1 }),
    createConnection(values, requestId) { return sequelize.transaction(async (transaction) => {
      const connection = await Connection.create(values, { transaction });
      await audit({ actorUserId: values.userId, action: "provider.connected", requestId, metadata: { connectionId: values.id, provider: "render" } }, transaction);
      return connection;
    }); },
    async rotateConnection(id, oldVersion, values) { await Connection.update(values, { where: { id, keyVersion: oldVersion, status: "active" } }); },
    revokeConnection(userId, id, requestId) { return sequelize.transaction(async (transaction) => {
      const connection = await Connection.findOne({ where: { id, userId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!connection) throw new AppError(404, "CONNECTION_NOT_FOUND", "Connection not found.");
      await connection.update({ status: "revoked", encryptedCredentials: null, revokedAt: new Date() }, { transaction });
      await Project.update({ status: "disconnected" }, { where: { connectionId: id, userId }, transaction });
      await audit({ actorUserId: userId, action: "provider.disconnected", requestId, metadata: { connectionId: id } }, transaction);
    }); },
    findProject: (userId, id) => Project.findOne({ where: { id, userId } }),
    listProjects: (userId, limit, cursor) => Project.findAll({ where: { userId, ...(cursor ? { id: { [Op.gt]: cursor } } : {}) }, order: [["id", "ASC"]], limit: limit + 1 }),
    async createProject(values, requestId) {
      try { return await sequelize.transaction(async (transaction) => {
        const connection = await Connection.findOne({ where: { id: values.connectionId, userId: values.userId, status: "active" }, transaction, lock: transaction.LOCK.UPDATE });
        if (!connection) throw new AppError(409, "CONNECTION_DISCONNECTED", "Reconnect Render before mapping a service.");
        const project = await Project.create(values, { transaction });
        await audit({ actorUserId: values.userId, action: "project.created", requestId, metadata: { projectId: values.id, connectionId: values.connectionId, serviceId: values.providerServiceId } }, transaction);
        return project;
      }); } catch (error) { if (unique(error)) throw new AppError(409, "SERVICE_ALREADY_MAPPED", "This service already has a project."); throw error; }
    },
    updateProject(userId, id, name, requestId) { return sequelize.transaction(async (transaction) => {
      const project = await Project.findOne({ where: { id, userId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
      await project.update({ name }, { transaction });
      await audit({ actorUserId: userId, action: "project.updated", requestId, metadata: { projectId: id } }, transaction);
      return project;
    }); },
    findDeployment: (id) => Deployment.findByPk(id),
    async saveDeployment(projectId, values) {
      const [record] = await Deployment.findOrCreate({ where: { projectId, providerDeploymentId: values.providerDeploymentId }, defaults: { id: randomUUID(), projectId, ...values } });
      return record.update(values);
    },
    activeOperation: (projectId) => Operation.findOne({ where: { projectId, status: ["queued", "validating", "requesting", "accepted", "unknown"] } }),
    findOperation: (userId, id) => Operation.findOne({ where: { id, actorId: userId } }),
    findByKey: (userId, idempotencyKey) => Operation.findOne({ where: { actorId: userId, idempotencyKey } }),
    async enqueue(values) {
      try { return await sequelize.transaction(async (transaction) => {
        const op = await Operation.create(values, { transaction });
        await operationAudit(op, "deployment.queued", transaction); return { op, created: true };
      }); } catch (error) {
        if (!unique(error)) throw error;
        const op = await Operation.findOne({ where: { actorId: values.actorId, idempotencyKey: values.idempotencyKey } });
        if (op) return { op, created: false };
        throw new AppError(409, "DEPLOYMENT_ALREADY_PENDING", "A deployment is pending or requires manual reconciliation for this project.");
      }
    },
    claim(now) { return sequelize.transaction(async (transaction) => {
      // A process death after dispatch is ambiguous. It must never enqueue another POST.
      const stale = await Operation.findAll({ where: { status: "requesting", claimExpiresAt: { [Op.lte]: now } }, transaction, lock: transaction.LOCK.UPDATE, skipLocked: true, limit: 20 });
      for (const op of stale) { await op.update({ status: "unknown", errorCode: "PROVIDER_OUTCOME_UNKNOWN", claimToken: null, claimExpiresAt: null }, { transaction }); await operationAudit(op, "deployment.unknown", transaction); }
      const op = await Operation.findOne({ where: { status: ["queued", "validating", "accepted"], nextAttemptAt: { [Op.lte]: now }, [Op.or]: [{ claimExpiresAt: null }, { claimExpiresAt: { [Op.lte]: now } }] }, transaction, lock: transaction.LOCK.UPDATE, skipLocked: true, order: [["nextAttemptAt", "ASC"]] });
      if (!op) return null;
      await op.update({ status: op.status === "accepted" ? "accepted" : "validating", claimToken: randomUUID(), claimExpiresAt: new Date(now.getTime() + 60000), attempts: op.attempts + 1 }, { transaction });
      return op;
    }); },
    async dispatch(op, connectionId, now) { return sequelize.transaction(async (transaction) => {
      const conn = await Connection.findOne({ where: { id: connectionId, userId: op.actorId, status: "active" }, transaction, lock: transaction.LOCK.UPDATE });
      if (!conn) throw new AppError(409, "CONNECTION_DISCONNECTED", "Render is disconnected.");
      const [count] = await Operation.update({ status: "requesting", claimExpiresAt: new Date(now.getTime() + 60000) }, { where: { id: op.id, claimToken: op.claimToken, status: "validating", claimExpiresAt: { [Op.gt]: now } }, transaction });
      if (!count) return false;
      await operationAudit({ ...op.get({ plain: true }), status: "requesting" }, "deployment.requested", transaction); return true;
    }); },
    finish(op, values, deployment, action) { return sequelize.transaction(async (transaction) => {
      const current = await Operation.findOne({ where: { id: op.id, claimToken: op.claimToken }, transaction, lock: transaction.LOCK.UPDATE });
      if (!current) return null;
      if (deployment) {
        const existing = await Deployment.findOne({ where: { projectId: op.projectId, providerDeploymentId: deployment.providerDeploymentId }, transaction });
        const row = existing ? await existing.update(deployment, { transaction }) : await Deployment.create({ id: randomUUID(), projectId: op.projectId, ...deployment }, { transaction });
        values = { ...values, providerReference: deployment.providerDeploymentId, deploymentId: row.id };
      }
      await current.update({ ...values, claimToken: null, claimExpiresAt: null }, { transaction });
      await operationAudit(current, action, transaction); return current;
    }); },
  };
}

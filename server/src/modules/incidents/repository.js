import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { AppError } from "../../errors/app-error.js";
import { assertTransition, healthSummary } from "./policy.js";
const fail = (code, message) => {
  throw new AppError(409, code, message);
};
export function createIncidentRepository({ sequelize, models: m }) {
  const {
    Incident: I,
    IncidentEvent: E,
    ProjectMonitor: M,
    HealthCheck: H,
    IncidentObservation: O,
    PushDevice: D,
    NotificationPreference: P,
    NotificationDelivery: N,
  } = m;
  async function event(
    incident,
    actorId,
    eventType,
    metadata,
    requestId,
    transaction,
  ) {
    const e = await E.create(
      {
        id: randomUUID(),
        incidentId: incident.id,
        actorId,
        eventType,
        metadata,
        requestId,
        createdAt: new Date(),
      },
      { transaction },
    );
    await m.AuthAuditEvent.create(
      {
        actorUserId: actorId,
        action: `incident.${eventType}`,
        requestId,
        metadata: {
          incidentId: incident.id,
          projectId: incident.projectId,
          ...metadata,
        },
      },
      { transaction },
    );
    const pref = await P.findByPk(incident.userId, { transaction });
    if (pref?.enabled) {
      const devices = await D.findAll({
        where: { userId: incident.userId, enabled: true },
        limit: 10,
        transaction,
      });
      if (devices.length)
        await N.bulkCreate(
          devices.map((d) => ({
            id: randomUUID(),
            eventId: e.id,
            deviceId: d.id,
            status: "pending",
            attempts: 0,
            nextAttemptAt: new Date(),
          })),
          { transaction },
        );
    }
    return e;
  }
  async function lockProject(id, userId, transaction) {
    const p = await m.Project.findOne({
      where: { id, userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!p) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
    return p;
  }
  return {
    find: (userId, id) => I.findOne({ where: { id, userId } }),
    list: (userId, { limit, cursor, status, severity }) =>
      I.findAll({
        where: {
          userId,
          ...(cursor ? { id: { [Op.gt]: cursor } } : {}),
          ...(status ? { status } : {}),
          ...(severity ? { severity } : {}),
        },
        order: [["id", "ASC"]],
        limit: limit + 1,
      }),
    timeline: (incidentId, { limit, cursor }) =>
      E.findAll({
        where: {
          incidentId,
          ...(cursor
            ? {
                [Op.or]: [
                  { createdAt: { [Op.gt]: new Date(cursor.time) } },
                  {
                    createdAt: new Date(cursor.time),
                    id: { [Op.gt]: cursor.id },
                  },
                ],
              }
            : {}),
        },
        order: [
          ["createdAt", "ASC"],
          ["id", "ASC"],
        ],
        limit: limit + 1,
      }),
    create(input) {
      return sequelize.transaction(async (transaction) => {
        await m.User.findByPk(input.userId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        await lockProject(input.projectId, input.userId, transaction);
        const prior = await I.findOne({
          where: { userId: input.userId, idempotencyKey: input.idempotencyKey },
          transaction,
        });
        if (prior) {
          if (prior.requestHash !== input.requestHash)
            fail(
              "IDEMPOTENCY_CONFLICT",
              "Key already used for another incident.",
            );
          return prior;
        }
        const incident = await I.create(
          {
            id: randomUUID(),
            ...input,
            status: "open",
            version: 1,
            automatic: false,
          },
          { transaction },
        );
        await event(
          incident,
          input.userId,
          "created",
          { status: "open", severity: input.severity },
          input.requestId,
          transaction,
        );
        return incident;
      });
    },
    change(userId, id, input) {
      return sequelize.transaction(async (transaction) => {
        const i = await I.findOne({
          where: { id, userId },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!i)
          throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found.");
        if (i.version !== input.version)
          fail(
            "INCIDENT_VERSION_CONFLICT",
            "Incident changed. Refresh before retrying.",
          );
        if (input.status && input.status !== i.status)
          assertTransition(i.status, input.status);
        if (input.status === "resolved") {
          const rows = await H.findAll({
            where: { projectId: i.projectId },
            order: [["checkedAt", "DESC"]],
            limit: 3,
            transaction,
          });
          if (
            healthSummary(rows).status !== "verified" ||
            rows.some(
              (h) =>
                h.origin !== input.expectedOrigin ||
                h.deploymentReference !== input.expectedDeployment,
            ) ||
            new Date(rows[2].checkedAt) < new Date(i.createdAt)
          )
            fail(
              "HEALTH_NOT_VERIFIED",
              "Three recent healthy observations are required before resolving.",
            );
        }
        const values = {
          version: i.version + 1,
          ...(input.status
            ? {
                status: input.status,
                resolvedAt: input.status === "resolved" ? new Date() : null,
              }
            : {}),
          ...(input.severity ? { severity: input.severity } : {}),
        };
        await i.update(values, { transaction });
        await event(
          i,
          userId,
          "updated",
          { status: i.status, severity: i.severity, version: i.version },
          input.requestId,
          transaction,
        );
        return i;
      });
    },
    monitor: (id) => M.findByPk(id),
    configure(userId, id, { enabled, healthPath, requestId }) {
      return sequelize.transaction(async (transaction) => {
        await m.User.findByPk(userId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        await lockProject(id, userId, transaction);
        if (
          enabled &&
          !(await M.findByPk(id, { transaction })) &&
          (await M.count({ where: { userId }, transaction })) >= 20
        )
          fail(
            "MONITOR_LIMIT",
            "At most 20 projects can be monitored per account.",
          );
        const [row] = await M.findOrCreate({
          where: { id },
          defaults: { userId, enabled, healthPath, nextAttemptAt: new Date() },
          transaction,
        });
        await row.update(
          {
            enabled,
            healthPath,
            nextAttemptAt: new Date(),
            claimToken: null,
            claimExpiresAt: null,
          },
          { transaction },
        );
        // Configuration changes invalidate earlier observations by deleting only derived health history.
        await H.destroy({ where: { projectId: id }, transaction });
        await m.AuthAuditEvent.create(
          {
            actorUserId: userId,
            action: "incident.monitor_configured",
            requestId,
            metadata: { projectId: id, enabled, healthPath },
          },
          { transaction },
        );
        return row;
      });
    },
    health: (id, limit = 3) =>
      H.findAll({
        where: { projectId: id },
        order: [["checkedAt", "DESC"]],
        limit,
      }),
    claimMonitor(now) {
      return sequelize.transaction(async (transaction) => {
        const row = await M.findOne({
          where: {
            enabled: true,
            nextAttemptAt: { [Op.lte]: now },
            [Op.or]: [
              { claimExpiresAt: null },
              { claimExpiresAt: { [Op.lte]: now } },
            ],
          },
          order: [["nextAttemptAt", "ASC"]],
          transaction,
          lock: transaction.LOCK.UPDATE,
          skipLocked: true,
        });
        if (!row) return null;
        await row.update(
          {
            claimToken: randomUUID(),
            claimExpiresAt: new Date(+now + 120000),
            nextAttemptAt: new Date(+now + 60000),
          },
          { transaction },
        );
        return row;
      });
    },
    recordObservation(monitor, observation) {
      return sequelize.transaction(async (transaction) => {
        const locked = await M.findOne({
          where: {
            id: monitor.id,
            claimToken: monitor.claimToken,
            enabled: true,
          },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!locked) return;
        const check = await H.create(
          {
            id: randomUUID(),
            projectId: monitor.id,
            path: monitor.healthPath,
            ...observation.health,
            checkedAt: observation.at,
          },
          { transaction },
        );
        const rows = await H.findAll({
          where: { projectId: monitor.id },
          order: [["checkedAt", "DESC"]],
          limit: 3,
          transaction,
        });
        const summary = healthSummary(rows, observation.at);
        const deployment = observation.deployment;
        const failed =
          deployment?.status === "failed" &&
          deployment.startedAt &&
          new Date(deployment.startedAt) >= new Date(monitor.createdAt);
        const key = failed
          ? `deploy:${deployment.providerDeploymentId}:failed`
          : summary.status === "unhealthy"
            ? `health:${new Date(rows[2].checkedAt).toISOString()}`
            : null;
        let incident = await I.findOne({
          where: {
            projectId: monitor.id,
            automatic: true,
            status: { [Op.ne]: "resolved" },
          },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (key) {
          const [seen, created] = await O.findOrCreate({
            where: { projectId: monitor.id, eventKey: key },
            defaults: { id: randomUUID(), observedAt: observation.at },
            transaction,
          });
          if (created) {
            if (!incident) {
              incident = await I.create(
                {
                  id: randomUUID(),
                  userId: monitor.userId,
                  projectId: monitor.id,
                  title: failed
                    ? "Deployment failed"
                    : "Application health checks failed",
                  severity: "high",
                  status: "open",
                  version: 1,
                  automatic: true,
                },
                { transaction },
              );
              await event(
                incident,
                null,
                "detected",
                {
                  source: failed ? "render_poll" : "health_check",
                  deploymentReference: deployment?.providerDeploymentId || null,
                  healthCheckId: check.id,
                  correlation: "suggested",
                },
                `monitor-${seen.id}`,
                transaction,
              );
            } else if (failed)
              await event(
                incident,
                null,
                "deployment_failed",
                {
                  deploymentReference: deployment.providerDeploymentId,
                  correlation: "suggested",
                },
                `monitor-${seen.id}`,
                transaction,
              );
          }
        }
        const active =
          summary.status === "verified"
            ? await I.findAll({
                where: {
                  projectId: monitor.id,
                  status: { [Op.ne]: "resolved" },
                },
                limit: 50,
                transaction,
              })
            : [];
        for (const incident of active) {
          const key = `verified:${incident.id}:${observation.health.deploymentReference || "none"}`;
          const [, created] = await O.findOrCreate({
            where: { projectId: monitor.id, eventKey: key },
            defaults: { id: randomUUID(), observedAt: observation.at },
            transaction,
          });
          if (created)
            await event(
              incident,
              null,
              "health_verified",
              { healthCheckId: check.id, correlation: "observed" },
              `monitor-${check.id}`,
              transaction,
            );
        }
        await locked.update(
          {
            claimToken: null,
            claimExpiresAt: null,
            ...(observation.disconnected ? { enabled: false } : {}),
          },
          { transaction },
        );
      });
    },
    preferences: async (userId) => {
      const [p] = await P.findOrCreate({
        where: { id: userId },
        defaults: { enabled: false },
      });
      return { enabled: p.enabled };
    },
    async setPreferences(userId, enabled) {
      await P.upsert({ id: userId, enabled });
      return { enabled };
    },
    devices: (userId) =>
      D.findAll({ where: { userId, enabled: true }, limit: 10 }),
    register(input) {
      return sequelize.transaction(async (transaction) => {
        await m.User.findByPk(input.userId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        const prior = await D.findOne({
          where: { tokenHash: input.tokenHash },
          transaction,
        });
        if (prior && prior.userId !== input.userId)
          fail(
            "DEVICE_ALREADY_REGISTERED",
            "Remove the existing device registration before changing accounts.",
          );
        if (prior) {
          await prior.update({ ...input, id: prior.id }, { transaction });
          return prior;
        }
        if (
          (await D.count({
            where: { userId: input.userId, enabled: true },
            transaction,
          })) >= 10
        )
          fail(
            "DEVICE_LIMIT",
            "Remove an old device before registering another.",
          );
        return D.create(input, { transaction });
      });
    },
    async revoke(userId, id) {
      const [count] = await D.update(
        { enabled: false, encryptedCredentials: null },
        { where: { id, userId } },
      );
      if (!count)
        throw new AppError(404, "DEVICE_NOT_FOUND", "Device not found.");
      return { revoked: true };
    },
    findDeviceByHash: (tokenHash) => D.findOne({ where: { tokenHash } }),
    claimNotification(now) {
      return sequelize.transaction(async (transaction) => {
        await N.update(
          {
            status: "unknown",
            claimToken: null,
            claimExpiresAt: null,
            errorCode: "SEND_OUTCOME_UNKNOWN",
          },
          {
            where: { status: "sending", claimExpiresAt: { [Op.lte]: now } },
            transaction,
          },
        );
        const row = await N.findOne({
          where: {
            status: ["pending", "receipt"],
            nextAttemptAt: { [Op.lte]: now },
            [Op.or]: [
              { claimExpiresAt: null },
              { claimExpiresAt: { [Op.lte]: now } },
            ],
          },
          order: [["nextAttemptAt", "ASC"]],
          transaction,
          lock: transaction.LOCK.UPDATE,
          skipLocked: true,
        });
        if (!row) return null;
        await row.update(
          {
            claimToken: randomUUID(),
            claimExpiresAt: new Date(+now + 60000),
            attempts: row.attempts + 1,
          },
          { transaction },
        );
        return row;
      });
    },
    async notificationContext(row) {
      const device = await D.findByPk(row.deviceId);
      const e = await E.findByPk(row.eventId);
      const incident = e && (await I.findByPk(e.incidentId));
      const pref = device && (await P.findByPk(device.userId));
      const session =
        device &&
        (await m.Session.findOne({
          where: {
            id: device.sessionId,
            userId: device.userId,
            revokedAt: null,
            expiresAt: { [Op.gt]: new Date() },
          },
        }));
      return {
        device,
        incident,
        allowed: !!(
          device?.enabled &&
          pref?.enabled &&
          session &&
          incident?.userId === device.userId
        ),
      };
    },
    markSending: (row) =>
      N.update(
        { status: "sending" },
        {
          where: { id: row.id, claimToken: row.claimToken, status: "pending" },
        },
      ),
    finishNotification: (row, values) =>
      N.update(
        { ...values, claimToken: null, claimExpiresAt: null },
        { where: { id: row.id, claimToken: row.claimToken } },
      ),
  };
}

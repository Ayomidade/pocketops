import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { createIncidentRepository } from "../../src/modules/incidents/repository.js";
import { createIncidentService } from "../../src/modules/incidents/service.js";
import { credentialVault } from "../../src/modules/deployments/crypto.js";
export async function verifyPersistentIncidents({
  sequelize,
  models,
  user,
  githubRepository,
}) {
  const r = createIncidentRepository({ sequelize, models });
  const vault = credentialVault({
    keys: { test: Buffer.alloc(32, 6) },
    activeVersion: "test",
    namespace: "push",
  });
  const connection = await models.ProviderConnection.create({
    id: randomUUID(),
    userId: user.id,
    provider: "render",
    displayName: "Incidents fixture",
    status: "active",
    keyVersion: "test",
  });
  const project = await models.Project.create({
    id: randomUUID(),
    userId: user.id,
    repositoryId: githubRepository.id,
    connectionId: connection.id,
    providerServiceId: "srv-incidents",
    name: "Incident fixture",
    status: "active",
  });
  let now = new Date();
  let currentStatus = "live";
  let revoked = false;
  let sends = 0;
  const deployments = {
    incidentContext: async (input) => {
      if (revoked || input.userId !== user.id || input.id !== project.id)
        throw Object.assign(new Error("Denied"), { status: 404 });
      return input.inspect
        ? {
            project,
            origin: "https://fixture.onrender.com",
            deployments: [
              {
                providerDeploymentId: "dep-fixture",
                status: currentStatus,
                startedAt: new Date(+now - 1000).toISOString(),
              },
            ],
          }
        : project;
    },
  };
  const service = createIncidentService({
    repository: r,
    deployments,
    vault,
    probe: async () => ({
      status: "healthy",
      code: "HTTP_200",
      durationMs: 10,
    }),
    push: {
      send: async () => {
        sends++;
        return { status: "ok", id: "ticket-fixture" };
      },
      receipt: async () => ({ status: "ok" }),
    },
    clock: () => now,
  });
  const base = {
    userId: user.id,
    projectId: project.id,
    requestId: "incident-db-test",
    idempotencyKey: "incident-create-fixture",
    title: "Synthetic incident",
    severity: "high",
  };
  const session = await models.Session.create({
    userId: user.id,
    tokenHash: "e".repeat(64),
    expiresAt: new Date(Date.now() + 3600000),
  });
  await service.setPreferences({ userId: user.id, enabled: true });
  const device = await service.register({
    userId: user.id,
    sessionId: session.id,
    platform: "android",
    token: "ExpoPushToken[synthetic_fixture]",
  });
  expect(JSON.stringify(device)).not.toMatch(/token|encrypted/);
  const [one, two] = await Promise.all([
    service.create(base),
    service.create(base),
  ]);
  expect(one.id).toBe(two.id);
  expect(
    await models.IncidentEvent.count({ where: { incidentId: one.id } }),
  ).toBe(1);
  expect(await models.NotificationDelivery.count()).toBe(1);
  await expect(
    service.create({ ...base, title: "different" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    service.detail({ userId: randomUUID(), id: one.id }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.update({
      userId: user.id,
      id: one.id,
      version: 1,
      status: "monitoring",
    }),
  ).rejects.toMatchObject({ code: "INVALID_INCIDENT_TRANSITION" });
  let updated = await service.update({
    userId: user.id,
    id: one.id,
    version: 1,
    status: "investigating",
    requestId: "test",
  });
  await expect(
    service.update({
      userId: user.id,
      id: one.id,
      version: 1,
      status: "mitigating",
    }),
  ).rejects.toMatchObject({ code: "INCIDENT_VERSION_CONFLICT" });
  updated = await service.update({
    userId: user.id,
    id: one.id,
    version: updated.version,
    status: "monitoring",
    requestId: "test",
  });
  await expect(
    service.resolve({ userId: user.id, id: one.id, version: updated.version }),
  ).rejects.toMatchObject({ code: "HEALTH_NOT_VERIFIED" });
  await service.configure({
    userId: user.id,
    id: project.id,
    enabled: true,
    healthPath: "/health",
    requestId: "test",
  });
  const monitor = await models.ProjectMonitor.findByPk(project.id);
  // Seed spaced recent observations after incident creation, without sleeping.
  const start = new Date(Date.now() - 125000);
  await models.Incident.update(
    { createdAt: new Date(+start - 1000) },
    { where: { id: one.id }, silent: true },
  );
  for (const age of [120000, 60000, 0])
    await models.HealthCheck.create({
      id: randomUUID(),
      projectId: project.id,
      status: "healthy",
      code: "HTTP_200",
      durationMs: 10,
      origin: "https://fixture.onrender.com",
      path: "/health",
      deploymentReference: "dep-fixture",
      checkedAt: new Date(Date.now() - age),
    });
  now = new Date();
  updated = await service.resolve({
    userId: user.id,
    id: one.id,
    version: updated.version,
    requestId: "test",
  });
  expect(updated.status).toBe("resolved");
  const history = await service.timeline({
    userId: user.id,
    id: one.id,
    limit: 2,
  });
  expect(history.items).toHaveLength(2);
  expect(history.nextCursor).toBeTruthy();
  expect(await service.processNotification()).toBe(true);
  expect(sends).toBe(1);
  const delivery = await models.NotificationDelivery.findOne({
    where: { status: "receipt" },
  });
  expect(delivery.ticketId).toBe("ticket-fixture");
  // Worker death after dispatch must never resend automatically.
  await delivery.update({ status: "sending", claimExpiresAt: new Date(0) });
  await r.claimNotification(new Date());
  await delivery.reload();
  expect(delivery.status).toBe("unknown");
  // Verified polling detects one automatic incident for repeated failure observations.
  currentStatus = "failed";
  now = new Date(Date.now() + 2000);
  await monitor.update({ nextAttemptAt: new Date(0) });
  await service.processMonitor();
  expect(
    await models.Incident.count({
      where: { automatic: true, projectId: project.id },
    }),
  ).toBe(1);
  now = new Date(+now + 61000);
  await monitor.update({ nextAttemptAt: new Date(0) });
  await service.processMonitor();
  expect(
    await models.Incident.count({
      where: { automatic: true, projectId: project.id },
    }),
  ).toBe(1);
  revoked = true;
  await expect(
    service.detail({ userId: user.id, id: one.id }),
  ).rejects.toMatchObject({ status: 404 });
  await session.update({ revokedAt: new Date() });
  expect((await r.notificationContext(delivery)).allowed).toBe(false);
  expect(
    await models.AuthAuditEvent.count({
      where: { action: "incident.updated" },
    }),
  ).toBeGreaterThanOrEqual(3);
}

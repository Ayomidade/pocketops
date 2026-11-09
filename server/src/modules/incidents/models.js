import { DataTypes as T } from "sequelize";
export function defineIncidentModels(db) {
  const id = { type: T.UUID, primaryKey: true };
  const define = (name, tableName, fields, timestamps = true) =>
    db.define(
      name,
      { id, ...fields },
      { tableName, underscored: true, timestamps },
    );
  const Incident = define("Incident", "incidents", {
    userId: T.UUID,
    projectId: T.UUID,
    title: T.STRING(160),
    severity: T.STRING(12),
    status: T.STRING(20),
    version: T.INTEGER,
    automatic: T.BOOLEAN,
    idempotencyKey: T.STRING(100),
    requestHash: T.STRING(64),
    resolvedAt: T.DATE,
  });
  const IncidentEvent = define(
    "IncidentEvent",
    "incident_events",
    {
      incidentId: T.UUID,
      actorId: T.UUID,
      eventType: T.STRING(40),
      metadata: T.JSONB,
      requestId: T.STRING(100),
      dedupeKey: T.STRING(180),
      createdAt: { type: T.DATE, field: "created_at" },
    },
    false,
  );
  const ProjectMonitor = define("ProjectMonitor", "project_monitors", {
    userId: T.UUID,
    enabled: T.BOOLEAN,
    healthPath: T.STRING(256),
    nextAttemptAt: T.DATE,
    claimToken: T.UUID,
    claimExpiresAt: T.DATE,
  });
  const HealthCheck = define(
    "HealthCheck",
    "health_checks",
    {
      projectId: T.UUID,
      status: T.STRING(16),
      code: T.STRING(40),
      durationMs: T.INTEGER,
      origin: T.STRING(300),
      path: T.STRING(256),
      deploymentReference: T.STRING(100),
      checkedAt: { type: T.DATE, field: "checked_at" },
    },
    false,
  );
  const IncidentObservation = define(
    "IncidentObservation",
    "incident_observations",
    {
      projectId: T.UUID,
      eventKey: T.STRING(180),
      observedAt: { type: T.DATE, field: "observed_at" },
    },
    false,
  );
  const NotificationPreference = define(
    "NotificationPreference",
    "notification_preferences",
    { enabled: T.BOOLEAN },
  );
  const PushDevice = define("PushDevice", "push_devices", {
    userId: T.UUID,
    sessionId: T.UUID,
    tokenHash: T.STRING(64),
    encryptedCredentials: T.TEXT,
    keyVersion: T.STRING(32),
    platform: T.STRING(10),
    enabled: T.BOOLEAN,
  });
  const NotificationDelivery = define(
    "NotificationDelivery",
    "notification_deliveries",
    {
      eventId: T.UUID,
      deviceId: T.UUID,
      status: T.STRING(20),
      ticketId: T.STRING(100),
      attempts: T.INTEGER,
      errorCode: T.STRING(40),
      nextAttemptAt: T.DATE,
      claimToken: T.UUID,
      claimExpiresAt: T.DATE,
    },
  );
  return {
    Incident,
    IncidentEvent,
    ProjectMonitor,
    HealthCheck,
    IncidentObservation,
    NotificationPreference,
    PushDevice,
    NotificationDelivery,
  };
}

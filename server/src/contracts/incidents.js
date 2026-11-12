export function registerIncidentContract({ schemas, endpoint, parameter }) {
  const str = { type: "string" },
    nullable = { type: "string", nullable: true },
    bool = { type: "boolean" },
    uuid = { type: "string", format: "uuid" };
  const obj = (properties, required = Object.keys(properties)) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
  const severity = {
    type: "string",
    enum: ["low", "medium", "high", "critical"],
  };
  const status = {
    type: "string",
    enum: ["open", "investigating", "mitigating", "monitoring", "resolved"],
  };
  const incident = obj({
    id: uuid,
    projectId: uuid,
    title: { type: "string", maxLength: 160 },
    severity,
    status,
    version: { type: "integer", minimum: 1 },
    automatic: bool,
    createdAt: str,
    updatedAt: str,
    resolvedAt: nullable,
  });
  const health = obj({
    status: { type: "string", enum: ["verified", "unhealthy", "unknown"] },
    checkedAt: nullable,
    samples: { type: "integer" },
    policy: str,
  });
  const event = obj({
    id: uuid,
    actorId: nullable,
    type: str,
    metadata: { type: "object", additionalProperties: true },
    createdAt: str,
  });
  const page = (items) =>
    obj({ items: { type: "array", items }, nextCursor: nullable });
  const device = obj({
    id: uuid,
    platform: { type: "string", enum: ["android", "ios"] },
    enabled: bool,
  });
  Object.assign(schemas, {
    Incident: incident,
    Incidents: page(ref("Incident")),
    IncidentDetail: obj({
      ...incident.properties,
      repositoryId: uuid,
      health,
      correlation: str,
    }),
    IncidentTimeline: page(event),
    IncidentHealth: obj({
      ...health.properties,
      enabled: bool,
      healthPath: str,
    }),
    IncidentHealthHistory: obj({
      nextCursor: nullable,
      items: {
        type: "array",
        items: obj({
          id: uuid,
          status: { type: "string", enum: ["healthy", "unhealthy", "unknown"] },
          code: str,
          durationMs: { type: "integer" },
          checkedAt: str,
          origin: nullable,
          path: str,
          deploymentReference: nullable,
        }),
      },
    }),
    IncidentMonitor: obj({
      enabled: bool,
      healthPath: str,
      status: { type: "string", enum: ["unknown"] },
    }),
    NotificationPreferences: obj({ enabled: bool }),
    PushDevice: device,
    PushDevices: obj({ items: { type: "array", items: device } }),
    PushRevoked: obj({ revoked: bool }),
  });
  const paging = [
    parameter("limit", "query", { type: "integer", minimum: 1, maximum: 20 }),
    parameter("cursor", "query", str),
  ];
  endpoint("/incidents", "get", "listIncidents", ref("Incidents"), {
    parameters: [
      ...paging,
      parameter("severity", "query", severity),
      parameter("status", "query", status),
    ],
  });
  endpoint("/incidents", "post", "createIncident", ref("Incident"), {
    status: 201,
    parameters: [
      parameter(
        "Idempotency-Key",
        "header",
        { type: "string", minLength: 16, maxLength: 100 },
        true,
      ),
    ],
    body: obj({
      projectId: uuid,
      title: { type: "string", minLength: 1, maxLength: 160 },
      severity,
    }),
  });
  endpoint("/incidents/{id}", "get", "getIncident", ref("IncidentDetail"));
  endpoint("/incidents/{id}", "patch", "updateIncident", ref("Incident"), {
    body: obj(
      {
        version: { type: "integer", minimum: 1 },
        status: {
          type: "string",
          enum: ["open", "investigating", "mitigating", "monitoring"],
        },
        severity,
      },
      ["version"],
    ),
  });
  endpoint(
    "/incidents/{id}/resolve",
    "post",
    "resolveIncident",
    ref("Incident"),
    {
      body: obj({
        version: { type: "integer", minimum: 1 },
        confirmation: { type: "string", enum: ["RESOLVE"] },
      }),
    },
  );
  endpoint(
    "/incidents/{id}/timeline",
    "get",
    "incidentTimeline",
    ref("IncidentTimeline"),
    { parameters: paging },
  );
  endpoint(
    "/projects/{id}/health-status",
    "get",
    "incidentHealthStatus",
    ref("IncidentHealth"),
  );
  endpoint(
    "/projects/{id}/health-checks",
    "get",
    "incidentHealthChecks",
    ref("IncidentHealthHistory"),
    {
      parameters: [
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 50,
        }),
        parameter("cursor", "query", str),
      ],
    },
  );
  endpoint(
    "/projects/{id}/health-checks",
    "post",
    "configureIncidentMonitor",
    ref("IncidentMonitor"),
    {
      status: 202,
      body: obj({
        enabled: bool,
        healthPath: {
          type: "string",
          maxLength: 256,
          pattern: "^/[A-Za-z0-9/_-]*$",
        },
        confirmation: { type: "string", enum: ["MONITOR"] },
      }),
    },
  );
  endpoint(
    "/notification-preferences",
    "get",
    "getNotificationPreferences",
    ref("NotificationPreferences"),
  );
  endpoint(
    "/notification-preferences",
    "patch",
    "setNotificationPreferences",
    ref("NotificationPreferences"),
    { body: obj({ enabled: bool }) },
  );
  endpoint(
    "/devices/push-tokens",
    "get",
    "listPushDevices",
    ref("PushDevices"),
  );
  endpoint(
    "/devices/push-tokens",
    "post",
    "registerPushDevice",
    ref("PushDevice"),
    {
      status: 201,
      body: obj({
        token: { type: "string", maxLength: 200 },
        platform: device.properties.platform,
      }),
    },
  );
  endpoint(
    "/devices/push-tokens/{id}",
    "delete",
    "revokePushDevice",
    ref("PushRevoked"),
  );
}

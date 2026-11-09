export async function up(q, _T, transaction) {
  await q.sequelize.query(
    `
    CREATE UNIQUE INDEX project_incident_owner ON projects(id,user_id);
    CREATE TABLE incidents (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
      project_id uuid NOT NULL REFERENCES projects(id), title varchar(160) NOT NULL,
      severity varchar(12) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
      status varchar(20) NOT NULL CHECK (status IN ('open','investigating','mitigating','monitoring','resolved')),
      version integer NOT NULL DEFAULT 1, automatic boolean NOT NULL DEFAULT false,
      idempotency_key varchar(100), request_hash varchar(64),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
      UNIQUE(user_id,idempotency_key),
      FOREIGN KEY(project_id,user_id) REFERENCES projects(id,user_id)
    );
    CREATE INDEX incidents_owner_page ON incidents(user_id,id);
    CREATE UNIQUE INDEX incident_active_automatic ON incidents(project_id) WHERE automatic AND status <> 'resolved';
    CREATE TABLE incident_events (
      id uuid PRIMARY KEY, incident_id uuid NOT NULL REFERENCES incidents(id),
      actor_id uuid REFERENCES users(id), event_type varchar(40) NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}', request_id varchar(100) NOT NULL,
      dedupe_key varchar(180) UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX incident_timeline_page ON incident_events(incident_id,created_at,id);
    CREATE TABLE project_monitors (
      id uuid PRIMARY KEY REFERENCES projects(id), user_id uuid NOT NULL REFERENCES users(id),
      enabled boolean NOT NULL DEFAULT false, health_path varchar(256) NOT NULL DEFAULT '/health',
      next_attempt_at timestamptz NOT NULL DEFAULT now(), claim_token uuid, claim_expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE project_monitors ADD FOREIGN KEY(id,user_id) REFERENCES projects(id,user_id);
    CREATE INDEX monitor_queue ON project_monitors(enabled,next_attempt_at);
    CREATE TABLE health_checks (
      id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
      status varchar(16) NOT NULL CHECK(status IN ('healthy','unhealthy','unknown')),
      code varchar(40) NOT NULL, duration_ms integer NOT NULL, origin varchar(300), path varchar(256) NOT NULL,
      deployment_reference varchar(100), checked_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX health_history ON health_checks(project_id,checked_at DESC);
    CREATE TABLE incident_observations (
      id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
      event_key varchar(180) NOT NULL, observed_at timestamptz NOT NULL, UNIQUE(project_id,event_key)
    );
    CREATE TABLE notification_preferences (
      id uuid PRIMARY KEY REFERENCES users(id), enabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE push_devices (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), session_id uuid NOT NULL REFERENCES sessions(id),
      token_hash varchar(64) NOT NULL UNIQUE, encrypted_credentials text, key_version varchar(32) NOT NULL,
      platform varchar(10) NOT NULL CHECK(platform IN ('android','ios')), enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX push_owner ON push_devices(user_id,enabled);
    CREATE TABLE notification_deliveries (
      id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES incident_events(id), device_id uuid NOT NULL REFERENCES push_devices(id),
      status varchar(20) NOT NULL CHECK(status IN ('pending','sending','receipt','delivered','failed','unknown','canceled')),
      ticket_id varchar(100), attempts integer NOT NULL DEFAULT 0, error_code varchar(40),
      next_attempt_at timestamptz NOT NULL DEFAULT now(), claim_token uuid, claim_expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(event_id,device_id)
    );
    CREATE INDEX notification_queue ON notification_deliveries(status,next_attempt_at);
  `,
    { transaction },
  );
}
export async function down(q, _T, transaction) {
  for (const table of [
    "notification_deliveries",
    "push_devices",
    "notification_preferences",
    "incident_observations",
    "health_checks",
    "project_monitors",
    "incident_events",
    "incidents",
  ])
    await q.dropTable(table, { transaction });
  await q.sequelize.query("DROP INDEX project_incident_owner", { transaction });
}

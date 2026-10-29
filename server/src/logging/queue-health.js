import { QueryTypes } from "sequelize";

// Operator-only aggregate; no credentials, payloads or user identifiers.
export async function reportQueueHealth(sequelize, logger) {
  const rows = await sequelize.query(`
    SELECT 'deployment' AS queue, status, COUNT(*)::int AS count,
      COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at))), 0)::float AS "oldestSeconds"
    FROM operation_requests
    WHERE status NOT IN ('succeeded', 'failed')
      OR (status = 'failed' AND updated_at >= NOW() - INTERVAL '24 hours')
    GROUP BY status
    UNION ALL
    SELECT 'webhook' AS queue, status, COUNT(*)::int AS count,
      COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - received_at))), 0)::float AS "oldestSeconds"
    FROM webhook_deliveries WHERE status NOT IN ('processed', 'ignored') GROUP BY status
  `, { type: QueryTypes.SELECT });
  logger.info({ event: "queue.snapshot", queues: rows }, "Durable queue snapshot");
  for (const row of rows) {
    if (row.status === "unknown" || row.status === "failed" || row.oldestSeconds > 300) {
      logger.warn({ event: "queue.attention", ...row }, "Queue requires operator review; do not replay ambiguous writes");
    }
  }
  return rows;
}

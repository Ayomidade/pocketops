// Synthetic local drill only. Never reads a staging/production DATABASE_URL.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sequelize, QueryTypes } from "sequelize";
import { runMigrations } from "../src/db/migrate.js";
import { reportQueueHealth } from "../src/logging/queue-health.js";

if (process.argv[2] !== "--local-synthetic") throw new Error("Requires --local-synthetic; creates two disposable local databases.");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const source = `pocketops_drill_${suffix}_test`;
const target = `pocketops_restore_${suffix}_test`;
const container = "pocketops-postgres-1";
const docker = (args, options = {}) => execFileSync("docker", ["exec", "-i", container, ...args], { maxBuffer: 16 * 1024 * 1024, ...options });
const connect = (name) => new Sequelize(`postgres://pocketops:pocketops@127.0.0.1:54432/${name}`, { logging: false });
const directory = mkdtempSync(join(tmpdir(), "pocketops-restore-"));
chmodSync(directory, 0o700);
let original, restored;
try {
  for (const name of [source, target]) docker(["createdb", "-U", "pocketops", name]);
  original = connect(source); restored = connect(target);
  const migrations = await runMigrations({ sequelize: original });
  const id = randomUUID();
  await original.query("INSERT INTO users(id, github_user_id, username, created_at, updated_at) VALUES(:id, 1, 'synthetic-restore-fixture', NOW(), NOW())", { replacements: { id } });
  const backupAt = new Date().toISOString();
  const dump = docker(["pg_dump", "-U", "pocketops", "-Fc", "--no-owner", "--no-acl", source]);
  writeFileSync(join(directory, "synthetic.dump"), dump, { mode: 0o600 });
  const started = performance.now();
  docker(["pg_restore", "-U", "pocketops", "--exit-on-error", "--no-owner", "--no-acl", "-d", target], { input: dump });
  const rows = await restored.query("SELECT id, username FROM users", { type: QueryTypes.SELECT });
  if (rows.length !== 1 || rows[0].id !== id) throw new Error("Restored fixture mismatch");
  if ((await runMigrations({ sequelize: restored })).length) throw new Error("Migration metadata mismatch");
  const queues = await reportQueueHealth(restored, { info() {}, warn() {} });
  if (queues.length) throw new Error("Unexpected restored queue content");
  const indexes = await restored.getQueryInterface().showIndex("users");
  if (!indexes.some((i) => i.name === "users_github_user_id_unique" && i.unique)) throw new Error("Restored unique constraint missing");
  const evidence = { environment: "local-synthetic-only", backupAt, restoreVerifiedAt: new Date().toISOString(), restoreAndVerifyMs: Math.round(performance.now() - started), migrations, restoredRows: rows.length, source, target, stagingRpoRto: "NOT RUN", providerWorkersStarted: false };
  writeFileSync(join(directory, "evidence.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...evidence, evidenceDirectory: directory }, null, 2));
} finally {
  await original?.close(); await restored?.close();
  // No automatic DROP, overwrite, or worker restart. Databases remain for inspection.
}

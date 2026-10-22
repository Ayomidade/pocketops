import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DataTypes, QueryTypes } from "sequelize";
import { loadConfig } from "../config/env.js";
import { createDatabase } from "../config/database.js";

const migrationDirectory = new URL("./migrations/", import.meta.url);
const migrationTable = '"SequelizeMeta"';

async function getMigrations() {
  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d{3}-.*\.js$/.test(file))
    .sort();
  return Promise.all(
    files.map(async (name) => ({
      name,
      migration: await import(new URL(name, migrationDirectory)),
    })),
  );
}

async function ensureMigrationTable(sequelize) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS ${migrationTable} (
      name VARCHAR(255) PRIMARY KEY NOT NULL
    )`,
  );
}

export async function runMigrations({ sequelize, direction = "up", all = false }) {
  if (!["up", "down"].includes(direction)) {
    throw new Error("Migration direction must be 'up' or 'down'");
  }

  await ensureMigrationTable(sequelize);
  const migrations = await getMigrations();
  const appliedRows = await sequelize.query(
    `SELECT name FROM ${migrationTable}`,
    { type: QueryTypes.SELECT },
  );
  const appliedNames = new Set(appliedRows.map((row) => row.name));
  const pending =
    direction === "up"
      ? migrations.filter(({ name }) => !appliedNames.has(name))
      : migrations.filter(({ name }) => appliedNames.has(name)).reverse();
  const selected = direction === "down" && !all ? pending.slice(0, 1) : pending;
  const queryInterface = sequelize.getQueryInterface();

  for (const { name, migration } of selected) {
    await sequelize.transaction(async (transaction) => {
      if (direction === "up") {
        await migration.up(queryInterface, DataTypes, transaction);
        await sequelize.query(
          `INSERT INTO ${migrationTable} (name) VALUES (:name)`,
          { replacements: { name }, transaction },
        );
      } else {
        await migration.down(queryInterface, DataTypes, transaction);
        await sequelize.query(
          `DELETE FROM ${migrationTable} WHERE name = :name`,
          { replacements: { name }, transaction },
        );
      }
    });
  }

  return selected.map(({ name }) => name);
}

async function main() {
  const [direction = "up", ...args] = process.argv.slice(2);
  if (!["up", "down"].includes(direction)) {
    throw new Error("Usage: node src/db/migrate.js <up|down> [--all]");
  }
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run database migrations");
  }
  if (direction === "down" && config.nodeEnv === "production") {
    throw new Error(
      "Production rollback is disabled; use an approved rollback procedure",
    );
  }

  const sequelize = createDatabase(config);
  try {
    const migrated = await runMigrations({
      sequelize,
      direction,
      all: args.includes("--all"),
    });
    console.info(
      migrated.length
        ? `${direction === "up" ? "Applied" : "Reverted"}: ${migrated.join(", ")}`
        : "No pending migrations",
    );
  } finally {
    await sequelize.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Migration failed (${error.name}): ${error.message}`);
    process.exitCode = 1;
  });
}

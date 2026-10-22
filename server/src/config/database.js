import { Sequelize } from "sequelize";

export function createDatabase(config) {
  if (!config.databaseUrl) return null;

  return new Sequelize(config.databaseUrl, {
    dialect: "postgres",
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 1000,
      idle: 10000,
    },
    retry: { max: 0 },
    dialectOptions: {
      connectionTimeoutMillis: 1000,
      statement_timeout: 1000,
      ...(config.databaseSsl
        ? { ssl: { require: true, rejectUnauthorized: true } }
        : {}),
    },
  });
}

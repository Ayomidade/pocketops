import { Sequelize } from "sequelize";
import "dotenv/config";
export const sequelize = new Sequelize(
  process.env.DATABASE_URL ||
    "postgres://pocketops:pocketops@localhost:5432/pocketops",
  {
    dialect: "postgres",
    logging: false,
    dialectOptions:
      process.env.DATABASE_SSL === "true"
        ? { ssl: { require: true, rejectUnauthorized: true } }
        : {},
  },
);

import { DataTypes } from "sequelize";

export async function up(queryInterface, _Sequelize, transaction) {
  await queryInterface.createTable(
    "sessions",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      token_hash: { type: DataTypes.CHAR(64), allowNull: false },
      device_label: { type: DataTypes.STRING(100), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      last_used_at: { type: DataTypes.DATE, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    { transaction },
  );
  await queryInterface.addConstraint("sessions", {
    fields: ["token_hash"],
    type: "unique",
    name: "sessions_token_hash_unique",
    transaction,
  });
  await queryInterface.addIndex("sessions", ["user_id", "expires_at"], {
    name: "sessions_user_expiry_index",
    transaction,
  });
}

export async function down(queryInterface, _Sequelize, transaction) {
  await queryInterface.dropTable("sessions", { transaction });
}

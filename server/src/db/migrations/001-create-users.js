import { DataTypes } from "sequelize";

export async function up(queryInterface, _Sequelize, transaction) {
  await queryInterface.createTable(
    "users",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      github_user_id: { type: DataTypes.BIGINT, allowNull: false },
      username: { type: DataTypes.STRING(100), allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: true },
      avatar_url: { type: DataTypes.TEXT, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    { transaction },
  );
  await queryInterface.addConstraint("users", {
    fields: ["github_user_id"],
    type: "unique",
    name: "users_github_user_id_unique",
    transaction,
  });
}

export async function down(queryInterface, _Sequelize, transaction) {
  await queryInterface.dropTable("users", { transaction });
}

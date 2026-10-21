import "dotenv/config";
import { app } from "./app.js";
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, "0.0.0.0", () =>
  console.log(`PocketOps API listening on :${port}`),
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));

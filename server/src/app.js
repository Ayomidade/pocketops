import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { errorHandler, notFound } from "./middleware/errors.js";
export const app = express();
app.disable("x-powered-by");
app.use(helmet());
const allowed = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowed.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed"));
    },
  }),
);
app.use(express.json({ limit: "64kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);
app.get("/api/v1/health", (_req, res) =>
  res.json({ success: true, data: { status: "ok", service: "pocketops-api" } }),
);
app.use(notFound);
app.use(errorHandler);

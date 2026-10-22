import { randomUUID } from "node:crypto";
import pino from "pino";
import pinoHttp from "pino-http";

const requestIdPattern = /^[A-Za-z0-9._-]{1,100}$/;

export function createLogger(config, destination = process.stdout) {
  return pino(
    {
      level: config.logLevel,
      base: { service: "pocketops-api", environment: config.nodeEnv },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-api-key",
          "*.password",
          "*.token",
          "*.secret",
          "*.privateKey",
        ],
        censor: "[REDACTED]",
      },
    },
    destination,
  );
}

export function createRequestLogger(logger) {
  return pinoHttp({
    logger,
    genReqId(request, response) {
      const suppliedId = request.headers["x-request-id"];
      const requestId =
        typeof suppliedId === "string" && requestIdPattern.test(suppliedId)
          ? suppliedId
          : randomUUID();
      response.setHeader("X-Request-ID", requestId);
      return requestId;
    },
    customProps(request) {
      return { requestId: request.id };
    },
    serializers: {
      req(request) {
        return {
          id: request.id,
          method: request.method,
          url: request.url?.split("?")[0],
          remoteAddress: request.remoteAddress,
        };
      },
      res(response) {
        return { statusCode: response.statusCode };
      },
    },
    customLogLevel(_request, response, error) {
      if (error || response.statusCode >= 500) return "error";
      if (response.statusCode >= 400) return "warn";
      return "info";
    },
  });
}

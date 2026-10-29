// Log-derived metrics: fixed labels only, never URLs, source, tokens or user IDs.
export function requestMetrics(logger, clock = () => performance.now()) {
  return (request, response, next) => {
    const started = clock();
    response.once("finish", () => {
      logger.info({
        event: "http.metric", requestId: request.id,
        method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(request.method) ? request.method : "OTHER",
        status: response.statusCode,
        durationMs: Math.max(0, Math.round(clock() - started)),
      }, "HTTP request metric");
    });
    next();
  };
}

export async function measureJob(logger, run, clock = () => performance.now()) {
  const started = clock();
  try {
    const processed = await run();
    logger.info({ event: "job.metric", job: "deployment", outcome: processed ? "processed" : "idle", durationMs: Math.max(0, Math.round(clock() - started)) }, "Deployment worker heartbeat");
    return processed;
  } catch (error) {
    logger.error({ event: "job.metric", job: "deployment", outcome: "error", durationMs: Math.max(0, Math.round(clock() - started)) }, "Deployment worker iteration failed");
    throw error;
  }
}

import { AppError } from "../../errors/app-error.js";
export const transitions = {
  open: ["investigating"],
  investigating: ["mitigating", "monitoring"],
  mitigating: ["investigating", "monitoring"],
  monitoring: ["investigating", "resolved"],
  resolved: ["open"],
};
export function assertTransition(from, to) {
  if (!transitions[from]?.includes(to))
    throw new AppError(
      409,
      "INVALID_INCIDENT_TRANSITION",
      "Refresh the incident and choose an allowed transition.",
    );
}
// A TCP connection, a single 200, or a deployment's live status is insufficient.
export function healthSummary(rows, now = new Date()) {
  const recent = rows.slice(0, 3);
  const latest = recent[0];
  const fresh =
    latest &&
    now - new Date(latest.checkedAt) <= 180000 &&
    now >= new Date(latest.checkedAt);
  const consistent =
    recent.length === 3 &&
    recent.every(
      (r) =>
        r.origin === latest.origin &&
        r.path === latest.path &&
        r.deploymentReference === latest.deploymentReference,
    ) &&
    new Date(recent[0].checkedAt) - new Date(recent[2].checkedAt) >= 120000 &&
    new Date(recent[0].checkedAt) - new Date(recent[2].checkedAt) <= 300000;
  return {
    status: !fresh
      ? "unknown"
      : consistent && recent.every((r) => r.status === "healthy")
        ? "verified"
        : consistent && recent.every((r) => r.status === "unhealthy")
          ? "unhealthy"
          : "unknown",
    checkedAt: latest?.checkedAt || null,
    samples: recent.length,
    policy:
      "Three matching observations across 120–300 seconds; expires after 180 seconds.",
  };
}

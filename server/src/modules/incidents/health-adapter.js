import https from "node:https";
import { Resolver } from "node:dns/promises";
import ipaddr from "ipaddr.js";
export function isPublicAddress(address) {
  try {
    const ip = ipaddr.parse(address);
    return (
      ip.range() === "unicast" &&
      !(ip.kind() === "ipv6" && ip.isIPv4MappedAddress())
    );
  } catch {
    return false;
  }
}
export function approvedOrigin(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash &&
      /^[a-z0-9][a-z0-9-]*\.onrender\.com$/.test(u.hostname)
      ? u.origin
      : null;
  } catch {
    return null;
  }
}
export const validHealthPath = (path) =>
  typeof path === "string" &&
  /^\/[A-Za-z0-9/_-]{0,255}$/.test(path) &&
  !path.includes("//");
async function resolvePublic(host) {
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const answers = await Promise.allSettled([
    resolver.resolve4(host),
    resolver.resolve6(host),
  ]);
  // ENODATA is expected when a host only has one family; other DNS failures fail closed.
  if (
    answers.some(
      (r) =>
        r.status === "rejected" &&
        !["ENODATA", "ENOTFOUND"].includes(r.reason?.code),
    )
  )
    throw new Error("DNS unavailable");
  return answers.flatMap((r, i) =>
    r.status === "fulfilled"
      ? r.value.map((address) => ({ address, family: i === 0 ? 4 : 6 }))
      : [],
  );
}
export function createHealthProbe({
  resolve = resolvePublic,
  request = https.request,
  clock = () => Date.now(),
} = {}) {
  return async (origin, path) => {
    const started = clock();
    const result = (status, code) => ({
      status,
      code,
      durationMs: Math.max(0, clock() - started),
    });
    if (!approvedOrigin(origin) || !validHealthPath(path))
      return result("unknown", "TARGET_NOT_APPROVED");
    let timer;
    try {
      const records = await Promise.race([
        resolve(new URL(origin).hostname),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("DNS timeout")), 2000);
        }),
      ]);
      clearTimeout(timer);
      if (
        !records.length ||
        records.length > 32 ||
        records.some((r) => !isPublicAddress(r.address))
      )
        return result("unknown", "ADDRESS_BLOCKED");
      const pinned = records[0];
      return await new Promise((resolveResult) => {
        let finished = false;
        const finish = (status, code) => {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            resolveResult(result(status, code));
          }
        };
        // Keep the original TLS hostname/SNI, but connect only to the vetted IP.
        const req = request(
          new URL(path, origin),
          {
            method: "GET",
            agent: false,
            family: pinned.family,
            lookup: (_host, options, cb) =>
              options.all
                ? cb(null, [pinned])
                : cb(null, pinned.address, pinned.family),
            headers: {
              Accept: "text/plain",
              "User-Agent": "PocketOps-Health/1",
            },
          },
          (res) => {
            let bytes = 0;
            res.on("data", (chunk) => {
              bytes += chunk.length;
              if (bytes > 16384) {
                finish("unknown", "RESPONSE_TOO_LARGE");
                res.destroy();
                req.destroy();
              }
            });
            res.on("error", () => finish("unknown", "RESPONSE_INTERRUPTED"));
            res.on("end", () =>
              finish(
                res.statusCode >= 200 && res.statusCode < 300
                  ? "healthy"
                  : "unhealthy",
                res.statusCode >= 300 && res.statusCode < 400
                  ? "REDIRECT_BLOCKED"
                  : `HTTP_${res.statusCode}`,
              ),
            );
          },
        );
        timer = setTimeout(() => {
          finish("unknown", "TIMEOUT");
          req.destroy();
        }, 3000);
        req.on("error", () => finish("unknown", "NETWORK_ERROR"));
        req.end();
      });
    } catch {
      return result("unknown", "DNS_ERROR");
    } finally {
      clearTimeout(timer);
    }
  };
}

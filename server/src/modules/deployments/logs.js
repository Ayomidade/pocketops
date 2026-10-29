/* eslint-disable no-control-regex -- Deliberately strip terminal/control sequences from untrusted log text. */
// Defense in depth, not a guarantee against arbitrary secrets in application logs.
export function redactLog(value, secrets = []) {
  let text = String(value).slice(0, 32768);
  for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED]");
  text = text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED AUTHORIZATION]")
    .replace(/\b(?:rnd_|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/g, "[REDACTED TOKEN]")
    .replace(/((?:["']?)(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|set-cookie|database_url)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g, "")
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .slice(0, 4096);
  return Buffer.from(text).subarray(0, 4096).toString("utf8").replace(/\uFFFD$/u, "");
}

# PocketOps — Security and Threat Model

**Version:** 1.1 | **Classification:** Security design baseline | **Current scaffold:** NOT production ready

## 1. Why PocketOps is high trust

PocketOps may access private repositories, production logs and deployment actions. A compromised mobile session, malicious repository, insecure OAuth callback or overprivileged provider credential can expose code or impact production. Security is a release-blocking requirement, not a later enhancement.

## 2. Assets and trust boundaries

**Assets:** PocketOps session tokens, GitHub installation identity/tokens, Render credentials, private source code, deployment metadata, production logs, audit trails, notification tokens. **Boundaries:** phone ↔ API, API ↔ database, API/worker ↔ GitHub, API/worker ↔ Render, webhook sender ↔ API, WebView editor ↔ native host. Never equate user input, provider metadata, repository contents or logs with trusted instructions.

## 3. Threat matrix

| Threat                     | Attack scenario                   | Mitigation                                                                         | Test                                          |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| Account takeover           | Stolen mobile token               | Opaque revocable session, SecureStore, expiry, device logout                       | Revoked token returns 401                     |
| OAuth login CSRF           | Forged callback or deep link      | State, PKCE as applicable, one-use handoff, redirect allowlist                     | Invalid/replayed state denied                 |
| IDOR/BOLA                  | Guess another user's project UUID | Service-level object authorization and installation checks                         | Cross-user GET/POST denied                    |
| Overbroad GitHub access    | App installed on all repos        | Repository selection and minimal App permissions                                   | Removed repo immediately denied               |
| Provider key disclosure    | API returns connection record     | Encrypt, redact, DTO allowlist                                                     | Response contains no secret                   |
| Forged webhook             | Spoofed deployment event          | Raw-body signature/auth verification, dedup, rate limits                           | Bad signature denied                          |
| Replay/duplicate deploy    | Mobile retries request            | DB idempotency and reconciliation                                                  | One upstream action                           |
| Concurrent edits           | Stale file overwritten            | Expected SHA and branch protection                                                 | 409 conflict                                  |
| WebView injection          | Repo file injects scripts         | Packaged editor HTML, strict bridge, no arbitrary navigation                       | Script payload cannot call privileged actions |
| SSRF                       | User supplies internal health URL | Approved production domain, DNS/IP restrictions, redirects disabled or revalidated | Private IP blocked                            |
| Log-based XSS/data leakage | Malicious logs or secrets         | Render as text, redact and bound                                                   | HTML treated as text                          |
| Worker compromise          | Untrusted code executed           | No code execution in MVP; separate runtime later                                   | No shell endpoint                             |
| Push token abuse           | Unauthorized device registration  | Bind to user/session, revoke tokens                                                | Cross-user token denial                       |
| Supply chain               | Compromised dependency            | Lockfiles, CI audit, minimal dependencies, review updates                          | CI policy checks                              |

## 4. Authentication specification

Use GitHub OAuth only for identity and a GitHub App for repository access. The app opens the system browser, not an embedded login WebView. Backend generates/validates OAuth state and PKCE where applicable, exchanges authorization code server-side, and issues a short-lived single-use mobile handoff. Mobile exchanges handoff for an opaque PocketOps credential. Store only that credential in Expo SecureStore. Hash token at rest (e.g., SHA-256 with adequate random token entropy), enforce expiry and revocation; avoid storing raw tokens. Validate all deep-link schemes/hosts and prevent open redirects. Apply login rate limits and anomaly monitoring.

## 5. Authorization specification

Enforce `authenticate → validate → authorize resource → execute`. Repository access requires current user entitlement to the GitHub installation and the repository's inclusion in that installation; cached access alone is insufficient for sensitive writes. Project access requires ownership and valid provider connection; provider service ID must belong to that connection. All IDs are untrusted, including those received from app routes and webhooks. Deny by default, return minimal error details, log denial without leaking data.

## 6. Provider credentials and encryption

Use provider-supported minimal scopes when available. Store Render credentials server-side using envelope encryption with managed keys where possible; include key version for rotation. Keep GitHub App private key and OAuth client secret in backend secret manager. Generate short-lived installation tokens on demand and cache only for permitted lifetime. Never put secrets in Expo public env vars, JavaScript bundles, logs, error responses, analytics or audit metadata. Support disconnect/revoke and credential revalidation.

## 7. Production action safety

Only allow enumerated provider operations. Require project authorization, exact target resolution, human confirmation and an `Idempotency-Key`. Persist operation request and request hash before enqueueing. Protect against repeated upstream calls after timeouts by reconciliation; mark ambiguous operations `unknown` for manual handling. Respect branch protection and CI; no forced direct production commits by default. Record actor, action, target, timestamps and result. Show deployment and health statuses separately.

## 8. Webhooks

Verify signature against **raw** request bytes before JSON parsing. Validate supported events, record unique delivery ID, acknowledge promptly, process asynchronously and reconcile with provider API for critical state. Guard against duplicates and stale deliveries. Do not treat webhook body as authorization to mutate production.

## 9. Mobile and editor security

- Native navigation/deployment controls; editor-only WebView with bundled static HTML/assets.
- Allowlist bridge messages; validate JSON schema, session nonce, origin/navigation and maximum payload sizes.
- Never inject provider credentials or PocketOps bearer tokens into WebView JavaScript.
- Treat source code as inert text; escape HTML and avoid dynamic eval.
- Draft retention is explicit; protect drafts with OS secure facilities where practical, clear on logout and allow user deletion.
- Biometrics may gate sensitive UI actions, but are not a substitute for backend authorization.
- Push payloads should contain minimal incident metadata, no logs or secrets.

## 10. API hardening

Use TLS, secure HTTP headers, strict CORS only if applicable to web callbacks, JSON body size limits, schema validation (Zod), rate limits by actor/IP/action, safe path normalization and bounded provider timeouts. Apply per-user and per-provider quotas. Scrub request/response logs. Never return internal stack traces in production. Ensure provider errors map to safe codes and actionable client messages.

## 11. Health-check SSRF controls

Do not accept arbitrary full URLs for server fetch. Prefer a validated production domain obtained from the connected provider plus a constrained path. Reject localhost, loopback, link-local, private and metadata addresses; revalidate DNS and redirects; enforce ports, protocol, timeouts, response size and redirect count. If these safeguards cannot be implemented confidently, defer server-side health checking and use provider health status only.

## 12. Audit, incident response and operations

Audit login/logout, connection creation/revocation, repository access changes, commits, PR creation, deployment requests/results and incident resolution. Audit records should be append-only with strict access and defined retention. Monitor repeated auth failures, webhook verification failures, unusual deployment volume, credential errors and queue dead letters. Maintain emergency provider access outside PocketOps, credential rotation runbooks, backup/restore tests and a way to disable deployments globally.

## 13. Release security checklist

- [ ] No real secrets committed or shipped in mobile bundle.
- [ ] Cross-user object access tests pass for every protected endpoint.
- [ ] OAuth invalid/replay callbacks rejected.
- [ ] GitHub installation removal takes effect.
- [ ] Webhook signature and duplicate delivery tests pass.
- [ ] File conflict and protected branch behavior tested.
- [ ] Deployment idempotency survives API restart and worker retry.
- [ ] Logs and WebView payloads are safely rendered.
- [ ] SSRF tests pass or health-check feature remains disabled.
- [ ] Provider credentials can be revoked and rotated.
- [ ] Database backup and emergency recovery path documented.
- [ ] Security review completed before real production access.

## 14. Deferred cloud execution threat model

Future isolated workspaces introduce arbitrary-code execution, egress exfiltration, resource exhaustion and container escape risks. Require VM-grade isolation or equivalent, no host socket mounts, per-session quotas, network restrictions, short-lived credentials, cleanup and dedicated infrastructure. **Do not implement any remote terminal in MVP.**

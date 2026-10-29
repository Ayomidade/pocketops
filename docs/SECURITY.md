# PocketOps — Security and Threat Model

**Version:** 1.1 | **Classification:** Security design baseline | **Current scaffold:** NOT production ready

## 1. Why PocketOps is high trust

PocketOps may access private repositories, production logs and deployment actions. A compromised mobile session, malicious repository, insecure OAuth callback or overprivileged provider credential can expose code or impact production. Security is a release-blocking requirement, not a later enhancement.

## 2. Assets and trust boundaries

**Assets:** PocketOps session tokens, GitHub installation identity/tokens, Render credentials, private source code, deployment metadata, production logs, audit trails, notification tokens. **Boundaries:** phone ↔ API, API ↔ database, API/worker ↔ GitHub, API/worker ↔ Render, webhook sender ↔ API, WebView editor ↔ native host. Never equate user input, provider metadata, repository contents or logs with trusted instructions.

## 3. Threat matrix

| Threat                     | Attack scenario                   | Mitigation                                                                                 | Test                                              |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Account takeover           | Stolen mobile token               | Opaque revocable session, SecureStore, expiry, device logout                               | Revoked token returns 401                         |
| OAuth login CSRF           | Forged callback or deep link      | Hashed one-use state, exact redirect allowlist, completion-secret binding, one-use handoff | Invalid/replayed state and spoofed handoff denied |
| IDOR/BOLA                  | Guess another user's project UUID | Service-level object authorization and installation checks                                 | Cross-user GET/POST denied                        |
| Overbroad GitHub access    | App installed on all repos        | Repository selection and minimal App permissions                                           | Removed repo immediately denied                   |
| Provider key disclosure    | API returns connection record     | Encrypt, redact, DTO allowlist                                                             | Response contains no secret                       |
| Forged webhook             | Spoofed deployment event          | Raw-body signature/auth verification, dedup, rate limits                                   | Bad signature denied                              |
| Replay/duplicate deploy    | Mobile retries request            | DB idempotency and reconciliation                                                          | One upstream action                               |
| Concurrent edits           | Stale file overwritten            | Expected SHA and branch protection                                                         | 409 conflict                                      |
| WebView injection          | Repo file injects scripts         | Packaged editor HTML, strict bridge, no arbitrary navigation                               | Script payload cannot call privileged actions     |
| SSRF                       | User supplies internal health URL | Approved production domain, DNS/IP restrictions, redirects disabled or revalidated         | Private IP blocked                                |
| Log-based XSS/data leakage | Malicious logs or secrets         | Render as text, redact and bound                                                           | HTML treated as text                              |
| Worker compromise          | Untrusted code executed           | No code execution in MVP; separate runtime later                                           | No shell endpoint                                 |
| Push token abuse           | Unauthorized device registration  | Bind to user/session, revoke tokens                                                        | Cross-user token denial                           |
| Supply chain               | Compromised dependency            | Lockfiles, CI audit, minimal dependencies, review updates                                  | CI policy checks                                  |

## 4. Authentication specification

Use GitHub OAuth for identity. Repository access is a separate GitHub App authorization and installation flow; identity sign-in alone grants no repository permissions. The app opens the system browser using Expo WebBrowser, never an embedded login WebView. The backend hashes and validates OAuth state, exchanges authorization codes with its confidential client credentials, and requests only `read:user`. GitHub supports and recommends S256 PKCE: both identity and GitHub App user authorization send a challenge and matching server-only verifier. See [Authentication review](AUTHENTICATION.md) for derivation, session race fixes and remaining manual gates. The backend uses a fixed HTTPS callback and exact configured mobile redirect.

The mobile app generates a 256-bit completion secret and keeps it only in memory during the browser flow. The backend stores only its hash with the OAuth transaction. After the callback, a random handoff code is placed in the registered app-scheme callback; it expires within two minutes, is hashed at rest and can be consumed once only with the matching completion secret. Intercepting or spoofing the deep link alone therefore cannot mint a PocketOps session. A process interruption discards the completion secret and requires restarting sign-in.

The backend fetches the GitHub profile and never returns or persists the provider access token. The mobile app receives an opaque PocketOps session token only after handoff exchange. Tokens are stored in Expo SecureStore; only SHA-256 hashes are stored in PostgreSQL. Sessions expire after 30 days, are checked against PostgreSQL on each protected request, and can be rotated or revoked. Rotation replacement tokens are first stored in SecureStore so the client can recover if the response is interrupted. Email is optional and treated as unverified. Apply per-IP auth rate limits and structured audit events that exclude codes, secrets and tokens. Production must use HTTPS.

The configured native redirect is an explicit single-value allowlist (for this app, `pocketops://auth/callback`). OAuth callback query values and one-time handoffs must be excluded from reverse-proxy/ingress access logs. PocketOps request logging omits query strings and redacts authorization headers. A custom app scheme may be claimed by another installed application; the separate completion-secret binding mitigates handoff interception, but a verified HTTPS App Link/Universal Link would provide stronger platform-level ownership if adopted later.

The GitHub App connection flow separately binds both OAuth and setup callbacks to hashed, one-use state stored for 15 minutes. The backend confirms that the App-authorized GitHub user ID matches the PocketOps user's immutable GitHub ID, verifies that the installation appears in that user's current GitHub installations, and intersects user-visible repositories with installation-visible repositories. Each PocketOps user has a separate installation membership and explicit repository selections. Every repository read revalidates live user and installation access; the shared catalog is not an authorization grant. The native callback contains only an allowlisted status.

## 5. Authorization specification

Enforce `authenticate → validate → authorize resource → execute`. Repository access requires current user entitlement to the GitHub installation and the repository's inclusion in that installation; cached access alone is insufficient for sensitive writes. Project access requires ownership and valid provider connection; provider service ID must belong to that connection. All IDs are untrusted, including those received from app routes and webhooks. Deny by default, return minimal error details, log denial without leaking data.

## 6. Provider credentials and encryption

Use provider-supported minimal scopes when available. Browsing requires Contents: read and Metadata: read. The editor additionally needs Contents: write and Pull requests: write; grant them only to installations that need editing. The server exposes only fix-branch, expected-SHA file commit and PR operations, and rejects commits to default/protected branches. The App ID/private key, client secret and webhook secret remain on the server. GitHub App user and refresh tokens are AES-256-GCM encrypted in PostgreSQL using a server-side 32-byte key; installation tokens are generated server-side and never returned to clients. Losing the encryption key requires users to reconnect; key rotation is not implemented yet. Never put secrets in Expo public env vars, JavaScript bundles, logs, error responses, analytics or audit metadata.

The editor WebView loads a packaged CodeMirror bundle with restrictive CSP, no network connections, and exact navigation allowlisting. Its versioned protocol validates message size, schema, session and request correlation; it never receives provider credentials. Source stays in memory unless the user has a local draft. Drafts are AES-GCM encrypted, scoped to a per-user key in device-only SecureStore, stored in app-private files, limited to five files of 512 KiB each and expire after 24 hours. Logout/session expiry deletes that user's draft key and files. Drafts are never synced to GitHub automatically. Audit records contain paths, hashes and operation status, never source text.

GitHub webhooks are verified over raw request bytes with HMAC-SHA256 and constant-time comparison. Delivery IDs are unique; only normalized fields needed for installation/repository reconciliation are stored. The PostgreSQL delivery queue retries with bounded backoff in the API process; there is no separate worker or Redis dependency in this milestone. Access logs must not include authorization headers, OAuth query values or webhook bodies.

## 7. Production action safety

Only allow enumerated provider operations. Require project authorization, exact target resolution, human confirmation and an `Idempotency-Key`. Persist operation request and request hash before enqueueing. Protect against repeated upstream calls after timeouts by reconciliation; mark ambiguous operations `unknown` for manual handling. Respect branch protection and CI; no forced direct production commits by default. Record actor, action, target, timestamps and result. Show deployment and health statuses separately.

## 8. Webhooks

Verify signature against **raw** request bytes before JSON parsing. Validate supported events, record unique delivery ID, acknowledge promptly, process asynchronously and reconcile with provider API for critical state. Guard against duplicates and stale deliveries. Do not treat webhook body as authorization to mutate production.

## 9. Mobile and editor security

The native repository explorer keeps all query data in memory, scopes the cache
to a PocketOps session, and cancels/clears it on logout/session change. Source
has zero inactive retention and is removed on preview blur/background; metadata
is explicitly stale during offline/revalidation states. Known 401/403/404 failures
purge related repository caches. See [Repository explorer](REPOSITORY_EXPLORER.md)
for the tested policy and its live-device/revocation limitations.

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

## Render milestone security boundary

Render credentials use a versioned AES-256-GCM key ring with owner/connection/version AAD and lazy rotation. Native onboarding briefly handles the user-entered key for HTTPS submission, then clears it; responses are metadata-only and no key is persisted on device. Render API keys can be broadly privileged; use a dedicated test account. Deployment requests persist their confirmation, target fingerprint and audit before queueing. Expired dispatch claims and ambiguous writes become unknown and cannot be blindly replayed. The operator kill switch must be set consistently on API and worker; it cannot cancel an in-flight provider request.

Log redaction is defense in depth, not comprehensive secret recognition. Source applications must avoid logging secrets. Logs are bounded and not stored; memory caches clear on authorization loss/background/logout. Durable operation/idempotency and audit rows require an approved retention policy. Health probes remain unavailable, avoiding an arbitrary-fetch/SSRF endpoint in this milestone. See [DEPLOYMENTS.md](DEPLOYMENTS.md) for manual security gates and rotation/revocation details.

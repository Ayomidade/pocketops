# PocketOps — REST API Contract

**Version:** 1.3 | **Base path:** `/api/v1` | **Transport:** HTTPS JSON

The machine-readable contract for implemented endpoints is [openapi.json](openapi.json).
Its JavaScript source is `server/src/contracts/openapi.js` (plus
`server/src/contracts/deployments.js`); regenerate with
`npm run api:contract` and verify with `npm run api:contract:check`. Tests check
route coverage and real response envelopes. Endpoints described below that are
not yet implemented (section 7) remain planned and are intentionally absent from
the generated contract.

> Implemented: liveness/readiness, identity/session endpoints, GitHub App repository reads, the guarded editor APIs in section 5, and the Render provider-connection, project, deployment, log and operation endpoints in sections 5–6. Editor writes require server configuration and explicit GitHub App write permissions; deployment reads require a provider encryption key ring and GitHub App configuration; new redeploy requests additionally require `DEPLOYMENTS_ENABLED=true`, and redeploy processing requires the separate `npm run worker:deployments` process. Incidents, notifications, health verification and Render webhooks remain planned and are intentionally absent from the generated contract.

## 1. Conventions

**Authentication:** `Authorization: Bearer <opaque-pocketops-session>` for protected mobile requests (recommended). Token is issued by PocketOps, stored with Expo SecureStore, hashed server-side, revocable and rotated as appropriate. Never use GitHub installation tokens in the mobile app.

**Headers:** `Content-Type: application/json`; `X-Request-ID` optional client correlation; `Idempotency-Key` required for sensitive production mutations. **Pagination:** `?limit=20&cursor=...` for list endpoints; server enforces maximum. **Time:** ISO-8601 UTC. **Identifiers:** UUIDs for PocketOps, strings for provider-native IDs.

For the implemented protected auth routes, send the opaque PocketOps session credential as `Authorization: Bearer <session-token>` over HTTPS. It is not a GitHub OAuth or GitHub App token.

**Success:**

```json
{ "success": true, "data": { "id": "..." }, "meta": { "requestId": "req_123" } }
```

**Error:**

```json
{
  "success": false,
  "error": {
    "code": "FILE_VERSION_CONFLICT",
    "message": "The file changed after you opened it."
  },
  "meta": { "requestId": "req_123" }
}
```

**HTTP:** 200 read/update, 201 created, 202 queued, 204 delete, 400 malformed, 401 unauthenticated, 403 forbidden, 404 hidden/not found, 409 conflict, 422 validation, 429 throttled, 502/503 upstream. Do not return raw provider stack traces.

## 2. Health and session

| Method | Path                    | Auth                                | Response                                                                          |
| ------ | ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/health`               | No                                  | Liveness; independent of PostgreSQL                                               |
| GET    | `/ready`                | No/internal                         | PostgreSQL readiness; 503 if absent/unavailable; Redis is not required yet        |
| POST   | `/auth/mobile/start`    | No                                  | Create state-bound transaction; return backend browser URL (201)                  |
| GET    | `/auth/github`          | No, prepared state                  | Redirect to GitHub authorization (302); `/auth/github/start` is an alias          |
| GET    | `/auth/github/callback` | OAuth state                         | Exchange code server-side; redirect with one-use handoff or safe error            |
| POST   | `/auth/mobile/exchange` | One-use handoff + completion secret | Issue opaque PocketOps session (200)                                              |
| GET    | `/auth/me`              | Yes                                 | Current user and session summary (200)                                            |
| POST   | `/auth/session/rotate`  | Yes                                 | Atomically replace current session using client-persisted replacement token (200) |
| POST   | `/auth/logout`          | Yes                                 | Immediately revoke current session (200)                                          |

These paths are available under `/api/v1` and as unversioned `/auth` aliases; the GitHub callback configured in GitHub must be the exact canonical URL `https://<API_HOST>/api/v1/auth/github/callback`.

**Implemented OAuth behavior:** the mobile client first posts an allowlisted redirect URI and a 256-bit completion secret to `/auth/mobile/start`. The backend stores hashes of both OAuth state and the completion secret, and returns an authorization URL. Opening that URL in the system browser goes through `GET /auth/github` to GitHub. The OAuth state expires after 10 minutes and can be consumed once. The callback exchanges the authorization code using backend-only credentials, requests only `read:user`, reads identity server-side, and redirects to `pocketops://auth/callback` with a random, one-use handoff that expires after two minutes. The app exchanges the handoff together with the completion secret held only in memory. The handoff alone is insufficient to create a session.

Identity OAuth and GitHub App user authorization use `code_challenge_method=S256`, a challenge and matching server-only `code_verifier`. The confidential backend client, state validation, fixed callback URI and independent mobile completion-secret binding remain in place. See [GitHub's OAuth authorization documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

The exchange response includes the raw PocketOps session token exactly once. It is stored by the app only in Expo SecureStore; PostgreSQL stores only its SHA-256 hash. Sessions expire after 30 days. When a stored session approaches expiry, the app generates and stores a replacement token in SecureStore before the server atomically revokes the old session and stores the replacement hash. `GET /auth/me` returns an allowlisted user/session summary and never returns a token. `POST /auth/logout` revokes the current session; every authenticated request checks revocation and expiry against PostgreSQL. No automatic replay of non-idempotent requests is performed.

OAuth App email is optional and is not treated as verified. GitHub App installation, repository permissions, GitHub access tokens and repository APIs are not part of identity login. `/auth/logout-all` remains planned and is not implemented.

## 3. GitHub App installation and repository selection

All routes are under `/api/v1`. Except the provider callbacks and webhook, routes require a valid PocketOps bearer session. Connecting a GitHub App does not change identity sign-in. The server verifies the current PocketOps user's immutable GitHub ID and intersects repositories available to that user with those available to the installation.

| Method | Path                                                 | Purpose and response                                                                                                   |
| ------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| POST   | `/github/installations/start`                        | Authenticated initiation; returns an OAuth URL (201)                                                                   |
| GET    | `/github/oauth/callback`                             | State-bound GitHub OAuth callback; redirects to GitHub App installation (302)                                          |
| GET    | `/github/installations/callback`                     | Validates one-time setup state and account access; redirects to `pocketops://github/callback?status=...` (302)         |
| GET    | `/github/installations`                              | Current installations authorized to this PocketOps user; checks upstream access                                        |
| GET    | `/github/installations/:installationId/repositories` | Current live repository access and this user's selections                                                              |
| POST   | `/github/installations/sync`                         | Replaces the user's selection; body `{ "installationId": "<PocketOps UUID>", "githubRepositoryIds": ["123"] }`         |
| POST   | `/webhooks/github`                                   | Verifies the raw-body `X-Hub-Signature-256`; deduplicates `X-GitHub-Delivery`; queues supported events and returns 202 |

OAuth state and installation state are random, separate, hashed, single-use and expire after 15 minutes. OAuth and session-provider credentials remain encrypted on the server. Callback errors redirect only an allowlisted status, never tokens or authorization codes. Webhook payloads are normalized to allowlisted metadata before persistence; raw bodies are not queued or logged. PostgreSQL-backed webhook processing runs in the API process and retries failed deliveries with bounded exponential delay. Redis is not required for this milestone.

GitHub App webhooks handle installation creation/deletion/suspension/permission changes, repository additions/removals and user authorization revocation. Duplicate delivery IDs do not duplicate state changes. Current installation and user repository access is revalidated with GitHub before returning repository information; inaccessible resources return 404. An installation's repository catalog is shared, but repository selections and authorization are per PocketOps user.

## 5. Source editor workflow

Routes are under `/api/v1/github/repositories/{repositoryId}` and require a PocketOps session plus selected-repository authorization. `GET /branches/metadata?branch=...` returns the live branch commit SHA and protection flag. `POST /branches` creates a fix branch from an explicitly selected base branch and commit. `PUT /file` commits an existing UTF-8 file to a PocketOps-recorded fix branch after checking its expected blob SHA. `GET /pull-requests?head=...&base=...` lists pull requests for that tracked branch pair; `POST /pull-requests` creates one. Mutations require an `Idempotency-Key` and are rate limited. File content is capped at 512 KiB. The OpenAPI contract is in [openapi.json](openapi.json).

The App needs Contents: write for branches/commits and Pull requests: write for PRs. Access is revalidated on each request. Commits to the default or a protected branch are rejected. Stale content returns `409 FILE_VERSION_CONFLICT`; a moved base returns `409 BASE_VERSION_CONFLICT`. A successful commit is not evidence that tests passed, a PR merged, or a deployment succeeded. See [CODE_EDITOR.md](CODE_EDITOR.md).

## 4. Read-only repository endpoints

| Method | Path                                          | Query/body            | Response/notes                                         |
| ------ | --------------------------------------------- | --------------------- | ------------------------------------------------------ |
| GET    | `/github/repositories`                        | `cursor,limit,search` | Selected repositories with current access              |
| GET    | `/github/repositories/:repositoryId`          | —                     | Selected repository details, current access required   |
| GET    | `/github/repositories/:repositoryId/tree`     | `path,ref`            | One directory; at most 1,000 entries, bounded path/ref |
| GET    | `/github/repositories/:repositoryId/file`     | `path,ref`            | Text metadata/content; max 512 KiB                     |
| GET    | `/github/repositories/:repositoryId/branches` | `cursor`              | Branches, paginated in batches of 100                  |

The API repository IDs are PocketOps UUIDs. All routes require the authenticated user's explicit selection, an active installation membership and live GitHub authorization. Paths reject traversal and control characters. Files are returned as editable UTF-8 only when valid; binary content returns `content: null`, `encoding: "binary"` and `editable: false`. Guarded branch, commit, pull-request and deployment write routes are documented in their dedicated sections; these read-only routes never mutate repositories.

**Directory limit:** GitHub Contents does not paginate directories. `meta.nextCursor` is always null for tree responses; `meta.directoryLimitReached` is true at 1,000 entries and the UI warns that the listing may be incomplete. Supplying a tree cursor returns 422 `DIRECTORY_CURSOR_UNSUPPORTED`. Repository and branch list pagination is unchanged. Submodules are identified as `type: "submodule"`; the explorer does not follow them.

**Preview contract:** file `sha` is the blob revision, not a last-commit timestamp. Only valid, size-consistent base64 UTF-8 content is returned as text; unsupported encoding is binary/non-editable. Declared or encoded files over 512 KiB are rejected with 413. Mismatched decoded size returns a safe 502.

**GET file response example:**

```json
{
  "success": true,
  "data": {
    "path": "src/app.js",
    "ref": "main",
    "sha": "abc123",
    "encoding": "utf-8",
    "content": "console.log('Hello');",
    "editable": true
  },
  "meta": { "requestId": "req_123" }
}
```

**PUT file request example:**

```json
{
  "path": "src/app.js",
  "branch": "fix/runtime-error",
  "expectedSha": "abc123",
  "content": "console.log('Fixed');",
  "message": "fix: runtime error"
}
```

**PUT file behavior:** authenticated+authorized; verify path is within repo, file type/size, branch protection and SHA; never overwrite on conflict. Do not allow secrets to be submitted as commit content without deliberate developer action; warn about detected secret patterns without pretending perfect detection.

**POST branch example:**

```json
{ "name": "fix/payment-500", "fromRef": "main", "expectedBaseSha": "def456" }
```

**POST PR example:**

```json
{
  "head": "fix/payment-500",
  "base": "main",
  "title": "Fix payment 500 error",
  "body": "Investigated via PocketOps",
  "draft": false
}
```

## 5. Provider connections and projects

| Method | Path                                 | Purpose                                       |
| ------ | ------------------------------------ | --------------------------------------------- |
| GET    | `/provider-connections`              | List sanitized connections (never ciphertext) |
| POST   | `/provider-connections/render`       | Validate and securely store Render credential |
| DELETE | `/provider-connections/:id`          | Revoke/delete local connection                |
| GET    | `/provider-connections/:id/services` | List authorized provider services             |
| GET    | `/projects`                          | List linked projects                          |
| POST   | `/projects`                          | Link repository and Render service            |
| GET    | `/projects/:id`                      | Project summary                               |
| PATCH  | `/projects/:id`                      | Update name (health-check config is planned)  |

**Project creation example:**

```json
{
  "name": "payments-api",
  "repositoryId": "uuid",
  "connectionId": "uuid",
  "providerServiceId": "srv-abc123"
}
```

Validate provider service belongs to connection and repository is currently authorized. Credentials are submitted only over TLS and immediately encrypted; never echo them in response or logs. `PATCH /projects/:id` accepts only `name` in this milestone (health-check configuration is planned with incident work). The `providerServiceId` must match Render's `srv-…` identifier format.

## 6. Deployments and logs

| Method | Path                        | Purpose                                       |
| ------ | --------------------------- | --------------------------------------------- |
| GET    | `/projects/:id/deployments` | Recent deployments; `cursor,limit`            |
| GET    | `/projects/:id/logs`        | `from,to,limit,cursor,level` bounded logs     |
| POST   | `/projects/:id/deployments` | Request explicitly confirmed supported action |
| GET    | `/deployments/:id`          | Deployment status and provider mapping        |
| GET    | `/operations/:id`           | Async operation status; health is always `not_checked` in this milestone |

**Redeploy request:**

```http
POST /api/v1/projects/PROJECT_UUID/deployments
Idempotency-Key: 4eec8b93-unique-request-key
Content-Type: application/json
```

```json
{
  "action": "redeploy",
  "confirmation": "DEPLOY",
  "target": {
    "serviceId": "srv-abc123",
    "deploymentId": "dep-xyz789",
    "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

The target must name the exact service, the current live deployment and its commit; the server revalidates each against the provider before enqueueing.

**202 response:**

```json
{
  "success": true,
  "data": {
    "operationId": "uuid",
    "projectId": "uuid",
    "action": "redeploy",
    "status": "queued",
    "deploymentId": null,
    "providerReference": null,
    "targetDeploymentId": "dep-xyz789",
    "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "errorCode": null,
    "healthStatus": "not_checked",
    "reconciliationRequired": false
  },
  "meta": { "requestId": "req_123" }
}
```

`202` means the request was accepted and queued — never that a deployment succeeded or that service health was verified. Poll `GET /operations/:id`; operation status and provider deployment status are tracked separately, and `healthStatus` remains `not_checked` until health verification ships in a later milestone.

**Idempotency:** key unique per actor, persisted with request hash; replay with same body returns original operation; same key/different body returns 409. One active operation per project. Provider support determines allowed actions; rollback and promotion are not supported by the Render adapter and are exposed as `capabilities: false`, never simulated.

**Logs:** common secrets are redacted, but arbitrary application logs can still contain secrets or personal data. The server caps time range (≤1 hour window), number of records and payload bytes; sanitize provider data; return HMAC-signed expiring cursors, not unlimited dumps. Example fields: `timestamp,level,message`. No log contents or credentials are stored in audit metadata. See [DEPLOYMENTS.md](DEPLOYMENTS.md) for exact limits and redaction boundaries.

**Verified Render API operations** (base `https://api.render.com/v1`, used only server-side by the Render adapter):

| Render operation                                   | PocketOps use                          |
| -------------------------------------------------- | -------------------------------------- |
| `GET /services`                                    | List services for project mapping      |
| `GET /services/{id}`                               | Validate service and capabilities      |
| `GET /services/{id}/deploys`                       | Deployment history                     |
| `GET /services/{id}/deploys/{id}`                  | Deployment status reconciliation       |
| `POST /services/{id}/deploys` (`{commitId}`)       | Confirmed redeploy of a known commit   |
| `GET /logs` (owner/resource/time bounded)          | Bounded runtime logs                   |

Rollback, promotion and health verification are not offered. These endpoints were verified against mocked contract fixtures in automated tests; a live Render account has not been exercised in this environment.

## 7. Incidents, health and notifications

> Planned for the incident milestone; none of these endpoints exist yet and none appear in the generated contract.

| Method    | Path                         | Purpose                                   |
| --------- | ---------------------------- | ----------------------------------------- |
| GET       | `/incidents`                 | Filter `projectId,status,severity,cursor` |
| POST      | `/incidents`                 | Create incident                           |
| GET       | `/incidents/:id`             | Detail                                    |
| PATCH     | `/incidents/:id`             | Title/severity/status updates             |
| POST      | `/incidents/:id/resolve`     | Resolve with note                         |
| GET       | `/incidents/:id/timeline`    | Chronological events                      |
| GET       | `/projects/:id/health`       | Last verified health result               |
| POST      | `/projects/:id/health/check` | Queue approved health check               |
| POST      | `/devices/push`              | Register/update device push token         |
| DELETE    | `/devices/push/:id`          | Disable token                             |
| GET/PATCH | `/notification-preferences`  | View/update preferences                   |
| GET       | `/audit-events`              | Authorized audit history                  |
| POST      | `/webhooks/render`           | Verified supported provider events        |

**Incident create example:**

```json
{
  "projectId": "uuid",
  "title": "Payment requests returning 500",
  "description": "Detected after deploy",
  "severity": "high"
}
```

**Resolve example:** `{ "note": "Healthy after deployment verification" }`. Resolution records an event; health verification and human resolution are separate concepts.

## 8. Security and authorization matrix

| Resource            | Read                        | Write                    | Extra safeguard                   |
| ------------------- | --------------------------- | ------------------------ | --------------------------------- |
| Own user/session    | Authenticated user          | Own session              | Revoke/rotation                   |
| GitHub repository   | Current installation access | Current write permission | Branch + SHA checks               |
| Provider connection | Owner                       | Owner                    | Encryption and redaction          |
| Project/deployment  | Project owner               | Project owner            | Provider mapping and confirmation |
| Incident            | Project owner               | Project owner            | Timeline audit                    |
| Audit event         | Authorized owner            | Server only              | Append-only                       |

## 9. Webhooks

Read raw request body for signature verification; validate timestamp/replay where supported; persist delivery ID with uniqueness; enqueue work and return quickly. Respond consistently to duplicates. Unknown events should be safely ignored and counted. Never trust webhook payloads as commands to deploy.

## 10. Client/network behavior

Use request cancellation, bounded retries for safe GET requests, explicit user retry for writes, offline UI, token-expired handling and pagination. Mobile should not expose direct provider credentials. Use a stable API version; breaking contract changes require migration notes and integration tests.

## 11. Open API questions

Provider-specific logs/redeploy capabilities must be verified at implementation time; API schema and status enums should be frozen before mobile/backend parallel development. Add generated OpenAPI schema and contract tests during Milestone 1–2.

Render capability sources, queue/unknown-outcome semantics, setup and validation: [DEPLOYMENTS.md](DEPLOYMENTS.md).

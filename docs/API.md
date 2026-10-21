# PocketOps — REST API Contract

**Version:** 1.1 | **Base path:** `/api/v1` | **Transport:** HTTPS JSON | **Status:** Planned endpoints unless noted as implemented

> The starter currently implements only `GET /health`. This document specifies target APIs for Codex milestones; it must not be mistaken for implemented behavior.

## 1. Conventions

**Authentication:** `Authorization: Bearer <opaque-pocketops-session>` for protected mobile requests (recommended). Token is issued by PocketOps, stored with Expo SecureStore, hashed server-side, revocable and rotated as appropriate. Never use GitHub installation tokens in the mobile app.

**Headers:** `Content-Type: application/json`; `X-Request-ID` optional client correlation; `Idempotency-Key` required for sensitive production mutations. **Pagination:** `?limit=20&cursor=...` for list endpoints; server enforces maximum. **Time:** ISO-8601 UTC. **Identifiers:** UUIDs for PocketOps, strings for provider-native IDs.

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

| Method | Path                    | Auth            | Response                                                                               |
| ------ | ----------------------- | --------------- | -------------------------------------------------------------------------------------- |
| GET    | `/health`               | No              | `{success:true,data:{status:'ok',service:'pocketops-api'}}` **implemented in starter** |
| GET    | `/ready`                | No/internal     | Dependency readiness (planned)                                                         |
| GET    | `/auth/github/start`    | No              | OAuth initiation URL/state-bound flow                                                  |
| GET    | `/auth/github/callback` | OAuth flow      | Browser callback, short-lived mobile handoff                                           |
| POST   | `/auth/mobile/exchange` | One-use handoff | PocketOps session credential                                                           |
| GET    | `/auth/me`              | Yes             | Current user and session summary                                                       |
| POST   | `/auth/logout`          | Yes             | Revoke current session                                                                 |
| POST   | `/auth/logout-all`      | Yes             | Revoke user's sessions                                                                 |

**OAuth security:** system browser, state validation, PKCE when supported, strict redirect/deep-link allowlist; one-time handoff never contains a provider access token. The originally discussed `/auth/github` can redirect to `/auth/github/start` for compatibility if desired.

## 3. GitHub installations

| Method | Path                                     | Purpose                                |
| ------ | ---------------------------------------- | -------------------------------------- |
| GET    | `/github/installations`                  | Current authorized installations       |
| POST   | `/github/installations/sync`             | Refresh selected installation metadata |
| GET    | `/github/installations/:id/repositories` | Repositories for installation          |
| POST   | `/webhooks/github`                       | Signed GitHub webhook receiver         |

`POST /github/installations/sync` body `{installationId:"123456"}`; server must validate that the current user is entitled to that installation. Sync is not permission-granting.

## 4. Repository endpoints

| Method | Path                              | Query/body                                | Response/notes                         |
| ------ | --------------------------------- | ----------------------------------------- | -------------------------------------- |
| GET    | `/repositories`                   | `cursor,limit,search`                     | Authorized repo summaries              |
| GET    | `/repositories/:id`               | —                                         | Repo details and current permissions   |
| GET    | `/repositories/:id/tree`          | `path,ref,cursor`                         | Directory entries; limit depth/size    |
| GET    | `/repositories/:id/file`          | `path,ref`                                | UTF-8 content, blob SHA, editable flag |
| GET    | `/repositories/:id/branches`      | `cursor,limit`                            | Branch list                            |
| POST   | `/repositories/:id/branches`      | `name,fromRef,expectedBaseSha`            | Created branch or 409                  |
| PUT    | `/repositories/:id/file`          | `path,branch,expectedSha,content,message` | Commit SHA; 409 on stale blob          |
| GET    | `/repositories/:id/pull-requests` | `state,cursor,limit`                      | PR list                                |
| POST   | `/repositories/:id/pull-requests` | `head,base,title,body,draft`              | PR URL and number                      |

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
| PATCH  | `/projects/:id`                      | Update name/health-check configuration        |

**Project creation example:**

```json
{
  "name": "payments-api",
  "repositoryId": "uuid",
  "connectionId": "uuid",
  "providerServiceId": "srv_..."
}
```

Validate provider service belongs to connection and repository is currently authorized. Credentials are submitted only over TLS and immediately encrypted; never echo them in response or logs.

## 6. Deployments and logs

| Method | Path                        | Purpose                                       |
| ------ | --------------------------- | --------------------------------------------- |
| GET    | `/projects/:id/deployments` | Recent deployments; `cursor,limit`            |
| GET    | `/projects/:id/logs`        | `from,to,limit,cursor,level` bounded logs     |
| POST   | `/projects/:id/deployments` | Request explicitly confirmed supported action |
| GET    | `/deployments/:id`          | Deployment status and provider mapping        |
| GET    | `/operations/:id`           | Async operation status and health result      |

**Redeploy request:**

```http
POST /api/v1/projects/PROJECT_UUID/deployments
Idempotency-Key: 4eec8b93-unique-request-key
Content-Type: application/json
```

```json
{
  "action": "redeploy",
  "target": { "type": "current-service-version" },
  "confirmation": "DEPLOY"
}
```

**202 response:**

```json
{
  "success": true,
  "data": {
    "operationId": "uuid",
    "status": "queued",
    "deploymentStatus": "unknown",
    "healthStatus": "not_checked"
  },
  "meta": { "requestId": "req_123" }
}
```

**Idempotency:** key unique per actor, persisted with request hash; replay with same body returns original operation; same key/different body returns 409. Provider support determines allowed actions; do not assume universal rollback.

**Logs:** server caps time range, number of records and payload bytes; sanitize provider data; return cursors, not unlimited dumps. Example fields: `timestamp,level,message,serviceId,source` (when available). No secrets in logs or audit metadata.

## 7. Incidents, health and notifications

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

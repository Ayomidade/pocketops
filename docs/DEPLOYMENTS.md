# PocketOps — manual Render deployments

Implementation and local validation: 2026-10-28. Live Render and physical-device acceptance are **NOT RUN**. This milestone stops at manual operations and deployment status; incidents, notifications and independent health checks remain future work.

## Inventory and decisions

Existing identity, GitHub App authorization, native repository explorer and guarded editor modules are preserved. The deployment tab was a planned-feature card. Implemented here: encrypted Render connections, authorized repository/service mappings, native timeline/detail/log screens, two-stage confirmed live-commit redeploy, and a durable operation worker. Historical explorer reports describe their original milestone and are not claims about the current code.

The architecture's Redis/BullMQ diagram was a target, while existing GitHub webhook work already used PostgreSQL. This milestone deliberately uses the PostgreSQL operation table as its durable queue, with a **separate worker process**, row locks, skip-locked claiming and fenced 60-second leases. No Redis dependency is introduced. Redis/BullMQ transport remains deferred; a future transport must enqueue operation IDs only and preserve these database idempotency and dispatch safeguards. This is an explicit deviation from the target transport, preserving the modular monolith and authoritative PostgreSQL state.

Render's default deploy request can deploy the newest branch commit. PocketOps instead requires the exact current live deployment ID and full commit SHA, revalidates both before dispatch, and sends that `commitId`. It rebuilds that commit with the service's current configuration; it is **not an immutable artifact rollback**. Current environment/configuration and build dependencies may differ. There must be a live Git commit in the first 20 deployment records. Image-backed services, cron job deploys, suspended services and services without an authorized GitHub repository are unavailable for redeploy. Static sites can redeploy but do not expose runtime logs here. There is no branch write or arbitrary provider proxy.

## Verified provider contract

Checked against Render's published documentation, with synthetic fixtures in CI, not a live account:

- [API key setup](https://render.com/docs/api): validate a supplied API key using a single-service list read. Do not assume per-service scopes or OAuth support. Use a dedicated account/workspace and disposable service for staging.
- [Service listing](https://api-docs.render.com/reference/list-services) and [service retrieval](https://api-docs.render.com/reference/retrieve-service): sanitize metadata; exact service/repository association is checked server-side.
- [Deployment listing](https://api-docs.render.com/reference/list-deploys) and [retrieval](https://api-docs.render.com/reference/retrieve-deploy): bounded cursor pagination and exact-ID reconciliation.
- [Trigger deploy](https://api-docs.render.com/reference/create-deploy): `POST /services/{id}/deploys` with `commitId` and `clearCache: do_not_clear`. Provider 201/202 means acceptance only. Provider-side idempotency for this request is not assumed.
- [Log API](https://api-docs.render.com/reference/list-logs): owner ID, exact resource, timestamps, direction, limit and optional level. Render paginates using next start/end timestamps; PocketOps wraps those in a project/window/level-bound HMAC cursor expiring in five minutes.
- [Rate limiting](https://api-docs.render.com/reference/rate-limiting): respect 429 and reset headers; worker uses bounded exponential backoff and jitter. Each adapter keeps a bounded process-local cooldown, keyed by a token digest. It is not a distributed account-wide quota scheduler.

`canRollback`, `canPromote` and `supportsHealthVerification` are always false. They describe PocketOps capability, not a claim that Render has no other API operations.

## Setup, migration and revocation

Existing PostgreSQL, PocketOps session and GitHub App setup is required. No new mobile public variables. `EXPO_PUBLIC_API_URL` is the API base URL only.

Server/worker environment:

- `PROVIDER_ENCRYPTION_KEYS`: secret JSON map of key version to base64 32-byte AES key, at most five versions. Generate keys into your secret manager, never chat or commits.
- `PROVIDER_ACTIVE_KEY_VERSION`: active version present in that ring.
- `DEPLOYMENTS_ENABLED`: defaults to `false`. Enables new deploy requests and worker dispatch when true; connection/history/log reads only require the key ring and GitHub configuration. Set false in **both API and worker**, then restart both, to stop new dispatch. Already dispatched provider actions can still proceed.
- Existing `DATABASE_URL`, SSL and `GITHUB_APP_*`/GitHub encryption settings must match across processes. There is no server environment variable containing each user's Render key: they submit it through the native secure input over HTTPS.

Run `npm run db:migrate`, then run the API and `npm run worker:deployments` as separately supervised processes. A healthy HTTP process does not mean the worker is running. Without the worker, accepted requests stay queued. Use the Deployments tab to connect Render, choose an accessible service and the matching authorized GitHub repository. The key input is cleared on submission/background; the app never persists it or receives it in API responses. The request temporarily contains the user-entered key, so disable request-body logging and use HTTPS.

Migration: `006-create-deployments.js`. It adds `provider_connections`, `projects`, `deployments`, `operation_requests` and `auth_audit_events.operation_request_id`, with ownership FKs, unique mapping/deployment/idempotency constraints, and a partial unique index for active/unknown operations per project. Apply with `npm run db:migrate`. On disposable/non-production data, `npm run db:migrate:undo` reverses the latest migration; it removes deployment state and audit linkage. Stop the worker and assess queued/unknown operations before rollback. Production rollback is deliberately blocked by the existing CLI. No deployed database was modified during this task.

Credentials use AES-256-GCM with random 96-bit nonce and AAD binding user, connection and key version. Rotation: add the new key to API and worker secret managers, switch the active version consistently, and allow lazy re-encryption on connection use. Retain old keys until no active row references them, signed cursors expire, and the backup recovery period ends. Monitor `key_version` using a restricted read-only role. Dormant connections must reconnect or be explicitly re-encrypted before old keys are retired.

Disconnect erases local ciphertext and marks projects disconnected. Upstream 401/403 also disconnects the credential. This does not revoke the API key globally or cancel an already dispatched deploy. Revoke it in Render Account Settings for global revocation. Mapping changes are not silently followed. Connection deletion is local revocation, not credential replacement: this milestone has no user-facing reconnect/rebind endpoint. Existing disconnected mappings and same-owner/service uniqueness require an approved operator procedure before reconnecting the same service or changing its repository. Other services can still be mapped normally. Do not create another project to bypass an unknown operation lock.

## Request and worker state

Every deployment mutation requires an authenticated owner, current GitHub repository authorization, active provider connection, exact live target, literal `DEPLOY` confirmation and bounded `Idempotency-Key`. Native UI first shows a review, then a native confirmation naming project, service ID and SHA. The server cannot prove a human saw a dialog; its authorization and validated confirmation contract are mandatory independently of the UI.

Request and audit row commit in one transaction before `202`. Keys are actor-scoped and durable; same key/body returns the operation, different body returns 409. A partial unique index blocks another operation for a project while one is queued, validating, requesting, accepted or unknown. The project detail exposes that operation for interrupted mobile flows; the UI disables another redeploy. In-memory retry keys persist while the confirmation route is mounted, not across a killed process. A new request after interruption cannot bypass the project's active-operation constraint.

State: `queued → validating → requesting → accepted → succeeded | failed | unknown`. Safe preflight reads/definite 429 rejection retry at most five attempts, starting around 30 seconds and capped at five minutes plus jitter; provider cooldown can extend that delay to an hour. The kill switch fails queued work instead of replaying it later. Acceptance reconciliation polls the exact provider deployment ID about every 15 seconds, up to 120 claims, backing off read failures. Provider metadata uses `queued | building | live | failed | canceled | unknown`. Unrecognized provider statuses are sanitized to `unknown`.

A transaction persists `requesting` and an audit event **before** the upstream POST. A lost response, invalid accepted response, provider write 5xx, DB failure after acceptance, or expired requesting lease becomes `unknown`; the worker does not trigger the POST again. Concurrent workers are fenced by claim tokens. Expired validation leases are safe to reclaim because dispatch has not occurred. There is no heuristic matching of unrelated deployments by time/SHA.

`accepted` is not successful deployment. An operation is `succeeded` only after the exact deployment reports `live`. All health fields remain `not_checked`, including after live. Audit records separately capture queued/requested/provider acceptance/progress/completion/unknown; no source, provider key or log content is stored in them. Health verification events are unavailable until that feature exists.

Unknown outcomes block another project request and need manual operator reconciliation. Inspect the exact Render service/history, provider reference if known, operation/audit timestamps and whether a request could still be in flight. Disable dispatch while investigating. Do not delete rows, recycle idempotency keys or reset unknown/requesting rows to queued. There is deliberately no user-facing “retry unknown” action. An audited operator procedure to conclusively resolve unknown state and release the project lock is a remaining operational gate; the application does not guess success or issue a duplicate deploy.

## Logs, mobile privacy and limits

Log requests are limited to a one-hour ordered window, 1–100 records, 4 KiB UTF-8 per line and 128 KiB of serialized entries per page; upstream responses have a 2 MiB stream cap and 10-second timeout. A truncated page tells the user to narrow/filter instead of silently pretending the listing is complete. The native viewer supports refresh, all/error filtering, pagination, selectable monospace text and row expansion for long lines. Lists use FlatList with 12 initial rows, bounded rendering windows and retained query pages: four log pages, ten metadata pages. These are implementation limits, not Android frame-rate benchmarks.

Redaction covers the connection key, common token/password/authorization/cookie patterns, URL credentials, private-key blocks and terminal control sequences. It is **not complete secret detection**; avoid logging secrets at their source. Logs may contain personal data. They are not persisted by PocketOps; mobile queries have zero inactive retention and are hidden/aborted/removed on background, session change and known authorization/mapping failures. Metadata stays in the session-scoped memory cache, is labeled stale while offline, and cannot authorize an operation. There is no AsyncStorage log cache. Logout clears the session's query client. Deployments and durable audit/idempotency metadata are retained; establish approved retention before production and never prune active/unknown idempotency rows to make a retry possible.

## Checks and manual acceptance

Automated coverage includes encryption tamper/owner/version binding, key validation, connection ownership, cross-user IDs, exact mapping and GitHub revocation, bounded log windows/redaction/pagination, provider 401/403/404/429/5xx/timeout/partial responses, duplicate and conflicting idempotency keys, durable audit, multi-worker claims, process-restart ambiguity, safe retries, kill switch and independent status/health. Native tests cover connection and mapping, list pagination, delayed loading, offline/errors/retry, native double confirmation, stable-key retry, log filtering/expansion, accepted/unknown/live wording and unsupported capability states. Fixtures are synthetic.

Local migration tests use a newly created `pocketops_render_milestone_test` database inside the existing local PocketOps PostgreSQL container. They apply all migrations, check persistent/concurrent deployment behavior, and roll back all migrations to an empty database. Supertest and PostgreSQL checks require local socket access; the sandbox-only attempt failed EPERM and the approved local-access rerun passed. No provider key was configured or real service mutated.

Manual checks **NOT RUN** (no connected device or isolated Render account/key):

1. Configure HTTPS and both providers in staging. Verify invalid/valid/revoked credentials; exact selected repository/service mapping; timeline, logs and empty/static-site behavior.
2. On a disposable service only, confirm one redeploy. Repeat the same idempotency key and verify one upstream action; observe queued/requesting/accepted/building/live or failure and health still not checked.
3. Kill/restart worker before dispatch and after requesting; simulate lost response through a staging proxy. Verify no blind retrigger, unknown lock, and the operator's manual reconciliation process.
4. On Android: TalkBack labels, 48px actions, safe areas, font scaling, small screen scroll, back gestures, current portrait/rotation configuration, keyboard/key input clearing, long log lines, slow/airplane-mode network, 429, background/resume, logout and provider revocation. Measure list render/scroll on an actual midrange device.
5. Compile native Android and iOS builds. A JavaScript export does not validate WebView/native compilation or device behavior. Revalidate current dependencies and operational backup/monitoring gates before production.

## Exact milestone file inventory

This spans the initial implementation now in commit `e3e4dab` and the continuation fixes/tests/documentation in the working tree. Existing editor-only changes in that commit are not counted here.

- Entry/config: `package.json`, `server/package.json`, `server/.env.example`, `server/src/config/env.js`, `server/src/app.js`, `server/src/server.js`, `server/src/middleware/errors.js`, `server/src/db/models/index.js`.
- Persistence/worker: `server/src/db/migrations/006-create-deployments.js`, `server/src/jobs/deployment-worker.js`.
- Backend feature: `server/src/modules/deployments/provider.js`, `render-adapter.js`, `crypto.js`, `logs.js`, `models.js`, `repository.js`, `service.js`, `controller.js`, `routes.js`, `runtime.js` (all under that feature directory).
- Contract: `server/src/contracts/deployments.js`, `server/src/contracts/openapi.js`, `docs/openapi.json`.
- Routes: `mobile/app/(tabs)/deployments.jsx`, `mobile/app/project/_layout.jsx`, `mobile/app/project/index.jsx`, `mobile/app/project/[id].jsx`, `mobile/app/project/connections.jsx`, `mobile/app/project/new.jsx`, `mobile/app/project/redeploy.jsx`, `mobile/app/deployment/[id].jsx`, `mobile/app/operation/[id].jsx`.
- Native feature/cache: `mobile/src/features/deployments/api.js`, `queries.js`, `components.jsx`, `screens.jsx` (all under that feature directory); `mobile/src/features/repositories/cache.js`, `mobile/src/features/repositories/RepositoryProvider.jsx`.
- Tests: `server/tests/deployment-api.test.js`, `server/tests/deployments.test.js`, `server/tests/render-adapter.test.js`, `server/tests/migrations.test.js`, `server/tests/openapi.test.js`, `server/tests/fixtures/deployments.js`, `server/tests/fixtures/persistent-deployments.js`; `mobile/tests/deployments-screens.test.jsx`, `mobile/tests/deployments.test.jsx`, `mobile/tests/repositories.test.mjs`.
- Docs: `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/SETUP.md`, `docs/DEVELOPMENT_PLAN.md`, `docs/OPERATIONS.md`, `docs/DEPLOYMENTS.md`.

No new runtime dependency is needed for this milestone; crypto uses Node's authenticated-encryption primitives and existing Sequelize/React Query/React Native tooling. No new TypeScript, WebView, remote shell, rollback/promotion, incident automation, push integration or production health probe is introduced.

## Final executed checks

| Command/check | Actual result |
| --- | --- |
| `DATABASE_URL_TEST=… npm test` (dedicated `pocketops_render_milestone_test` database) | PASS: 115 server tests, 27 mobile Node tests, 53 native UI tests; zero skipped. Includes apply/all-rollback and durable/concurrent PostgreSQL checks. |
| `npm run lint` | PASS for server and mobile. |
| `npm run api:contract:check` | PASS; generated OpenAPI artifact is current. |
| `git diff --check` | PASS. |
| `npm ls --depth=0` | PASS; no new runtime dependency added for Render. |
| `npm exec --workspace=mobile -- expo install --check` | Local dependency-map validation passes; network disabled, so online compatibility metadata was not checked. |
| `npm run export -w mobile -- --platform android --output-dir /tmp/pocketops-render-final-export` | PASS: 1,453 modules, Android Hermes/JavaScript bundle approximately 4.81 MB. This is not an APK/native build. |
| Live Render validation/deploy/revocation | NOT RUN: isolated account/service/key not configured; no real deploy triggered. |
| Android physical-device UI/performance and native compilation; iOS native build/runtime | NOT RUN for this milestone: device/staging prerequisites absent; no device or Xcode verification claimed. |
| Fresh online advisory audit and clean reinstall | NOT RUN in this continuation; earlier dependency advisories remain a separate gate. No clean-audit claim. |

The full root suite completed without the earlier asynchronous `act` warning. The new UI integration fixture uses controlled timers for deferred list/query notifications; assertions still verify actual requests, confirmations and rendered states.

Acceptance against automated implementation: connect/map/history/logs **PASS**; confirmed idempotent audited redeploy **PASS**; encrypted backend credential handling and metadata-only responses **PASS**; requested/deployed/health distinction **PASS**; unsupported operations unavailable **PASS**. Live provider and physical-device acceptance for these remains **NOT RUN**. Reconnect/rebind and audited operator resolution of unknown outcomes remain explicit operational gaps, not simulated app features.

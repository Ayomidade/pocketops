# Milestone 07 validation — 2026-11-09

Implementation is available for combined local testing; **live acceptance and beta release are not complete**. [Setup, design, security and staging drill](INCIDENTS.md).

## Scope and inventory

The repository now contains incident lifecycle/timeline, automated verified-origin health checks, Render reconciliation, native response screens and Expo push workers. Commit `adcffa9` contains the initial milestone implementation; newer commits committed that work and added a webhook path. This continuation reviewed the current working tree instead of replacing those modules. Corrections include real Render Standard Webhooks signatures/headers, optional startup wiring, safe transactional reconciliation scheduling (rather than unauthenticated direct creation), cursor health history, notification audits/quota handling, reduced repeated observations, seven-day active health-history pruning and native empty-state/test fixes. Existing `GET /health`, editor/PR and deployment routes are preserved. The Android export regenerated the bundled editor asset from its existing source; no editor feature was added.

The older roadmap numbers incidents as milestone 6, while `/prompts` numbers it **07**. This report uses the prompt numbering. Redis/BullMQ was a target, but the implemented queue is PostgreSQL; this milestone retains that architecture. No provider API is called from mobile.

## Commands and actual outcomes

| Command | Outcome |
| --- | --- |
| `npm test` with `DATABASE_URL_TEST` pointing to the isolated `pocketops_incidents_v2_test` database | PASS: 186 server tests in 16 files; 46 mobile Node tests; 67 mobile UI tests in 10 suites |
| `npm run test -w server -- tests/migrations.test.js tests/incidents.test.js tests/render-webhook.test.js` with the same isolated DB | PASS: 44 tests in 3 files, including final quota regression and migration up/down |
| `npm run lint` | PASS: server and mobile |
| `npm run api:contract` / `npm run api:contract:check` | PASS: generated contract current and valid |
| `npm exec --workspace=mobile -- expo install --check` | PASS: dependencies up to date |
| `npm run export -w mobile -- --platform android --output-dir /tmp/pocketops-m7-export` | PASS: Android Hermes JS bundle and assets exported; not an APK/native build |
| `npm audit --json` | FAIL release gate: 31 advisory entries (4 high, 19 moderate, 8 low, 0 critical) |
| `git diff --check` | PASS |
| Native Android/iOS build, device/FCM delivery, live Render webhook/health checks, staging recovery drill | NOT RUN: no staging service or attached device/FCM validation; no EAS build requested |

The audit's high entries are `decode-uri-component`, `expo-router`, `image-size`, `query-string`. No forced SDK-major upgrade or audit bypass was performed. UI tests emit existing renderer/act warnings; all assertions pass. Timing from a host renderer is not Android performance evidence.

Intermediate failures were resolved: a notification listener test needed an AppState subscription mock; generated OpenAPI needed refreshing after cursor changes; local PostgreSQL was stopped and restarted; a repository syntax mistake was corrected; formatter-created multiline computed property access was adjusted to satisfy ESLint. Earlier failed runs are not counted as successful validation. No migration was applied to the user's application database.

## Tests and coverage limits

- Incident routes: authentication on every resource endpoint, invalid input/cursors, foreign incidents, revoked provider access; list/detail enforce current project authorization.
- PostgreSQL: all seven migrations up/down, ownership/uniqueness, concurrent idempotent create, legal/versioned transitions, audited timeline and notification outbox, verified-resolution guard, health cursor pages, failed-deploy dedup, webhook scheduling/dedup/out-of-order/unmapped hints, notification leases and session revocation. Reactivating a disabled device must respect the ten-device cap.
- Health: private/reserved IPv4/IPv6 and mapped-address rejection, mixed DNS denial, pinned connection with original TLS hostname, redirect refusal, response cap, stale/mismatched/insufficient observations and transition policy.
- Push: minimal payload, permission revocation/denial, throttled retries and exhaustion, ambiguous send, receipt handling and DeviceNotRegistered. Native bridge tests cover signed-out taps, ID validation, foreground refresh and simulated cold-start notification response.
- Mobile: empty lists, creation/navigation, unknown recovery, explicit resolve confirmation, revoked cache hiding, offline health hiding and permission-denied settings. Full repository/editor/deployment/auth regression suites also pass.

Simulated killed-app handling is not OS delivery evidence. Actual DNS/network behavior in the intended host, missed transient failures between polls, manual combined PR/deploy/health workflow, TalkBack/back gesture/native keyboard and physical performance remain uncovered live cases.

## Migration and configuration

`server/src/db/migrations/007-create-incidents.js` is the only new milestone schema migration. Apply with `npm run db:migrate`; rollback with `npm run db:migrate:undo` only if 007 is latest, after stopping affected API/workers and backing up evidence. Rollback drops incident/health/push data. It was exercised only in a disposable DB. No `sync` is used.

Existing database/GitHub and `PROVIDER_ENCRYPTION_KEYS` / `PROVIDER_ACTIVE_KEY_VERSION` remain prerequisites. Optional server-only `EXPO_PUSH_ACCESS_TOKEN` supports enhanced Expo push security; optional `RENDER_WEBHOOK_SECRET` is the real `whsec_…` signing secret. Polling works without webhooks. Native Android push needs Firebase client `GOOGLE_SERVICES_JSON` (EAS file variable), EAS FCM v1 credentials and a new preview APK using runtime `0.1.0-incidents.1`. Only `EXPO_PUBLIC_API_URL` is public client configuration. See setup instructions before running a cloud build.

## Acceptance results

| Prompt 07 criterion | Status | Evidence / limit |
| --- | --- | --- |
| Authorized developer can create, investigate and resolve with audit/timeline | PASS (automated) | Database lifecycle/audit tests and native confirmation tests; physical workflow pending |
| Verified events update incidents without duplicates or unauthorized mutation | PASS (automated) | Signed events schedule current authorized reconciliation; persisted dedup and active-incident constraint; live provider delivery NOT RUN |
| Health checks cannot fetch arbitrary internal resources | PASS (automated boundary tests) | Provider-origin allowlist, all-address rejection, TLS/IP pinning, no redirect, time/size caps; host egress review still required |
| Best-effort push contains no sensitive details; in-app state authoritative | PASS (automated) | Encrypted token, session/access recheck, minimal payload, bounded retry/unknown handling, foreground/tap tests; FCM device delivery NOT RUN |
| Documented phone-only staging recovery drill completes | NOT RUN | Checklist written; isolated staging environment/device acceptance unavailable |

No claim of complete milestone acceptance, security certification or production readiness. Keep beta NO-GO until device/staging checks, advisory remediation and existing hardening gates pass.

## Operational risks and intentional exclusions

Monitoring only supports public Render web services at their canonical onrender.com origin. Custom domains/private services/static sites and arbitrary health URLs are disabled. A shallow HTTP health endpoint can miss business failures; one process with bounded serial provider calls cannot promise a 60-second SLA. Push is best-effort and already handed-off generic notifications cannot be recalled. Tokens need re-registration after login/rotation and key retirement. Active probe records have short retention; general incident/audit/dedup/delivery retention and account deletion remain operator processes. Operators retain independent GitHub/Render access.

No autonomous remediation, remote execution, guessed affected-file suggestions, team escalation, extra provider or full observability platform was added. New fixes still follow GitHub CI/review/merge; the existing redeploy action targets the current live revision and does not deploy an arbitrary PR. No production service, repository, cloud build, or public release was triggered.

## Exact files changed in this continuation

The initial milestone files are already in commit `adcffa9`. The following working-tree changes finish and correct that implementation against the current `5e20de3` baseline:

- `README.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/BETA_HARDENING.md`
- `docs/DATABASE.md`
- `docs/DEVELOPMENT_PLAN.md`
- `docs/INCIDENTS.md`
- `docs/MILESTONE_07_VALIDATION.md`
- `docs/PRIVACY.md`
- `docs/SECURITY.md`
- `docs/SETUP.md`
- `docs/openapi.json`
- `mobile/app/incident/_layout.jsx`
- `mobile/src/features/editor/codemirror.bundle.js`
- `mobile/src/features/incidents/screens.jsx`
- `mobile/tests/incident-notifications.test.jsx`
- `server/.env.example`
- `server/src/app.js`
- `server/src/contracts/deployments.js`
- `server/src/contracts/incidents.js`
- `server/src/jobs/deployment-worker.js`
- `server/src/modules/deployments/render-webhook-routes.js`
- `server/src/modules/deployments/render-webhook.js`
- `server/src/modules/deployments/repository.js`
- `server/src/modules/incidents/repository.js`
- `server/src/modules/incidents/routes.js`
- `server/src/modules/incidents/service.js`
- `server/src/server.js`
- `server/tests/fixtures/persistent-incidents.js`
- `server/tests/incidents.test.js`
- `server/tests/render-webhook.test.js`

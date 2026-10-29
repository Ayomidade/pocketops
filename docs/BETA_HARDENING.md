# Private beta hardening evidence — 2026-10-29

**Decision: NO-GO.** This is an engineering review of the current working tree, not a production security certification. No staging environment exists (confirmed by the owner). No public release, provider mutation, invitation, APK publication or real-account deletion was performed.

## Inventory and document conflicts

Implemented: native navigation; bound GitHub identity OAuth and session lifecycle; GitHub App installation/selection and live resource authorization; native repository browsing; isolated local CodeMirror editor with branch/commit/PR confirmations; Render encrypted connections, mapping, bounded logs/history and durable confirmed deployment requests; six reversible migrations; PostgreSQL queues; API/mobile tests and Android build configuration.

Not implemented: incident/timeline APIs, safe application-health checks, Expo push/device preferences, incident ingestion, automated account deletion or logout-all. Provider deployment `live` is not verified application health. These omissions block the requested complete incident recovery drill; adding them would violate this milestone's no-feature-expansion scope.

The older PRD mentions Redis/BullMQ; the latest architecture and actual services use PostgreSQL leased queues. Preserve the working implementation; Redis recovery is N/A. API documentation previously described writes as absent inside its older read-only section even though later sections and routes implement guarded writes; that sentence is corrected. Earlier unconfigured-provider notes are historical: the owner reports phone sign-in and repository visibility, but those reports do not prove Render, editor or incident staging flows.

## Security review and test map

| Boundary | Evidence reviewed | Limit |
| --- | --- | --- |
| OAuth/deep links/session replay | Auth service/PKCE, auth API and lifecycle tests; one-use handoff plus initiating-app secret; SecureStore and hashed server sessions | Real callback interception, OS process termination and multi-device logout drill NOT RUN |
| Horizontal authorization | GitHub selected-repository intersection and live access checks; deployment owner/project context; editor branch ownership; service/API tests for cross-user IDs and revoked permissions | Not a full independent penetration test; incident endpoints do not exist |
| Unauthenticated access | Added table-driven regression across installation/repository/editor/provider/project/deployment/operation entry points | Does not replace per-route cross-user/live-provider testing |
| Editor isolation | Local CSP HTML, navigation allowlist, file-access disabled, version/session/request correlation and byte limits; existing malformed/replayed-message and draft tests | Native WebView crash/OS exploit testing NOT RUN |
| Webhook/queue | HMAC raw body, normalized payloads, delivery dedupe; persistent concurrency/lease tests; no replay of uncertain deployment dispatch | Real provider delivery and staged worker termination NOT RUN |
| Logs/secrets | Allowlisted DTOs, encrypted provider records, omitted query strings, pattern redaction; added OSC/CSI/bidi sanitization tests | Arbitrary application secrets may evade redaction; ingress/crash collector settings must be audited |
| SSRF | Render adapter uses fixed HTTPS origin, rejects redirects; no arbitrary health-check URL endpoint | Health-check SSRF/DNS rebinding tests NOT RUN because feature is absent; do not claim protection for an unimplemented fetcher |
| Resource limits | API/write rate limits, one active deployment per project, bounded provider pages/response bytes, source/log caps | Distributed per-account quotas/load tests remain open; IP limits are process-local |

No credentials were printed or copied into artifacts by this review. That statement is not a historical repository/app-bundle secret-scan certification.

## Changes in this hardening pass

- Upgrade server Zod to 4.6.7 and node-forge lockfile resolution to 1.4.2; existing validation tests pass.
- CI and EAS publication now block on high/critical advisories, including failure to obtain audit data. Upload JSON report even on failure. Add Expo compatibility gate to APK workflow.
- Emit bounded HTTP timing/count events and deployment worker heartbeat/outcome/duration. Every 30 seconds, emit PostgreSQL queue counts/age and operator warnings for unknown, failed or aging work. No public metrics endpoint or automatic remediation added.
- Strip OSC, extended CSI, C1 and bidi controls from untrusted provider logs, preserving byte bounds and redaction.
- Add repeatable local synthetic restore smoke drill, regression tests, operational/release runbook, privacy draft and this evidence register.

No new migrations, HTTP endpoints, environment variables or mobile features. Existing migrations apply using `npm run db:migrate`; development-only rollback is `npm run db:migrate:undo` (production rollback is blocked). This pass does not require rollback of database schema.

## Evidence

| Check | Actual outcome |
| --- | --- |
| `npm test` after Zod upgrade | PASS: 126 server tests, one DB test skipped; 45 mobile Node and 56 UI tests |
| `DATABASE_URL_TEST=… npm test` after queue instrumentation | PASS: 128 server tests including all six migration reversals/constraints and durable concurrency fixtures; 45 mobile Node, 56 UI tests |
| `npm run lint` | PASS for server and mobile |
| `npm run api:contract:check` | PASS: generated contract current and valid |
| `expo install --check` | PASS online on retry; initial restricted run used the local dependency map |
| Android `npm run export -w mobile -- --platform android --output-dir /tmp/pocketops-beta-export` | PASS, Android JavaScript bundle; native compilation NOT RUN |
| `npm run test -w server -- tests/hardening.test.js` | PASS: all 19 added regressions after correcting disabled-module test fixtures |
| `git diff --check` | PASS |
| Online `npm audit --audit-level=high` | FAIL: 23 entries — 19 low, 3 moderate, 1 high; down from five high entries before remediation |
| Local synthetic dump/restore | PASS: backup 2026-10-29T07:33:43.101Z; verified 07:33:45.638Z; restore + verification 2264ms; one fake user, six migrations, user unique index, empty queue queries |
| Staging backup/PITR/key recovery and rollback | NOT RUN: no staging environment |
| Real Android performance/accessibility/offline and signed RC build | NOT RUN: no connected test device/build performed in this review |
| Phone-only incident recovery, health verification and push delivery | NOT RUN: staging absent and prerequisite features unimplemented |

Synthetic restore evidence is in `/tmp/pocketops-restore-GanJlT/evidence.json` on the review host, with a mode-0600 synthetic dump. Source/restore databases have unique `_test` names and remain for inspection. This tiny smoke test does not establish staging RPO/RTO, encrypted-key recovery or queue replay safety after a real disaster.

## Unresolved risks and owners

Role owners below must be assigned to named people before invitations. No high-risk exception has been accepted.

| ID | Priority / owner | Risk and closure evidence |
| --- | --- | --- |
| B01 | High / dependency maintainer | `image-size` <=2.0.2 has parser denial-of-service advisories; Metro uses its legacy path-string API. Patched 2.x changes that API. Upgrade compatible Expo/Metro or validate a narrowly scoped upstream patch; do not blindly override or suppress the gate. See [advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr). |
| B02 | Release blocker / product owner | Incident/health/push prerequisites missing; full P0 recovery workflow cannot pass. Complete separate milestone and staging drill. |
| B03 | High operational / infrastructure owner | No staging restore, verified off-host backups, dashboard/alert destination or rollback evidence. Provision isolation and prove restoration/alert delivery before beta. |
| B04 | Release blocker / privacy owner | Account deletion/support contact and retention implementation are not validated. Approve privacy notice and test deletion without resurrecting access from backups. |
| B05 | Medium / security owner | GitHub single-key rotation, revoke-all sessions and deep-link/device edge cases need staged drill; custom schemes can be claimed by another app, though completion secret binds auth handoff. |
| B06 | Medium / mobile owner | Physical-device performance, WebView lifecycle and Android/iOS native compilation evidence missing for this candidate. |
| B07 | Medium / dependency maintainer | Three moderate advisory entries trace to decode-uri-component/query-string/Expo Router; low entries largely deepmerge chains. Patched decoder changes module format; evaluate compatible upgrade, keep visible. |
| B08 | Medium / API owner | Process-local request limits and no global account queue quota/load evidence. One active request per project limits duplicate dispatch, not all abuse. |
| B09 | Medium / operations owner | Source/log redaction is best effort; ingress and collector retention/access controls need separate validation. |

## Acceptance status

| Requested beta exit criterion | Status |
| --- | --- |
| Complete timestamped phone-only staging recovery drill | FAIL — NOT RUN; missing staging and prerequisite features |
| No unresolved high/critical findings and all P0 verified | FAIL — B01/B03 and unverified gates remain |
| No duplicate deploys under idempotency/retry; revoked users denied | PASS in automated mocks and disposable PostgreSQL tests; live staging NOT RUN |
| Onboarding/time-to-failure/PR/recovery/error/notification metrics reported | FAIL — instrumentation/schema documented; no consented cohort or notification implementation |
| Actual staging restore and rollback confirmed | FAIL — local synthetic restore PASS, staging/rollback NOT RUN |
| Security review/results/risk register/runbooks/onboarding/privacy draft | PASS as repository artifacts; operator setup and policy approval outstanding |
| Signed release candidate verified | FAIL — NOT RUN |
| Explicit approval before public release | PASS as a release requirement; no release requested or performed |

Use [BETA_RUNBOOK.md](BETA_RUNBOOK.md) for environment isolation, dashboard/alert configuration, restore/rollback and opt-in 10–15 developer onboarding. Remain NO-GO until blockers close with evidence; do not label this milestone complete.

## Exact files changed by this hardening pass

Earlier uncommitted work was preserved. This pass touched only:

- `.github/workflows/ci.yml`
- `.github/workflows/eas-android.yml`
- `server/package.json`
- `package-lock.json`
- `server/eslint.config.js`
- `server/src/app.js`
- `server/src/jobs/deployment-worker.js`
- `server/src/logging/metrics.js` (new)
- `server/src/logging/queue-health.js` (new)
- `server/src/modules/deployments/logs.js`
- `server/scripts/local-restore-drill.js` (new)
- `server/tests/hardening.test.js` (new)
- `docs/API.md`
- `docs/BETA_HARDENING.md` (new)
- `docs/BETA_RUNBOOK.md` (new)
- `docs/PRIVACY.md` (new)
- `CHANGELOG.md` (new)
- `README.md`

Additional commands executed: `npm install zod@^4.6.7 -w server --ignore-scripts` and `npm update node-forge --ignore-scripts` succeeded; registry/package inspection confirmed no patched 1.x image-size release and Metro's use of a path-string input that 2.x no longer supports. Final queue-health SQL was also exercised against the isolated restored PostgreSQL database. The first unauthenticated-route test run returned six expected module-disabled 503 responses because its fixture omitted provider services; enabling test services corrected the fixture, with all 19 tests passing. No application authentication bypass was observed in that failure.

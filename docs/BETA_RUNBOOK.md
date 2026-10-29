# Private beta operations — candidate 0.1.0, 2026-10-29

Status: **NO-GO**. See [evidence and risks](BETA_HARDENING.md). Nothing here authorizes a production deployment or public launch.

## Environments and release

Use separate databases, OAuth Apps, GitHub App installations, Render keys and encryption keys for development, staging and production. Staging uses `NODE_ENV=production` to exercise validation, but its own credentials. Keep `DEPLOYMENTS_ENABLED=false` until the isolated staging mapping and approval drill are verified. Allowlist only the exact HTTPS callback and registered mobile redirect. Never copy production `.env` files into tests. Mobile receives only `EXPO_PUBLIC_API_URL`.

Before invitations, assign a named engineering owner and support contact. Prepare an internal Android preview APK from `mobile/eas.json`; record build ID, Git SHA, runtime, signing credential owner, channel and artifact checksum. Restrict EAS credentials and branch publication to trusted maintainers. Development/preview signing and OTA are configured, but this review did not produce a release candidate. iOS compilation and runtime remain NOT RUN. Push credentials cannot validate an unimplemented notification feature.

Release gates: lint, full tests with disposable PostgreSQL, OpenAPI check, online high/critical advisory gate, Expo compatibility check, Android export, native build and device checklist. A JavaScript export is not a native build. Retain CI artifacts and the candidate SHA; failed advisory retrieval also fails the gate. No exceptions are silently accepted.

## Observability and alert setup

Collect JSON stdout from the API and deployment worker into an access-controlled log service. Exclude ingress query strings, authorization headers and response bodies. Set `LOG_LEVEL=info`; higher levels hide heartbeat/metric evidence. Suggested retention is seven days, pending operator policy approval.

Implemented events:

- `http.metric`: request ID, bounded method, HTTP status and elapsed milliseconds. Dashboard request rate, 5xx ratio and p50/p95 duration; do not label metrics with request IDs.
- `job.metric`: deployment job, idle/processed/error and duration. Processed means an iteration completed, not deployment success.
- `queue.snapshot`: PostgreSQL deployment and webhook counts by status and oldest age, every 30 seconds while the deployment worker runs. Empty array means no outstanding entries; no event means monitoring is absent.
- `queue.attention`: unknown deployment outcome, deployment failure within the last 24 hours, failed webhook or outstanding age over five minutes. Never automatically replay an unknown operation.
- `queue.snapshot_failed`: queue monitor could not query PostgreSQL.

Operator must provision dashboards and notifications: alert on no worker heartbeat for 60 seconds, snapshot absence for 90 seconds, any unknown operation, three consecutive job errors, and 5xx >5% over five minutes with at least 20 requests. Probe `/ready` every 30 seconds, alert after three failures; `/health` proves only process liveness. Dashboard provider failures from safe error `code`, not raw upstream messages. These are proposed initial thresholds; test delivery and tune in staging. No external monitoring/alert destination is configured by this change. If the deployment worker is intentionally disabled, schedule a separate operator queue check for webhook backlog.

## Queue failure and independent recovery

Actual queues are leased PostgreSQL rows; Redis/BullMQ are not used. PostgreSQL backup/PITR and worker restart policies protect queue state. API processes webhook jobs; the deployment worker handles deployment jobs. Existing lease/concurrency tests cover restart after dispatch: ambiguous requests become `unknown`, blocking another request for that project. Failed webhooks are retained as terminal records; there is no separate Redis dead-letter queue. Retry limits and provider read backoff remain in the services.

On an incident: stop new deployment requests (`DEPLOYMENTS_ENABLED=false` and restart API/worker), preserve operation/audit IDs, examine provider status directly in Render and CI/PR status directly in GitHub. Do not mark a service recovered from HTTP 202 or Render `live`. PocketOps has no health verification implementation. Use an independent browser/provider login and MFA/recovery codes held outside PocketOps. Reconcile unknown operations against provider history before any new manual deployment. There is no automatic retry button for uncertain writes.

## Backups and restore drill

Initial targets: RPO <=24 hours with daily encrypted backups; RTO <=60 minutes. These are goals, not observed staging results. Use managed PostgreSQL snapshots/PITR where available, separate encrypted off-host storage and access-controlled key backups. Set retention to seven daily snapshots as a proposed initial policy. Verify retention, encryption and restore permissions before inviting users. Backup credentials must not appear in shell arguments or logs; use a restricted service file/secret injection.

An operator staging drill must:

1. Record source environment, backup time and last synthetic fixture write; take a consistent PostgreSQL dump/snapshot.
2. Restore into a **new, empty, isolated database**, never over an existing database. Deny provider egress and keep API/worker stopped to prevent replaying queued mutations.
3. Verify all six migration records, table counts, foreign keys/unique indexes, a known fixture and encrypted credential readability using staging-only keys. Do not print credentials.
4. Measure restoration plus verification time and the gap to the last recoverable write. Compare observed RPO/RTO with targets; retain encrypted evidence.
5. Before any traffic cutover, explicitly reconcile every nonterminal provider operation, rotate/revoke restored sessions as needed and obtain operator approval. Restoring a database can resurrect revoked credentials or dispatched work.

A repeatable **local synthetic** smoke drill is available:

```bash
node server/scripts/local-restore-drill.js --local-synthetic
```

It expects the development Compose PostgreSQL at `127.0.0.1:54432` in `pocketops-postgres-1`, creates uniquely named databases, applies all migrations, inserts one fake user, dumps/restores and verifies migration metadata, user uniqueness and queue queries. It never reads real `DATABASE_URL`, starts workers, drops databases or overwrites data. Dump/evidence files are mode 0600 under a private temporary directory. The two databases remain for inspection and explicit later cleanup. This is not a full backup, key-recovery or staging disaster-recovery test.

## Rollback and support

Record the previous working API/container SHA and mobile runtime/channel before staging rollout. Prefer rolling back the application to a schema-compatible version; do not run production down migrations. For mobile, return to a verified compatible OTA or reinstall the prior signed APK when native runtime changed. Test rollback on the staging candidate before recording PASS. Do not roll back a security patch to bypass a release gate.

Use a private, access-controlled support channel designated by the beta owner before invitations. Collect request/operation ID, timestamp, app version and consented redacted reproduction steps. Never request `.env`, private keys, source code or raw provider logs. Escalate suspected exposure to credential revocation and audit preservation; do not send messages to providers or testers automatically.

## Opt-in cohort and device evidence

Recruit 10–15 consenting developers with noncritical test repositories/services only. Explain the privacy/retention limitations and how to stop participation. Verify provider permissions, sign-in, installation selection and an independent recovery login. Record consent and withdraw/delete requests in the restricted support process; do not place participant identities in the repository.

For each tester, capture start/end timestamps (no secrets): onboarding completion, first failure located, successful PR, manual recovery, API errors and notification delivery where implemented. Report denominator and median time; NOT RUN is not zero. Notifications and incident recovery currently cannot be measured.

On a midrange Android device record cold-start-to-interactive, repository-list-first-content, preview/editor readiness and log first render. Exercise long names/lines, 1,000-entry directories, rotation, Android back/dirty guard, screen reader, denied permissions, background/process death, airplane mode and slow network. Capture anonymized recordings only with consent. Do not equate host React renderer timings with device performance.

Full staging journey (currently blocked): onboarding → browse → create fix branch → edit/diff/confirmed commit → PR → approved deployment → incident/health verification → manual resolution. Implement missing incident/health/notification milestone separately before claiming this journey succeeds. Public release always requires explicit user approval after all blockers close.

# Milestone 07 — incident response

Implementation and local validation: 2026-11-09. This is prompt `07-incidents.md` (the older roadmap calls it milestone 6). Live Android, FCM, Render webhook and staging recovery acceptance are **NOT RUN**. No production service was changed. See `MILESTONE_07_VALIDATION.md` for evidence.

## Implemented workflow

Native Incidents tab → report an incident against an authorized Render/GitHub project → investigate → mitigate → monitor → explicitly resolve after automated health verification. Severity is independent of status. Detail links to existing project logs/deployment history and repository/editor/PR screens. No affected file is guessed without evidence. Deployment IDs are suggested correlations, not proven causes. Timeline keeps bounded metadata and health/deployment references, never raw logs/source. Logs remain bounded on-demand reads through the existing project screen.

Legal transitions: `open → investigating`; `investigating → mitigating | monitoring`; `mitigating → investigating | monitoring`; `monitoring → investigating | resolved`; `resolved → open`. Changes require the last seen `version`; concurrent changes return `409 INCIDENT_VERSION_CONFLICT`. Resolution requires `confirmation: RESOLVE`, fresh matching health observations after incident creation and the current provider origin/live revision. There is no automatic resolution, deploy, source change or AI diagnosis.

Every resource endpoint checks the PocketOps user and current project/GitHub/Render access. Lists filter inaccessible projects. Offline/error detail screens hide health/actions; authorization failures clear related query data. Session logout clears the existing shared QueryClient. Query data is memory-only. Lists and timelines use bounded cursor pages (10 pages retained on mobile); health history has chronological cursors and a maximum page size of 50.

## Automated monitoring and detection

Monitoring is explicitly enabled per project in its native configuration screen. The existing `npm run worker:deployments` process now also processes monitor and notification leases. No Redis dependency is introduced: this preserves the established PostgreSQL queue and modular monolith, an explicit deviation from the original Redis/BullMQ diagram.

At most 20 configured projects/account; target interval 60 seconds, not an availability SLA. A monitor lease lasts 120 seconds. Each observation revalidates GitHub selection, repository permissions, Render connection and exact service mapping. Disconnected resources disable their monitor. Provider failures produce `unknown`; they never assert recovery. Persistent latest failed deployments and three consecutive unhealthy probes create one active automatic incident per project. Repeated deployment IDs are deduplicated; old deployments predating monitoring are ignored. Provider history is sorted by its timestamps; a delayed event cannot regress incident status. The latest five deployments are inspected: transient failures between polls can be missed.

Optional Render webhooks accelerate this same reconciliation. They verify Standard Webhooks HMAC over ID, timestamp and raw bytes, allow five minutes clock skew, and deduplicate event IDs transactionally with scheduling. `build_ended`, `deploy_ended`, `server_failed`, `server_available` schedule enabled monitors; no webhook payload directly grants access or declares a failure/recovery. Disabled/unmapped projects are ignored. Periodic polling remains the fallback. Render's documented protocol and plan requirements: [Render webhooks](https://render.com/docs/webhooks).

## Health verification and SSRF boundary

Only the active authorized Render **web service** `serviceDetails.url` is accepted, and only canonical HTTPS `*.onrender.com` at port 443. Custom domains, arbitrary URLs, internal services, static sites, query strings and redirects are unavailable. Path is a bounded slash/alphanumeric/underscore/hyphen path, default `/health`. Choose a lightweight **read-only** endpoint; a health GET must not mutate the application.

DNS checks all returned A/AAAA answers, rejects private/reserved/mapped addresses, then pins the vetted address into the HTTPS connection while preserving hostname/TLS verification. There is no second DNS resolution or redirect follow. DNS budget 2 seconds, HTTPS budget 3 seconds, response limit 16 KiB. No response body is saved. Use network egress rules denying internal/metadata ranges as defense in depth; restricted egress, IPv6 availability or sleeping services may return `unknown`. Pinning handles DNS rebinding for this request, not a compromised host/network.

Recovery requires the most recent **three matching healthy observations spanning 120–300 seconds**, with the last at most 180 seconds old. Origin, health path and current live deployment reference must match. A single HTTP 200, cached observation, provider `live` status or accepted operation does not verify recovery. A shallow `/health` can miss business failures: operators must define an appropriate read-only check. Network errors/timeouts/oversized bodies remain unknown. Repeated non-2xx results are unhealthy. Health history older than seven days is pruned when an active monitor runs; disabling a monitor leaves existing records for operator retention management. Configuration changes invalidate old probe history.

## Push, privacy and worker behavior

Push is opt-in and best-effort. Settings register a granted Expo push token against the current PocketOps session; re-enable on this device after signing in again. Tokens are encrypted with the provider AES-GCM key ring using a separate `push` AAD namespace. APIs return only registration IDs/platform/enabled. At most 10 enabled devices/account; tokens cannot be registered to another account without removing the old registration. Logout/session expiry, revoked project access and disabled preferences prevent subsequent dispatch. Already handed-off notifications cannot be recalled; they contain only generic wording and incident/event IDs, never incident titles, log lines or source.

Incident event + audit + notification outbox are transactional. Pending work is leased for 60 seconds; explicit throttling retries at most five attempts with bounded backoff. Ambiguous dispatch or expired `sending` lease becomes `unknown` and is not blindly resent. Expo receipts are checked every 15 minutes up to the attempt cap; `delivered` means provider handoff, never that a person saw an alert. DeviceNotRegistered revokes and erases ciphertext. App foreground refresh and authenticated deep links are authoritative; notification data is only a UUID navigation hint. Device permission denial leaves registration disabled. A killed app's tap is reconciled after login; actual OS delivery still requires device testing. [Expo delivery and receipts](https://docs.expo.dev/push-notifications/sending-notifications/).

Incident/event/audit/dedup/outbox records have no automatic general purge. Preserve dedup history while old events can replay. Account deletion/long-term retention remains an operator process from `PRIVACY.md`. Provider key retirement must re-register push devices (or migrate their ciphertext) before removing old key versions. Never log webhook bodies, device tokens, authorization headers or notification credentials.

## Setup and migration

1. Back up the intended database; run `npm run db:migrate`. `007-create-incidents.js` adds incidents, events, monitors, health checks, observations, notification preferences, devices and deliveries, with ownership FKs, uniqueness and queue/history indexes. No sync is used.
2. Start API and worker using the same database/provider encryption/GitHub configuration: `npm run api` and `npm run worker:deployments`. `DEPLOYMENTS_ENABLED` controls deployment mutations, not monitoring. Verify `/health` and `/ready`.
3. Connect GitHub and Render; map a noncritical web service; give it a suitable `/health` endpoint. Enable monitoring in the project screen. Wait for three observations and inspect both provider lifecycle and application health separately.
4. Optional backend `EXPO_PUSH_ACCESS_TOKEN`: needed when enhanced Expo push security is enabled. Keep it server-only. Existing `PROVIDER_ENCRYPTION_KEYS` and `PROVIDER_ACTIVE_KEY_VERSION` also protect push registrations.
5. For optional Render webhooks, set backend `RENDER_WEBHOOK_SECRET` to the provider's `whsec_…` signing secret, configure HTTPS `/api/v1/webhooks/render` and the four supported events. Without this setting, polling works and the webhook route returns 503. No Render webhook subscription is created automatically.
6. Configure Firebase for Android package `com.pocketops.mobile`, upload FCM v1 service-account credentials through EAS credentials, and set `GOOGLE_SERVICES_JSON` as an EAS preview **file** environment variable containing the Firebase Android client configuration. The build hook validates its package and copies it to ignored `mobile/android/app/google-services.json`. Do not use `EXPO_PUBLIC_*` for server keys or a service-account key. `EXPO_PUBLIC_API_URL` remains the public HTTPS API base URL only. Follow [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).
7. Build/install a **new Android APK** from `mobile/` with `npx eas-cli@latest build --platform android --profile preview`. Native notification code and runtime `0.1.0-incidents.1` cannot be delivered to the old runtime by OTA. No EAS build was triggered by this task. Enable notifications in the installed app. iOS APNs/build/device acceptance is pending.

Rollback: stop API/worker processes using incident tables, preserve needed evidence, then `npm run db:migrate:undo` **only when 007 is the latest applied migration**. It drops milestone-07 tables/index; restore the previous compatible app/server release. This removes incident data and must not be used on a real environment without review. Up/down was exercised only in a disposable test database.

## Phone-only staging drill (NOT RUN)

Prerequisites: dedicated test repo, noncritical Render service, configured API/worker, new APK and FCM credentials. The user previously confirmed no isolated staging environment exists; provisioning is external work.

1. Sign in, select the dedicated repository, connect/map the test service, enable monitoring and notifications; verify healthy observations.
2. With explicit staging approval, make the health endpoint return a non-2xx response. Wait for repeated checks; verify one automatic incident and a generic notification. Refresh in app if no push arrives.
3. Open timeline and logs, set investigating then mitigating. Browse repository → edit a test file → new fix branch → native diff confirmation → commit → PR. Confirm no write before confirmation and expected-SHA conflict protection.
4. Follow ordinary CI/review/merge approval. The existing redeploy action redeploys the currently live revision; it does **not** deploy an arbitrary PR. Use the approved Render auto-deploy/normal GitHub merge flow for a new fix revision, then inspect deployment history on the phone. Test the confirmed redeploy action separately only on the noncritical service.
5. Set monitoring. Verify deployment `live` alone cannot resolve; wait for three fresh health observations matching that live revision. Explicitly resolve; inspect actor/time/version audit and timeline.
6. Repeat notifications disabled/permission denied, app backgrounded/killed, airplane mode/resume, revoked GitHub/Render access, repeated/out-of-order events, worker restart and failed push receipt cases. Record timestamps and screenshots without secrets.
7. On Android check touch targets, TalkBack labels, long titles, list pagination, back gesture, keyboard, configured dark styling and orientation behavior (app currently locks portrait). Measure list/preview/log response on a real midrange device; no performance SLA is claimed.

No autonomous remediation, remote execution, additional provider, team assignment/escalation or observability platform is included.

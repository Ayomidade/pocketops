# Operations and release validation

These procedures support the current identity/read-only GitHub milestone.
Deployment actions, Redis workers and remote execution are not available.
Production release still requires an owner to execute and record the gates below.

## Monitoring

Configure your hosting monitor to poll `/health` for process liveness and `/ready`
for PostgreSQL readiness. Alert on repeated readiness failures, API 5xx/429 rates,
authentication failures and webhook processing/cleanup errors. Ingress access logs
must omit OAuth query strings and authorization headers. Do not log webhook bodies.
Alert thresholds and recipients must be selected in the actual hosting account;
adding this document does not provision a monitoring service.

Use a restricted read-only PostgreSQL monitoring role to inspect the durable queue:

```sql
SELECT status, count(*), min(received_at) AS oldest_received
FROM webhook_deliveries GROUP BY status;
SELECT count(*) AS expired_claims FROM webhook_deliveries
WHERE status = 'processing' AND claim_expires_at < now();
```

Investigate failed deliveries and prolonged pending work. The API process drains
this queue, so a live HTTP server alone does not prove processing is healthy.
Do not reset deliveries blindly: inspect upstream access and use the supported
GitHub reconnect/reconciliation flow.

## Retention

Existing cleanup runs every six hours: OAuth transactions older than expiry plus
24 hours, sessions expired/revoked for over 30 days, expired GitHub links after
24 hours, and processed/failed/ignored webhook deliveries after 30 days.
Authentication audit records are retained; define legal/privacy retention and an
approved deletion procedure before production. Failed deliveries are eventually
deleted, so alerts and incident capture must happen within that retention window.

## Backup and restore drill

Use managed PostgreSQL encrypted backups/PITR where available. Store database
backups and the token-encryption key in separate restricted stores. Do not commit
either. Define recovery point/time objectives with the operator before release.

For a manual drill, use PostgreSQL 16+ client tools, named services in a protected
`.pg_service.conf` and passwords in `.pgpass` or a secret manager. The service
names below must be configured first; no password belongs in a command argument:

```bash
umask 077
pg_dump --dbname="service=pocketops-backup" --format=custom --file=/secure/backups/pocketops.dump
# Restore only into a new, isolated database with no provider connectivity.
pg_restore --no-owner --no-acl --dbname="service=pocketops-restore" /secure/backups/pocketops.dump
```

Use an encrypted restricted backup destination; `/secure/backups` is an example
path to provision, not a folder created by the application. Keep the restore API
offline and block egress so copied sessions/tokens and queued webhooks cannot act
against real provider accounts. Verify migration metadata, row counts and FK
integrity, then run readiness against the isolated DB. Record restore duration,
backup age, checks and deletion of the isolated copy. Do not run migration rollback
against production as a backup test.

## Credential rotation

Rotate OAuth client secrets, GitHub App private keys and webhook secrets through
their respective GitHub settings and your server secret manager. Deploy consistent
settings across API instances, test with disposable repositories, and revoke old
provider credentials only after verifying the replacement. Webhook secret changes
need a coordinated maintenance window because the API accepts one secret at a time.

The current encrypted token format uses one key and has no key identifier or
online re-encryption tool. A safe supported replacement is a planned reconnect:

1. Announce a GitHub connection maintenance window and stop all API instances.
2. Take and verify an encrypted database backup; retain the matching old key in
   the restricted recovery store. Do not place either key in logs or mobile config.
3. Generate a fresh 32-byte key directly into the server secret manager.
4. With an approved operator procedure, revoke existing installation memberships
   and remove pending GitHub installation links in a database transaction. Record
   an audit event; preserve user identities, sessions and repository metadata.
5. Deploy the new key consistently, start the API, and have users reconnect the
   GitHub App and reselect repositories. The flow overwrites membership credentials.
6. Verify read access and revocation using a test account. Retain old backups and
   their key only for the defined recovery period, then dispose of both securely.

Step 4 is an operator-approved maintenance mutation, not an automated command in
this repository. Seamless key rotation with concurrent old/new keys remains a
separate hardening implementation; do not replace the key and expect existing
ciphertext to decrypt. In a compromise, revoke affected credentials immediately.

## Native and provider acceptance

Enable USB debugging on a physical Android phone, connect a data cable, accept the
host fingerprint, and check `adb devices` shows `device`. Run `npm run android`
with the correct Android SDK configured. Use your computer's reachable LAN IP in
`EXPO_PUBLIC_API_URL`; a phone's `localhost` refers to the phone.

Record these checks on the actual device: NativeWind colors/layout, all five tabs,
screen-reader labels, airplane mode, reconnect, background/resume, expired session,
sign-in cancellation, logout and rejection of a revoked session. Protected tabs
require real sign-in; do not add an authentication bypass for validation.

Configure both GitHub applications using `SETUP.md`, server-only credentials and
a reachable HTTPS callback. Use a noncritical account/repository. Record successful
identity sign-in, installation, repository selection, signed webhook delivery,
duplicate delivery handling, repository removal and authorization revocation.
Keep codes/tokens and raw webhook bodies out of evidence. A mocked provider test
does not satisfy this gate.

The manually triggered `Native build validation` GitHub Actions workflow builds
an Android x86_64 debug APK and an unsigned iOS simulator app. It is not a release
signing workflow or a physical-device test. Its iOS job needs a macOS runner;
local Linux cannot validate Xcode compilation. Record the workflow result before
claiming either native build gate passed.

## Release evidence

Run `npm ci`, `npm test` with a disposable `DATABASE_URL_TEST`, `npm run lint`,
`npm run api:contract:check`, Expo compatibility checks and native builds. Review
the uploaded online advisory report, including unresolved transitive findings.
CI reports advisories without claiming a clean release gate. Reject a production
release until security review, live authorization/revocation checks, device tests,
backup restore and monitoring alerts have recorded evidence and an accountable owner.

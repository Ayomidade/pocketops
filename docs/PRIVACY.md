# Private beta data handling — draft, not an approved public policy

Before invitations, the beta owner must supply the operator identity/contact, jurisdiction-specific policy review and a working deletion/support process. No public release or compliance certification is implied.

| Data | Current handling | Retention/deletion limitation |
| --- | --- | --- |
| GitHub identity/profile and repository selections | PostgreSQL; used for identity and resource authorization | No account deletion endpoint; operator procedure must be verified before beta |
| PocketOps sessions | Hashes server-side; token in mobile SecureStore | 30-day expiry; logout revokes current session; no logout-all endpoint |
| GitHub credentials | Authenticated encryption server-side | Single encryption key; rotation/reconnection runbook needs staging verification |
| Render credentials | Versioned authenticated encryption, owner-bound | Disconnect erases stored ciphertext; external key revocation remains user's/provider's responsibility |
| Source content | Memory for browsing; local editor only; optional encrypted limited drafts | Drafts expire after 24h, max five files; logout/background lifecycle tests do not replace device verification |
| Provider logs | Bounded on-demand responses, common-secret redaction | Arbitrary secrets may evade pattern redaction; no wholesale log database ingestion |
| Audit/operation records and deployment metadata | PostgreSQL for security/idempotency | No automated general purge; deleting idempotency history can permit replay, so operator policy needed |
| OAuth/link workflows | Hashes, short-lived workflow records | Existing periodic cleanup removes expired workflows; see SECURITY.md |
| Notifications and push tokens | Not implemented | No push delivery/collection claimed |
| Operational request/job logs | Structured metadata and correlation IDs | Seven-day retention is a proposed operator setting, not automatically enforced |
| Backups | Must be encrypted with restricted access | Seven daily snapshots proposed; actual staging retention not configured |

Do not place private source, raw logs or credentials in feedback/screenshots. No analytics SDK or crash-report service is introduced here. Operational hosting and provider services have their own access and retention controls.

Withdrawal procedure to validate: authenticate the request through the existing account/support relationship; revoke sessions, disconnect provider credentials, remove memberships/selections and personal profile according to foreign-key dependencies; preserve only legally justified security evidence with a documented basis. Record completion without secrets. Backups age out under approved retention and must not reintroduce deleted/revoked access after restore. Until the procedure is implemented/tested, do not promise immediate or automated account deletion.

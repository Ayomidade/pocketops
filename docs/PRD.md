# PocketOps — Product Requirements Document (PRD)

**Version:** 1.1 | **Status:** Approved direction; implementation specification | **Platform:** Android-first native mobile, iOS-compatible | **Release:** Progressive MVP

> **Status legend:** **Decided** = agreed in product discussion; **Proposed** = recommended implementation requiring confirmation; **Deferred** = explicitly out of MVP. This document is the product contract, not a claim that the scaffold already implements the features.

## 1. Executive summary

PocketOps is a native mobile developer operations application for developers who must respond to deployment failures while away from their laptops. It connects an authorized GitHub repository with a deployed service, makes logs and release history accessible, provides a mobile-optimized source editor, and supports safe, auditable recovery actions. **The MVP does not execute untrusted repository code.** A full cloud workspace is the post-MVP direction.

**Core promise:** investigate a production problem, make a focused change, submit it for normal review and CI, initiate permitted deployment actions, and verify recovery using only a smartphone.

**Decided:** React Native + Expo, JavaScript, NativeWind/Tailwind, Expo Router; native navigation, dashboards, notifications and deployment controls; CodeMirror 6 embedded in a narrowly scoped WebView for source editing. Backend: Node.js/Express, PostgreSQL/Sequelize, GitHub App, Render first, Redis/BullMQ for background processing. Single monorepo.

## 2. Problem and opportunity

A production service can fail when the developer is on holiday, commuting or without their work computer. Existing tools split the workflow among repository hosting, deployment consoles, logs, CI and terminals; many are cumbersome on a small touchscreen. PocketOps is not primarily another generic mobile IDE: it is an **incident-to-code-to-recovery workflow** designed around limited time, limited typing, unreliable networks and production safety.

### Jobs to be done

1. When an application fails, I need to see which service and release are affected.
2. I need readable, bounded production logs and relevant source files on my phone.
3. I need to make a small, reversible edit without overwriting someone else's work.
4. I need to submit the fix through branch/PR/CI rules rather than bypassing protections.
5. I need to know whether the deployment was accepted, finished, and actually restored health.
6. I need a reliable fallback if PocketOps itself is unavailable.

### Primary personas

- **Solo backend/fullstack developer:** maintains a few APIs on Render; needs emergency fixes on Android.
- **Freelancer:** responsible for client sites while away from laptop; needs per-project separation.
- **Indie hacker:** small team or one person, limited infrastructure budget, values rapid recovery.
- **Future persona (deferred):** engineering teams with organizations, approval policies and RBAC.

## 3. Product principles

- **Native first:** screens, navigation, alerts and operations are native. WebView is limited to the editor.
- **Recovery first:** expose safe mitigations before requiring code edits.
- **Least privilege:** installation-scoped GitHub access and isolated provider credentials.
- **Never imply success early:** accepted operation ≠ successful deployment ≠ verified recovery.
- **Preserve existing workflows:** PRs, branch protection, CI checks and provider access policies still apply.
- **Safe under mobile conditions:** retryable reads, explicit confirmation for writes, conflict detection and draft protection.
- **Transparent limitations:** no shell, runtime execution or AI auto-fixes in MVP.

## 4. Scope and priorities

| Priority | Feature               | Detailed expected behavior                                                                      |
| -------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| P0       | GitHub login          | System-browser OAuth, state/PKCE as applicable, backend code exchange, mobile session lifecycle |
| P0       | GitHub App connection | User selects repositories; app records installation and rechecks access                         |
| P0       | Repository explorer   | Browse branches, directories, text files; loading, empty and permission states                  |
| P0       | Editor                | CodeMirror WebView, syntax highlighting, line numbers, dirty state, diff and save               |
| P0       | Git workflow          | New branch from known base; SHA-checked commit; PR creation; CI status link                     |
| P0       | Render connection     | Secure backend-only credential handling; connect and validate services                          |
| P0       | Deployment history    | Provider statuses normalized; recent releases and timestamps                                    |
| P0       | Logs                  | Time-bounded, paginated, redacted, readable on mobile                                           |
| P0       | Redeploy              | Permission checks, confirmation, idempotency, operation tracking                                |
| P0       | Audit                 | Record sensitive operations without storing secrets                                             |
| P1       | Incidents             | Create/update/resolve, severity, timeline and deployment links                                  |
| P1       | Webhook events        | Verified event ingestion, deduplication, async reconciliation                                   |
| P1       | Push notifications    | Token registration, preferences, alert delivery, in-app fallback                                |
| P1       | Health checks         | Approved target, bounded request, explicit verification status                                  |
| Deferred | Cloud terminal        | No command execution or remote shell in MVP                                                     |
| Deferred | AI fixes              | No automated patch generation/production action                                                 |
| Deferred | Teams/billing         | No multi-user organization permissions or subscription system                                   |
| Deferred | Other providers       | Vercel, GitLab, Bitbucket after Render/GitHub validation                                        |

## 5. User journeys

### Journey A — First-run onboarding

1. Open PocketOps, see value proposition and permission explanation.
2. Sign in with GitHub through a system browser, not an embedded login WebView.
3. Install/configure the GitHub App for explicitly selected repositories.
4. Return via validated deep link and sync accessible repositories.
5. Add a Render provider connection using the supported provider credential flow; display scope and revocation instructions.
6. Map one repository to one Render service; confirm mapping and project identity.
7. Arrive at a project dashboard showing status, last deployment and actions.

**Acceptance:** an unauthorized repo never appears; expired connection yields actionable reconnect state; missing Render credentials never block GitHub-only browsing.

### Journey B — Emergency source fix

1. Open incident or deployment failure; inspect logs and release SHA.
2. Navigate to repository and correct branch; browse to relevant file.
3. Create a fix branch (default) and open file with revision SHA.
4. Edit, preview diff, enter commit message and confirm.
5. If SHA changed, show `409` and offer refresh/manual reconciliation; never overwrite silently.
6. Commit and open PR against intended base; show PR URL and CI status.
7. Observe downstream deployment only when provider/repo workflow actually triggers it.

**Acceptance:** full path works on a physical Android device; all sensitive mutations audited; PR respects branch protection.

### Journey C — Redeploy / recovery

1. Select mapped service; inspect last deployments and logs.
2. Choose a provider-supported recovery operation; show exact target and risks.
3. Confirm explicitly; submit with idempotency key.
4. UI shows `queued`, `in_progress`, `succeeded`, `failed` separately from health state.
5. Verify approved production health endpoint and record result; user resolves incident only with explicit decision.

**Acceptance:** duplicate requests cannot trigger multiple deployments; provider API acceptance is never labeled recovered.

### Journey D — Disconnected phone

A developer edits a text file, loses connectivity, and returns later. Keep a local draft (with explicit privacy considerations) and mark it unsynced; upon reconnection refetch SHA and require conflict resolution before commit. Never silently replay production operations.

## 6. Native mobile information architecture

**Tabs:** Dashboard, Repositories, Deployments, Incidents, Settings. **Nested screens:** Project details, Repository tree, File preview/editor, Diff/Commit, Pull request, Deployment detail/logs, Incident timeline, Connections, Notification preferences. Use Expo Router route groups for authentication and tabs; deep links to project/incident require authorization after navigation.

**UX states required for every remote screen:** initial loading, refreshing, empty, offline, expired authorization, permission denied, rate-limited, upstream outage and retry. Use large touch targets, keyboard-aware editor layouts, accessible contrast, screen-reader labels and a one-handed action hierarchy. Avoid making destructive actions prominent.

### Editor design

CodeMirror 6 runs in a WebView only for editing. Native UI owns repository/branch selection, diff review, commit confirmation and PR creation. Define an allowlisted JSON message bridge with typed message names, message size limits and a nonce/session ID. Do not load arbitrary remote HTML into the editor WebView; use packaged editor assets. Restrict navigation and external links.

## 7. Functional requirements and IDs

| ID        | Requirement                                  | Priority | Verification                           |
| --------- | -------------------------------------------- | -------- | -------------------------------------- |
| AUTH-01   | GitHub OAuth login and logout                | P0       | Valid/invalid callback and token tests |
| AUTH-02   | Revocable PocketOps mobile sessions          | P0       | Revoked token rejected                 |
| REPO-01   | List only currently authorized repos         | P0       | Cross-user denial                      |
| REPO-02   | Tree/file browsing with branch ref           | P0       | Nested paths and missing file          |
| EDIT-01   | Text editing, draft, diff                    | P0       | Editor integration test                |
| EDIT-02   | SHA-guarded commit                           | P0       | Stale revision returns 409             |
| GIT-01    | Create branch and PR                         | P0       | Test GitHub repo                       |
| DEP-01    | Render connection and service mapping        | P0       | Invalid/revoked credential cases       |
| DEP-02    | Deployment list and logs                     | P0       | Provider adapter contract tests        |
| DEP-03    | Confirmed idempotent redeploy                | P0       | Same key creates one operation         |
| AUD-01    | Immutable audit record for sensitive actions | P0       | Query audit record                     |
| INC-01    | Incident lifecycle and timeline              | P1       | State transition tests                 |
| ALERT-01  | Push/in-app event delivery                   | P1       | Device token invalidation              |
| HEALTH-01 | Health verification independent of deploy    | P1       | Unhealthy after success case           |

## 8. Nonfunctional requirements

**Security:** OWASP-aligned validation, object-level authorization, encrypted credentials, secrets absent from app bundle, protected webhooks, controlled WebView. **Reliability:** bounded timeouts/retries, durable idempotency, webhook reconciliation, queue recovery. **Performance targets (proposed, to validate):** typical file opens in <=10 seconds on representative network; onboarding to connected repo in <=5 minutes; API p95 <500 ms excluding upstream fetches; bounded log queries. **Accessibility:** scalable text and accessible control labels. **Privacy:** minimum stored code/log content, documented retention. **Observability:** request IDs, structured logs, queue and provider failure alerts.

## 9. Success and validation

**North-star:** percentage of real or simulated incidents resolved phone-only with verified recovery. Track time to first useful log, time to first code view, percentage of successful SHA-checked commits, PR completion, deployment action failure rate, median incident resolution time and user return rate. Pilot with 10–15 developers; run at least three realistic drills: broken deployment, runtime 500, and expired provider credentials. Targets are hypotheses, not current performance.

## 10. Dependencies and risks

- GitHub App approval/permissions, OAuth configuration, webhook delivery and rate limits.
- Render API capabilities and account-specific availability of logs/deployment operations.
- Expo/NativeWind/React Native version compatibility and device build requirements.
- Mobile editor keyboard ergonomics and WebView bridge security.
- Provider secrets, cross-user authorization and production-operation safety.
- Cloud compute economics in future terminal phase.

**Mitigation:** start with one GitHub test repo and one noncritical Render service; keep provider adapter contracts small; use feature flags; stage all deployment tests.

## 11. Release gates and explicit exclusions

**Beta gate:** signed-in developer connects a repo, edits a file on new branch, commits, opens PR, inspects Render logs, triggers one authorized redeploy and observes health outcome on physical Android. Pass authorization, idempotency, secret-leak and interruption tests. **Not promised:** arbitrary debugging shell, automatic fixes, instant push delivery, universal rollback, cross-provider parity or production-grade multi-tenancy.

## 12. Open decisions

1. Exact Render credential acquisition and scope model (verify against provider docs during implementation).
2. Whether push notifications ship in beta or first post-beta increment.
3. Maximum editable file size and local draft retention policy.
4. Which CI status surfaces are exposed first.
5. Product branding/name remains working title.

**Related documents:** [Architecture](ARCHITECTURE.md), [Database](DATABASE.md), [API](API.md), [Security](SECURITY.md), [Development plan](DEVELOPMENT_PLAN.md), [Setup](SETUP.md).

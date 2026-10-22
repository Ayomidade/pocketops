# PocketOps — Implementation Roadmap and Engineering Plan

**Version:** 1.1 | **Method:** Progressive MVP | **Delivery:** Solo-developer-friendly | **Estimates:** Planning hypotheses, not guarantees

## 1. Strategy

Build a runnable, testable native mobile app and backend first. Add GitHub identity/repository integration, then editor/PR, then Render deployment operations, then incidents and notifications. Cloud execution comes only after a successful mobile-only recovery pilot. One milestone per Codex task; review code and tests before merging.

## 2. Workstreams

- **Mobile:** Expo Router navigation, NativeWind, secure session, repository tree, CodeMirror WebView, native incident/deployment screens.
- **API:** Express modules, validation, authorization, provider adapters, audit and operation orchestration.
- **Data:** PostgreSQL migrations, constraints, session and operation models.
- **Infrastructure:** CI, worker, Redis, staging, secrets, monitoring and backups.
- **Product validation:** usability testing and incident recovery drills on Android.

## 3. Milestones and exit gates

### Milestone 0 — Foundation and database baseline

**Tasks:** install root workspace dependencies; verify Expo/React Native/NativeWind compatibility; boot mobile on physical Android; boot Express; add liveness/readiness checks, request correlation and safe structured errors; add reversible users/sessions schema-only migrations; run tests/lint; confirm no secrets in repo; document deviations. **Exit:** repeatable install/launch, disposable-PostgreSQL migration up/down, CI green. Do not claim the device gate has passed until verified locally.

### Milestone 1 — Identity and session workflows (weeks 1–2)

**Backend:** OAuth state schema; GitHub OAuth initiation/callback; one-use mobile handoff; session issuance/revocation using the foundation sessions table; auth middleware; auth tests. **Mobile:** login/logout, system-browser auth session, deep links, SecureStore, protected route groups. **Security:** state, PKCE only if the provider documents support, expired/replayed callback tests, no provider token on device. **Exit:** sign in and out on physical device; revoked session rejected.

**Implementation status (2026-10):** backend identity/session endpoints, migrations, audit events, native system-browser flow, SecureStore session hydration/rotation/logout, and automated tests are implemented. GitHub's published OAuth App authorization parameters do not document PKCE, so this flow uses a confidential backend client, state validation and a separate mobile completion-secret binding. GitHub App installation and repository access remain separate Milestone 2 work. The physical Android sign-in/logout exit gate still requires a configured OAuth App, reachable HTTPS callback and development build; it is not claimed passed by automated tests or JS export.

### Milestone 2 — GitHub App connection and read-only APIs (weeks 3–4)

**Backend:** App installation/user authorization handoff, webhook verification, Octokit adapter, installation/repository reconciliation, selected-repository/tree/file/branch read APIs; pagination, rate limits and live permission checks. **Mobile:** connection status and explicit repository selection; reusable read-only API service. Native repository browsing is Milestone 3.

**Implementation status (2026-10; prompt `03-github-integration.md`):** server-side GitHub App authorization and encrypted expiring user tokens, per-user installation membership and repository selection, raw-body signed webhook handling with durable PostgreSQL delivery processing, read-only repository APIs and native connection/selection UX are implemented with mocked-provider tests. The GitHub App is not configured in this environment; live GitHub/App setup and physical-device verification are NOT RUN. Repository browsing, branch selection and file preview remain deferred.

### Milestone 3 — Native repository explorer (weeks 4–5)

**Mobile:** selected repository list, native tree navigation, branch selection and text preview; loading/empty/offline/error/retry states and accessibility. Consume the existing read-only API and do not add repository writes. **Exit:** selected test repository browsable on Android and access revocation promptly reflected.

### Milestone 4 — Code editor and Git workflow (weeks 5–6)

**Backend:** branch creation, SHA-checked single-file commits, PR creation, audit events, conflict response. **Mobile:** packaged CodeMirror WebView, safe bridge, unsaved draft, diff screen, commit confirmation, PR details. **Exit:** phone-only fix branch → edit → commit → PR on test repo; stale SHA yields 409; no direct production-branch write by default.

### Milestone 5 — Render connections and deployments (weeks 6–7)

**Backend:** encrypted credential store, provider adapter, service mapping, deployment/log APIs, idempotent operation table, worker queue and reconciliation. **Mobile:** connection setup, project mapping, deployment list, log viewer, confirmation UI and operation progress. **Exit:** authorized developer can inspect logs and request exactly one test redeploy; duplicate request does not duplicate upstream action.

### Milestone 6 — Incident workflow and alerts (weeks 8–9)

**Backend:** incidents, timeline, event correlation, verified webhooks where supported, approved health checks, push token registration/preferences. **Mobile:** native incident list/detail, project context, notification deep links, resolution controls. **Exit:** simulated failure creates actionable incident; deploy success is separate from verified health; notification fallback works.

### Milestone 7 — Hardening and private beta (weeks 10–12+)

**Tasks:** full authorization regression, threat model review, offline/reconnect tests, background job failure drills, monitoring, backup/restore, staging rollout, device performance, accessibility, 10–15 developer pilot. **Exit:** complete phone-only recovery demonstration and documented operational runbook.

## 4. Dependencies and sequencing

`M0 → M1 → M2 → M3 → M4`; `M1 → M5`; `M4 + M5 → M6`; `M1–M6 → M7`. Do not block all backend work on editor UI, but freeze API contracts before implementing both sides. Integrate with a noncritical test repo and Render service until security gates pass.

## 5. Codex development protocol

1. Read `AGENTS.md` and the relevant docs before changes.
2. Select one milestone and create a short plan with acceptance criteria.
3. Implement a vertical slice (API + migration + mobile screen + tests where applicable).
4. Run format/lint/test and device verification; never claim checks that did not run.
5. Produce a change summary, migrations, security impact, manual steps and known gaps.
6. Request review before proceeding to the next milestone.

**Suggested prompt order:** `prompts/01-foundation.md`, `02-authentication.md`, `03-github-integration.md`, `04-repository-explorer.md`, `05-code-editor.md`, `06-deployments.md`, `07-incidents.md`, `08-beta-hardening.md`. Each prompt implements one milestone and cites the detailed specification sections.

## 6. Definition of done

- Feature works on a real Android device and staging API (where relevant).
- Validation, authorization and failure states implemented.
- Tests include success, denied access, stale state and provider failure.
- API schema/docs updated; migration up/down tested.
- No secrets in logs or client bundle.
- Telemetry/audit added for sensitive actions.
- Code reviewed and commands/results recorded.

## 7. Suggested iteration board

| Sprint | User-visible outcome    | Core deliverable                 |
| ------ | ----------------------- | -------------------------------- |
| 0      | App opens; API responds | Baseline validation              |
| 1      | GitHub login            | Sessions and OAuth               |
| 2      | Connected repos         | GitHub App and read APIs         |
| 3      | Browse selected repos   | Native repository explorer       |
| 4      | Mobile fix PR           | Editor and Git writes            |
| 5      | Deploy overview         | Render integration               |
| 6      | Emergency workflow      | Incidents, notifications, health |
| 7      | Pilot-ready app         | Security and recovery drills     |

## 8. Risks and contingency

**Expo compatibility:** lock compatible SDK/NativeWind versions and test dev builds early. **OAuth mobile deep links:** prototype before full auth module. **GitHub permissions:** test repo removal and organization installations. **Render API:** confirm current capabilities before promising rollback or log streaming. **Worker idempotency:** persist operation state before invoking provider. **Editor ergonomics:** test long files and soft keyboard on physical Android. **Budget:** cap logs, API calls, queue retention and future compute.

## 9. Release rollout

Use feature flags and staged access. Begin with internal test accounts, then a handful of trusted developers, then 10–15 pilot users. Publish explicit beta limitations and a privacy/security disclosure. Do not invite production access before credential encryption, authorization, audit and recovery paths are verified.

## 10. After MVP

**Phase 2:** Vercel adapter, richer diff/multi-file changes, better CI visibility. **Phase 3:** isolated cloud workspaces and terminal with resource limits, egress controls and secure teardown. **Phase 4:** optional AI-assisted diagnosis with human-approved patches. Reassess based on pilot evidence rather than feature ambition.

## 11. Weekly review template

Record: milestone, shipped functionality, automated checks, physical-device checks, known bugs, security blockers, upstream API issues, decisions and next week's acceptance criteria. Treat the roadmap as adaptive rather than a fixed deadline promise.

# Native repository explorer — milestone report

Date: 2026-10-23. Branch: `feat/native-repository-explorer`. Scope: the native
read-only explorer after prompt 03; no editor or repository writes.

## Inventory, decisions and assumptions

Read `AGENTS.md`, README, PRD, architecture, database, API, security, setup and
roadmap; inspected dependencies, four migrations, existing tests and commits
`3be7865`, `ce07b8a`, `4cfe7fb`. The two recent commits establish identity,
installation/selection, signed webhooks and read-only repository APIs. Mobile
repository browsing was a placeholder. Existing uncommitted hardening changes
and the generated Android project were preserved.

The API document includes future write/deployment examples; only its implemented
sections 2–4 are used. Redis/Render/editor descriptions in architecture are target
architecture, not functioning integrations. Roadmap numbering starts at zero:
this is roadmap Milestone 3 / prompt `04-repository-explorer.md`. The handoff is
prompt `05-code-editor.md` / roadmap Milestone 4. No numbering change authorizes
editor implementation in this task.

The previous directory implementation assumed Contents API pagination that GitHub
does not document. The safer implementation returns one bounded directory, never
recursively fetches a repository, and warns at the 1,000-entry provider limit.
Supplying a directory cursor now returns 422 instead of pretending pagination works.
Repository and branch pagination remain supported.

## Implemented behavior

- Selected repositories, connected-account summary and debounced backend search
  (350 ms; 100 characters). Repository pages contain 30 records; at most ten pages
  are retained/requested for a search. Branches use the existing 100-item API pages,
  up to ten pages. Use a narrower search when a repository result exceeds this limit.
- Native stacks/tabs, safe-area layout, virtualized lists, accessible controls,
  connection/selection empty states, skeletons, refresh/retry, offline/stale notices,
  rate-limit and provider-error explanations. Existing tabs remain intact.
- One directory at a time; breadcrumbs, parent action and Android hardware back.
  Repository ID, ref and path live in route parameters. Branch selection resets
  the directory to root, warns that contents may differ, and changes the requested
  ref. No previous-data placeholder is reused across query keys.
- Native selectable monospace text preview with line numbers, byte size, path,
  encoding, backend editability and blob SHA. Blob SHA is revision metadata, not a
  last-commit timestamp. Rendering stops at 5,000 lines and 2,000 characters per
  line, with explicit truncation notices. No HTML executes and no WebView is used.
- Binary, unsupported, missing and oversized files have explicit explanations.
  Submodules/unsupported links are not opened. No editing, save, commit or terminal
  control is present.
- Fixed a mobile integration bug: `URLSearchParams.size` is not available in every
  React Native polyfill. Query suffixes now use `toString()` so search/branch-list
  cursors reach the API. Abort signals propagate without becoming query parameters.
- Centralized PocketOps `UNAUTHENTICATED` 401 handling expires the mobile session.
  Provider `GITHUB_AUTH_REVOKED` does not erase an otherwise valid PocketOps identity.
  A late response using an old session cannot expire a replacement session.
- Backend preview validation rejects missing/unsupported base64 encoding as text,
  oversized encoded payloads, and inconsistent decoded size. Minimal read-only
  changes preserve controller/service/adapter boundaries and `/health`.

## Cache and permission policy

TanStack Query is the server-state owner. Zustand is unnecessary: route parameters,
component state and Query cover the actual state requirements.

All repository data is memory-only; no AsyncStorage, persistence plugin or source
files are written to disk. Query clients and their mounted observers are isolated
by PocketOps session ID and destroyed/cancelled on session change/logout.
Metadata becomes stale immediately, is revalidated on mount/screen focus, app
resume and reconnect, and is collected two minutes after its last observer leaves.
Cached metadata is labelled with last-check/staleness and cannot open a repository
while offline or while revalidation fails/is running.

Source queries have zero inactive retention: preview blur/unmount or app background
unmounts the source view, aborts pending reads and removes cached source. Returning
requires another authorized read. The active visible preview retains its current
text in memory; it is not an offline source store. No claim is made that offline
changes are saved anywhere.

Connected-without-internet is also treated as offline using Expo Network reachability.

Known 401/403/404 responses erase the failed query's data and cancel/remove related
repository caches and list results. A 404 can mean either missing content or hidden
authorization, so this purge is deliberately conservative. Revocation while the
phone is offline cannot be discovered until the next server check; cached metadata
is never represented as currently authorized in that state. Every upstream read
still uses the server's live installation/user intersection and explicit selection.

## Exact files changed in this task

Earlier uncommitted validation work is not counted as newly implemented here.

| Area                             | Files                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dependencies/test configuration  | `mobile/package.json`, `package-lock.json`, `mobile/eslint.config.cjs`, `mobile/jest.config.cjs`                                                                                                                   |
| Native routes                    | `mobile/app/_layout.jsx`, `mobile/app/(tabs)/repositories.jsx`, `mobile/app/repository/_layout.jsx`, `mobile/app/repository/[id]/index.jsx`, `mobile/app/repository/[id]/file.jsx`                                 |
| Auth/API                         | `mobile/src/features/auth/AuthProvider.jsx`, `mobile/src/features/auth/request.js`, `mobile/src/features/github/api.js`, `mobile/src/hooks/useConnectivity.js`                                                     |
| Explorer                         | `mobile/src/features/repositories/RepositoryProvider.jsx`, `cache.js`, `components.jsx`, `model.js`, `queries.js`, `screens.jsx` in the same directory                                                             |
| Mobile tests and inline fixtures | `mobile/tests/repositories.test.mjs`, `mobile/tests/repository-components.test.jsx`, `mobile/tests/repository-provider.test.jsx`, `mobile/tests/repository-screens.test.jsx`, `mobile/tests/connectivity.test.jsx` |
| Backend                          | `server/src/modules/github/adapter.js`, `controller.js`, `service.js` in the same directory                                                                                                                        |
| Backend regressions              | `server/tests/github-adapter.test.js`, `server/tests/github.test.js`                                                                                                                                               |
| Contract                         | `server/src/contracts/openapi.js`, generated `docs/openapi.json`                                                                                                                                                   |
| Documentation                    | `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_PLAN.md`, `docs/SETUP.md`, `docs/SECURITY.md`, `docs/DEPENDENCY_AUDIT.md`, this report                                                       |

Runtime dependency: TanStack React Query v5. Test-only additions: Jest 29,
jest-expo 54, React Native Testing Library 13 and React Test Renderer pinned to
19.1.0 to match React. They are justified by the required real native component
tests, replacing neither React Native nor the existing Node/Vitest suites.

## Database and environment

No schema changes or new migrations. Existing migrations are
`001-create-users.js`, `002-create-sessions.js`, `003-create-auth-workflows.js`,
`004-create-github-integration.js`. A fresh installation applies them with
`npm run db:migrate`. `npm run db:migrate:undo` reverses the latest; use
`npm run db:migrate:undo:all` only on disposable data. No rollback is needed for
this UI milestone and no production database was changed.

No new environment variables. Mobile uses only `EXPO_PUBLIC_API_URL` for the public
API base. Existing server-only identity settings are `GITHUB_OAUTH_CLIENT_ID`,
`GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CALLBACK_URL`, `MOBILE_AUTH_REDIRECT_URI`
and `API_PUBLIC_URL`. GitHub App access uses `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`,
`GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_OAUTH_CALLBACK_URL`,
`GITHUB_APP_SETUP_CALLBACK_URL`, `GITHUB_APP_MOBILE_REDIRECT_URI` and
`GITHUB_TOKEN_ENCRYPTION_KEY`, plus PostgreSQL settings. Existing environment
examples remain sufficient; no credential values were added or exposed.

For live validation, follow `SETUP.md`: separate identity OAuth and read-only
GitHub App, expiring user tokens, reachable HTTPS callbacks/webhook, Contents/Metadata
read permissions, disposable repositories, native development build and a connected
device. No real provider account/repository was mutated during this task.

## Commands and actual results

Host: Linux, Node 24.21.0, npm 12.0.2. Node 22.13 CI was not executed locally.

| Command/check                                                                                   | Result                                                                                             |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Dependency installation and final `npm ci --offline`                                            | PASS with updated lockfile; offline audit's zero does not override the online report               |
| `DATABASE_URL_TEST=… npm test`                                                                  | PASS: 63 server tests, 21 mobile Node tests, 30 native component/integration tests; none skipped   |
| `npm run lint`                                                                                  | PASS for both workspaces                                                                           |
| `npm run api:contract`, `npm run api:contract:check`                                            | PASS; generated artifact current                                                                   |
| Online `expo install --check` with `EXPO_OFFLINE` unset                                         | PASS; dependencies up to date                                                                      |
| `expo export --platform all --max-workers 2 --output-dir /tmp/pocketops-explorer-final-bundles` | PASS for Android and iOS Hermes/JavaScript assets                                                  |
| `npm ls --all --omit=optional`                                                                  | PASS                                                                                               |
| Android `:app:assembleDebug -PreactNativeArchitectures=x86_64 --max-workers=2 --no-daemon`      | PASS: SDK 36 / Java 17 / Gradle 8.14.3; x86_64 debug APK compiled after the clean install          |
| Online `npm audit --json`                                                                       | FAIL clean-audit gate: 55 affected dependency entries, 48 high and 7 moderate; no critical entries |
| `git diff --check`                                                                              | PASS                                                                                               |
| `adb devices`                                                                                   | No attached device/emulator; physical checks NOT RUN                                               |
| Live OAuth/App/webhooks/revocation                                                              | NOT RUN: test credentials/public HTTPS/device setup unavailable                                    |
| iOS native build/runtime                                                                        | NOT RUN: Linux has no Xcode/simulator                                                              |

The first socket-based backend test attempt failed with sandbox `EPERM`; rerun with
local socket access and a dedicated `pocketops_explorer_test` PostgreSQL 16 database
passed all tests. Jest initially needed Expo module transform configuration and
test scheduler/GC cleanup; final tests exit normally without hiding failures.
Mobile Node tests use the documented Node 22.8+ `--experimental-test-isolation=none`
mode to enumerate individual cases consistently in this environment.

## Coverage, performance and remaining risk

New automated coverage: list virtualization and pagination, bounded/debounced
search, breadcrumbs, root/directory/file route intents, branch-ref change, delayed
responses/cancellation, no cross-repository cached source, 401/403/404/429/502,
offline stale/disabled controls, empty connections/selections/directories, inert text,
binary/oversized previews, background/logout/session cleanup, native query-string
polyfill compatibility, directory cap/submodule normalization and file-size/encoding
regressions. Fixtures use synthetic source and mocked provider responses.

The final 1,000-repository host test initially rendered at most 12 rows in about
19–28 ms across recorded runs (21 ms in the final combined run). Directory lists render 16 initial rows; file lists
render 24. This proves bounded initial rendering, not Android frame rate or native
scroll quality. Long-directory scrolling, screen-reader behavior, actual safe-area
styling, touch and Android back gestures need the device checklist below. Jest
route tests mock Router intent methods; they do not simulate an Android OS gesture.

The online audit is not clean. Adding native test tools introduces extra development
tooling advisory paths; existing Expo/Metro/Tailwind upstream findings remain. No
force upgrade, certificate or production-readiness claim is made. A clean audit,
live authorization testing, production monitoring/recovery and seamless key rotation
remain separate release gates. See `DEPENDENCY_AUDIT.md` and `OPERATIONS.md`.

## Acceptance criteria

| Criterion                                                               | Automated implementation result                                                   | External validation                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------- |
| Native repositories → nested file → preview                             | PASS: native components and mocked-API navigation test                            | NOT RUN on physical Android               |
| Branch changes request ref; no cross-repo stale data                    | PASS: route/ref/query-key/delayed-response tests                                  | NOT RUN with live GitHub                  |
| Unauthorized/revoked repositories not shown as current from stale cache | PASS: error-purge, stale labels, disabled offline controls, session cleanup tests | NOT RUN for live revocation               |
| Graceful binary/oversized files; no editor/terminal                     | PASS: backend regressions and native UI tests                                     | NOT RUN on physical Android               |
| Tests/docs cover navigation, performance constraints and failures       | PASS: coverage and explicit limits/checklist                                      | Device render/scroll measurements NOT RUN |

## Manual Android checklist — NOT RUN

Connect a non-production phone with USB debugging and an accepted host fingerprint;
`adb devices` must show `device`. Configure the existing provider settings, sign in,
and select disposable repositories. Build the phone's actual ABI with `npm run android`.

- Verify dark palette/contrast, safe areas, keyboard dismissal and 44px+ controls.
- Use TalkBack for repository names, breadcrumbs, branch radio items and retry.
- Open a root directory, at least two nested directories and a text file. Check
  toolbar/hardware/system-back behavior and branch changes from a nested path.
- Test slash/unicode branch names, long filenames, empty repositories/directories,
  binary/512-KiB+ files, missing refs/files and submodules.
- Exercise airplane mode, reconnect, weak/slow responses, background/resume,
  session expiry, logout/login as a different user and permission revocation.
- Use a 1,000-entry directory; record initial render time, dropped frames during
  scrolling, device model/OS and network conditions with React Native profiling tools.
  Record actual values rather than adopting the host render number as a target.
- Verify portrait-lock behavior during rotation (the existing app config locks
  portrait); confirm system back gesture and font scaling on the real device.

## Handoff to prompt 05; intentionally deferred

Preview route: `/repository/[id]/file` with `{ id, ref, path }`. The API response
provides `{ path, ref, sha, size, encoding, content, editable }`; `editable` describes
text eligibility, not permission to write. Future editor work must reauthorize,
retain the expected blob SHA, and add its own protected branch/write workflow.
The current source preview does not persist drafts or offer edit actions.

Deferred: syntax-highlighting dependencies (monospace is implemented), large-directory
Trees API traversal, commit timestamps, source persistence/offline edits, WebView,
branch/commit/PR writes, Render/deployments, incidents, notifications and Redis workers.
Remote execution remains excluded from MVP. Stop here before editor implementation.

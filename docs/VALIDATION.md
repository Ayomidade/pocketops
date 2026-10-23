# PocketOps project validation — 2026-10-23

Read `AGENTS.md` and all seven existing documents in `docs/` before changing code.
This inspection covers the existing foundation, identity/session workflows and
GitHub App read-only integration. It does not advance the roadmap milestone.

## Configuration and architecture

- Root private npm workspace contains `mobile` and `server`, with one committed
  lockfile. `npm ls --all --omit=optional` completes without dependency errors.
  Missing optional peers for unused web, TypeScript and testing features do not
  require adding those features to the native JavaScript project.
- Installed mobile versions: Expo 54.0.37, React 19.1.0, React Native 0.81.5,
  Expo Router 6.0.24, NativeWind 4.2.7, Tailwind 3.4.19, Reanimated 4.1.7 and
  Worklets 0.5.1. Expo's bundled SDK dependency map accepts the installed versions.
- Router entrypoint, native scheme, Babel NativeWind preset, Metro wrapper,
  Tailwind content globs/preset and root CSS import are configured. The Android
  export verifies compilation and asset resolution, not on-device rendering.
- Server uses Express 4.22.3, JavaScript ES modules, Sequelize 6.37.8 and `pg`.
  Controllers, services, repositories and provider adapters remain separate.
  Central configuration validation, safe errors, session authentication, request
  IDs, rate limits, encrypted provider tokens and signed webhook handling exist.
- PostgreSQL uses four explicit transactional migrations tracked in
  `SequelizeMeta`. Startup does not synchronize the schema. Liveness is independent
  of PostgreSQL; readiness tests a bounded database connection. Redis is deferred.
- Existing local edits to Compose's host port, native launch scripts and the
  generated Android project were preserved. Compose and the environment example
  agree on host port 54432. Ignored server/mobile `.env` files were not changed.

## Fixes

- `server/src/config/env.js`: invalid CORS origins no longer echo supplied values
  in startup errors, which could expose credentials in a malformed origin.
- `server/src/modules/github/controller.js`: unexpected OAuth/setup callback
  failures are rethrown to the route's async error handler. Previously these
  branches called `next` even though the route never passed that argument,
  replacing the original failure with a TypeError.
- Added three regression cases in `server/tests/api.test.js` and
  `server/tests/github-api.test.js` for credential redaction and both callbacks.
- Updated `docs/SETUP.md` with the current local PostgreSQL port.

No dependencies, application architecture or implementation language changed.

## Executed checks

Environment: Node 24.21.0, npm 12.0.2 on Linux. The repository's pinned Node
22.13.0 CI environment was not rerun here.

| Check                                                                                                          | Result                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --offline`                                                                                             | Passed: 1009 packages installed with lifecycle scripts enabled                                                              |
| `npm ls --all --omit=optional`                                                                                 | Passed                                                                                                                      |
| `DATABASE_URL_TEST=… npm test`                                                                                 | Passed: 59 server tests and 11 mobile tests; none skipped                                                                   |
| Migration integration test                                                                                     | All four migrations applied, repeat application was a no-op, models/session/repository flows exercised, migrations reversed |
| `npm run lint`                                                                                                 | Passed; the existing command covers the backend only                                                                        |
| `npm exec --workspace=mobile -- expo install --check`                                                          | Passed using Expo's local SDK map; network validation unavailable                                                           |
| `npm exec --workspace=mobile -- expo export --platform android --output-dir /tmp/pocketops-validation-android` | Passed: 1337 modules bundled, Hermes output and assets exported                                                             |
| Real API entrypoint with disposable PostgreSQL                                                                 | `/health` 200 and `/ready` 200; server terminated after smoke test                                                          |
| `docker compose config --quiet`                                                                                | Passed                                                                                                                      |
| `git diff --check`                                                                                             | Passed                                                                                                                      |
| `git check-ignore server/.env mobile/.env`                                                                     | Both excluded                                                                                                               |
| `adb devices`                                                                                                  | No devices/emulators attached                                                                                               |

The disposable PostgreSQL 16 container used host port 55439 and database
`pocketops_validation_test`; it did not use the application's development database.
Local-socket tests initially failed under sandbox restrictions, then passed with
socket access. The disposable container was removed after validation.

## Original remaining validation and limitations (see follow-up below)

- Physical Android launch, NativeWind rendering, navigation and offline/resume
  behavior need device checks. An Android JavaScript export is not an APK build.
  Native Android compilation and iOS build/runtime were not verified.
- Live identity OAuth, GitHub App installation, webhook delivery and revocation
  need configured provider accounts, HTTPS callbacks and a development build.
  Automated provider tests use mocks; no live provider success is claimed.
- `npm ci --offline` reported zero vulnerabilities from available cache data,
  alongside transitive deprecation warnings (`inflight`, `glob`, `rimraf`,
  `dottie`, older `uuid`). A fresh online advisory audit was not performed.
- Mobile JSX has no ESLint task yet; existing mobile tests and Android export
  provide narrower coverage. No generated OpenAPI contract is present despite
  the planned API documentation requirement.
- This is not a production security certification. Key rotation, operational
  monitoring, retention/backup procedures and release security gates remain as
  described in the roadmap and security documentation.
- Repository explorer UI, repository writes/editor, Render/deployments, incidents,
  notifications and Redis workers remain deferred. Remote execution is excluded.

Compatibility references: [Expo SDK 54](https://expo.dev/changelog/sdk-54) maps to
React Native 0.81 and React 19.1; [NativeWind v4 installation](https://www.nativewind.dev/docs/getting-started/installation)
describes the Tailwind 3, Babel preset and Metro wrapper used here.

## Follow-up hardening and validation — 2026-10-23

The results here supersede the original limitations where explicitly marked passed.
Changes remain within validation/hardening of the implemented milestone.

| Original gap                  | Current result                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mobile JSX lint               | Fixed: `mobile/eslint.config.cjs` checks JS/JSX, services, tests and configuration; root lint runs both workspaces. ESLint 10 tracks JSX references without a React scope plugin.                                                                |
| Generated OpenAPI             | Fixed: JavaScript contract source, generated `docs/openapi.json`, generator/check commands, OpenAPI schema validation, route coverage and response-envelope tests.                                                                               |
| Online Expo check             | Passed with `EXPO_OFFLINE` unset and network access enabled: dependencies up to date.                                                                                                                                                            |
| Online dependency audit       | Completed; PostCSS and scoped UUID patches reduce affected entries from 38 to 33 (26 high, 7 moderate). See `DEPENDENCY_AUDIT.md`; unresolved upstream findings remain.                                                                          |
| Android native compilation    | Passed: x86_64 debug APK using Java 17, SDK/build tools 36, NDK 27.1.12297006, Gradle 8.14.3 and the New Architecture.                                                                                                                           |
| Android/iOS JavaScript export | Both passed with the updated dependencies; output in `/tmp/pocketops-hardening-bundles`.                                                                                                                                                         |
| Automated tests               | 62 server + 11 mobile tests passed, none skipped, including PostgreSQL migration apply/reverse and three new contract tests.                                                                                                                     |
| Final installation/checks     | Clean `npm ci --offline` passed with the updated lockfile; both workspace lint tasks, contract freshness, dependency-tree validation and `git diff --check` passed afterward. Offline audit output does not supersede the online findings above. |
| Operational procedures        | Added `OPERATIONS.md`: monitoring signals, actual cleanup retention, backup/restore, coordinated credential replacement, device/provider acceptance and release evidence. External infrastructure has not been provisioned.                      |
| Backup/restore drill          | Passed on disposable PostgreSQL 16: applied four migrations, inserted synthetic marker, custom-format dump, isolated restore, verified four migration records and marker row. Temporary data/container removed afterward.                        |
| Native CI                     | Added manually triggered Android debug and unsigned iOS simulator build workflow. Workflow execution is not claimed; local Android build is independently verified.                                                                              |

The generated debug APK is
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`. It targets x86_64
emulators; it is not a signed release or an ARM phone build. Debug launch needs
Metro. Native build warnings include upstream deprecated Gradle/Kotlin/Java APIs;
the Gradle wrapper remains on compatible 8.14.3 rather than jumping to Gradle 9.

The first local native build was interrupted during C++ compilation. Resuming
with cached outputs, `--max-workers=2` and `CMAKE_BUILD_PARALLEL_LEVEL=2` completed
successfully. A stale APK predating this validation was not treated as evidence.

### Still requires external access or subsequent milestone work

- No physical Android device was connected at the last `adb devices` check.
  NativeWind rendering, navigation, offline/reconnect and resume checks remain pending.
- Server-only GitHub identity/App credentials and public HTTPS callbacks are
  unconfigured. Live sign-in, installation, webhook delivery/replay and revocation
  acceptance remain pending. No authentication bypass was added.
- This Linux environment cannot run Xcode or an iOS simulator. iOS JavaScript
  export passes; iOS native build/runtime must be verified on macOS or the new CI job.
- Five upstream advisory sources still affect the dependency tree. Major SDK/tooling
  migrations or reviewed upstream fixes are needed; security certification is not claimed.
- Monitoring alert delivery, production backup/PITR restore and security release
  approval need real infrastructure and an accountable operator. The local restore
  drill does not establish production recovery objectives.
- Seamless online token-encryption key rotation is not implemented. The documented
  maintenance procedure requires revocation/reconnection and explicit operator approval.
- Repository explorer UI, writes/editor, Render/deployment operations, incidents,
  notifications and Redis workers remain separate roadmap milestones. Remote
  execution remains excluded by `AGENTS.md` and the MVP specification.

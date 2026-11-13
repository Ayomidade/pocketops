# Native developer-tool redesign — 2026-11-13

## Implemented

The shared palette now uses charcoal surfaces, blue navigation/actions, readable gray text and semantic status colors. System fonts remain the default for application text. JetBrains Mono 2.304 (SIL OFL, license in mobile/assets/fonts/OFL.txt) is bundled locally for previews, logs, diffs and the CodeMirror editor. Editor font data is packaged at build time; no remote font or script requests are allowed.

Four visible tabs: Overview, Repositories, Projects and Incidents. Account/settings is accessible through the labeled profile control; the existing settings route remains valid but is hidden from the tab bar. Shared headers use compact titles, safe-area layout and explicit back controls. Actions have pressed/disabled feedback and minimum 48px height. Repository rows use separators and consistent SVG file/folder icons; breadcrumbs scroll horizontally. Preview and runtime log text sizes are adjustable.

Overview shows up to three open incidents and three connected projects from the existing authenticated queries, plus workspace links. These are bounded summaries, not totals or an exhaustive recent-deployment feed. Loading, empty and retry states remain available. Projects retain deployment timelines, explicit redeployment confirmation and monitoring configuration. Deployment details link directly to service runtime logs; these are not deployment build output. Unsupported rollback/promotion actions are not offered. Removed stale claims that incident health verification belongs to an unimplemented milestone.

No backend routes, authorization rules, secrets or migrations changed. README edits predated this task and were preserved.

## Delivery

expo-font is now an explicit native dependency. Runtime is 0.1.0-ui.1 in Expo configuration and the checked-in Android runtime string. Build a new preview APK before publishing updates for this runtime. Do not deliver this bundle to the previous incidents runtime. The font generation runs with editor:bundle and the existing EAS post-install hook.

## Verification

- Mobile logic: 47 passing tests.
- Mobile UI: 77 passing tests across 12 suites, including labeled account/back navigation.
- Mobile ESLint and palette AA contrast test pass.
- Android JavaScript export passes; this is not native compilation or device rendering evidence.
- Root npm test: 184 server tests pass, 1 fails (pre-existing OpenAPI omissions for account deletion/session revocation), 1 skipped (test database unavailable).
- Root npm run lint: pre-existing unused sessionId in server auth service blocks root lint. Mobile lint run separately.
- Connected phone detected using ADB. Redesigned APK has not been built/installed; device visual, TalkBack, large font, keyboard, offline/resume and back-gesture checks remain NOT RUN.
- Dependency installation reports 32 advisories (4 high, 20 moderate, 8 low); no unrelated forced upgrades applied.

## Device acceptance checklist

Install the rebuilt signed preview APK without uninstalling the existing app. Verify all four tabs and account entry; return/back from repository, nested folder, preview/editor and deployment detail. Open runtime logs from a deployment and check refresh/filter/text size. Exercise long paths, large Android font scaling and TalkBack labels; verify disabled actions do not execute. Confirm edit → diff → explicit commit → PR and explicit redeploy approvals still behave correctly using a disposable repository/noncritical service. No live provider mutation was performed during this redesign.

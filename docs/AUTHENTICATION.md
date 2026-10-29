# GitHub sign-in review — 2026-10-28

This review covers identity sign-in, session lifecycle and the separate GitHub App user-authorization flow. It does not implement incidents or change the deployment milestone.

## Fixed issues

- Both callback controllers received GitHub's `error` field but their services expected `providerError`. Cancellation now reaches the correct branch; unknown provider errors do not claim the user canceled.
- GitHub supports and recommends S256 PKCE for OAuth Apps and GitHub Apps. Earlier PocketOps documentation saying it was unsupported was incorrect. Both authorization requests now include a challenge and both token exchanges send the matching verifier. Identity scope remains `read:user`; the GitHub App keeps its separate `offline_access` request and installation permissions.
- Browser return, native URL events and the callback route can all report the same handoff. They now share one in-flight exchange. A browser dismissal cannot reverse an exchange already underway or completed through a native URL event.
- Login attempts and session restoration are fenced by a local generation. Cancellation/logout cannot be undone by a late response; rapid taps cannot open multiple browser sessions. A canceled exchange that returns a session token discards it locally and attempts server revocation. Revocation is best-effort if the network is unavailable; the token is never made the active local session and an unreachable orphan session expires server-side.
- SecureStore mutations are serialized. New login clears a pending rotation token from an older login. Restoration recovers an interrupted rotation; logout checks/revokes both active and pending credentials, including a pending-only session. Old 401 handlers cannot delete a newer login or interfere with a pending sign-in.
- Identity callbacks reject duplicate keys, mixed error/handoff, unknown parameters and fragments. Only the exact native callback is accepted. Malformed unrelated links do not consume the current attempt.
- Expo Go/mismatched schemes fail before starting OAuth, with actionable development-build guidance. Configuration/database and throttling errors have clearer messages.
- GitHub connections wait for session restoration and require authentication before making requests. The outdated read-only-only permissions card now describes the existing editor's additional write permissions accurately.
- Auth and GitHub responses use `Cache-Control: no-store`. Provider token exchanges and identity reads reject HTTP redirects instead of following them with sensitive request data.

## PKCE and state storage

`server/src/modules/auth/pkce.js` derives a 43-character verifier using HMAC-SHA256 over a domain-separated purpose and the existing 256-bit random OAuth state, keyed with the appropriate server-only client secret. Identity and GitHub App flows use different purposes and their respective secrets. The challenge is base64url(SHA256(verifier)). No verifier, client secret or GitHub token is returned to mobile or added to URLs. This keeps verifiers out of plaintext database storage without adding another encryption setting or schema field.

All API replicas must use the same client credentials. Changing a client secret during a flow requires restarting that flow; this was already true for the token exchange. State remains hashed, expiring and consumed once in PostgreSQL. The independent mobile completion secret still binds a one-use handoff to its initiating app process. PKCE supplements these controls; it does not replace state or resource authorization.

Sources: [OAuth App authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [GitHub App user tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), [GitHub's PKCE announcement](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/).

## Setup and diagnostics

No new dependencies, environment variables, API response shapes or database migrations. Existing migrations must all be applied with `npm run db:migrate`; rollback procedures are unchanged. Existing server-only identity variables are `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CALLBACK_URL`, `MOBILE_AUTH_REDIRECT_URI` and `API_PUBLIC_URL`. GitHub App connection remains separately configured by `GITHUB_APP_*` and `GITHUB_TOKEN_ENCRYPTION_KEY`.

Use `pocketops://auth/callback` as the exact identity native redirect and the canonical backend `/api/v1/auth/github/callback` URL in the OAuth App. The GitHub App uses `/api/v1/github/oauth/callback`, its separate installation setup callback, and `pocketops://github/callback`. Disable callback wildcard matching in provider settings when not needed. Use HTTPS, omit callback query strings from proxy logs, and never put secrets in `EXPO_PUBLIC_*`.

The read-only local development configuration check found: identity OAuth configured, PostgreSQL reachable, no pending migrations, native redirect and canonical callback matching, and HTTPS callback. The GitHub App feature is **not configured** in this environment. The local API returns a healthy `/api/v1/health`, and an unauthenticated `/api/v1/auth/me` returns 401 with `Cache-Control: no-store`, confirming that the running API loaded the authentication changes. The mobile API URL is configured with the correct `/api/v1` path and is not a loopback address. The original public callback origin failed DNS resolution (`ENOTFOUND`). The operator subsequently supplied a replacement development tunnel: its `/api/v1/health` returned HTTP 200 with the PocketOps service identity. Local ignored `server/.env` public origin/callback and `mobile/.env` API URL were updated, and server configuration validation passed. Restart the API and Expo so they load the replacement settings, and register the exact new callback in GitHub OAuth App settings. The tunnel must remain running; temporary tunnel URLs can change. Live browser/device sign-in and GitHub callback registration remain unverified. These checks do not prove that GitHub accepts the configured credentials. No secret values or callback URLs were printed.

## Tests and remaining manual checks

Regression tests cover PKCE challenge/verifier matching for both flows, token-exchange fields, denial forwarding, no-store headers, strict native callbacks, concurrent callback delivery, cancellation/late responses, double-tap prevention, storage failures, interrupted rotation, pending-only logout and stale 401/restoration protection. Native component tests mount the real AuthProvider and login screen with mocked system browser/network/storage.

The full suite also runs the existing PostgreSQL migration/auth/session tests against a dedicated disposable test database. No existing development/production schema or user repositories were modified by this review.

Live GitHub approval, valid/invalid actual credentials, device browser return, Android/iOS app process interruption, secure-storage failure on hardware, and physical-device sign-in/out remain **NOT RUN**. Use a development build and a non-production account to verify success, rejection, cancellation, double tap, app background/kill/relaunch, offline callback exchange, rotation recovery and logout. The connection setup flow additionally needs a configured GitHub App. OAuth handoffs cannot resume across a killed app process: restart sign-in. No live success or production security certification is claimed.

## Exact authentication file changes

- `server/src/modules/auth/pkce.js`, `service.js`, `controller.js`, `routes.js`, `github-oauth.js` (same feature directory).
- `server/src/modules/github/service.js`, `controller.js`, `routes.js`, `adapter.js` (same feature directory).
- `mobile/src/features/auth/lifecycle.js`, `AuthProvider.jsx`, `request.js`, `session.js` (same feature directory); `mobile/app/connections.jsx`.
- `server/tests/auth.test.js`, `auth-api.test.js`, `github.test.js`, `github-api.test.js`, `github-adapter.test.js` (same test directory).
- `mobile/tests/auth-lifecycle.test.mjs`, `auth-session.test.mjs`, `auth-provider.test.jsx` (same test directory).
- `docs/AUTHENTICATION.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`, `docs/SETUP.md`.

Other modifications already present from the Render task are preserved and are not authentication changes.

## Executed validation and acceptance

| Check | Actual result |
| --- | --- |
| `DATABASE_URL_TEST=… npm test` using the isolated PostgreSQL test database | PASS: 119 server tests, 41 mobile Node tests and 56 native UI tests; zero skipped. |
| Final `npm test -w mobile` after adding the crash-window ordering regression | PASS: 42 Node tests and 56 native UI tests. |
| `npm run lint` | PASS, both workspaces. |
| `npm run api:contract:check` | PASS; no API response-schema change or stale artifact. |
| `git diff --check` | PASS. |
| `npm run export -w mobile -- --platform android --output-dir /tmp/pocketops-auth-fixes-final` | PASS: 1,454 modules, approximately 4.82 MB Android JavaScript/Hermes output. Not a native build or device test. |
| Configured development PostgreSQL/settings and local API checks | PASS: DB reachable, all migrations present, native/backend callback alignment, local health 200, unauthenticated auth 401/no-store. No settings or application data changed. |
| Public callback health | FAIL: configured hostname does not resolve (`ENOTFOUND`); replacement HTTPS origin needed. |
| Live GitHub approval and physical Android/iOS sign-in/out | NOT RUN: public callback DNS blocker; interactive provider/device verification is still required. |

A nonfatal existing React Native `SafeAreaView` deprecation warning is emitted from the shared `Screen` component by the new native authentication tests. It is not a sign-in failure and no warnings were suppressed.

Authentication acceptance: denial forwarding **PASS**; S256 challenge/verifier consistency and credential isolation **PASS**; callback/session race regressions **PASS**; strict callback handling and protected GitHub connections **PASS**. Live end-to-end sign-in is **NOT RUN**, with callback reachability **FAIL** until the public URL is repaired. The incident milestone was not started by this authentication repair.

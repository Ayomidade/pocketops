# PocketOps — Code editor milestone

**Status:** implementation complete; live provider and physical-device gates remain NOT RUN.

## Behavior

The native repository file screen opens the editor only for existing UTF-8 files that the API marks editable and that are at most 512 KiB. The app downloads the selected file and live branch metadata, then loads text into a locally bundled CodeMirror 6 WebView. JavaScript/JSON/HTML/CSS/Markdown have language support; other text uses a readable fallback. CodeMirror provides line numbers, undo/redo, search, cursor location and keyboard focus. The WebView contains no provider credentials and all branch, diff, commit and pull-request controls stay native.

Before editing, a developer must create a new `fix/`, `bugfix/`, `chore/` or `docs/` branch from an explicit branch and commit SHA. The native diff identifies repository, fix branch, file and commit message. A second native confirmation is required before the app calls the commit endpoint. The backend accepts writes only to a fix branch that the same PocketOps user created through this workflow, rejects default/protected branches and checks the latest blob SHA. Stale content returns `409 FILE_VERSION_CONFLICT`. Commit success does not claim tests passed. A separate confirmation opens the PR; the app does not merge it or claim deployment success.

## API contract

All routes require a valid PocketOps session and a currently selected repository accessible through the user's active GitHub App installation:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/github/repositories/{id}/branches/metadata?branch=...` | Live branch commit SHA/protection metadata |
| POST | `/api/v1/github/repositories/{id}/branches` | Create a fix branch from an explicit base branch and SHA |
| PUT | `/api/v1/github/repositories/{id}/file` | Commit one existing UTF-8 file with expected blob SHA |
| GET | `/api/v1/github/repositories/{id}/pull-requests?head=...&base=...` | List PRs for the user's tracked branch pair |
| POST | `/api/v1/github/repositories/{id}/pull-requests` | Open a PR from the tracked fix branch into its recorded base |

Mutations require an `Idempotency-Key` (16–100 characters), strict Zod request validation and a per-process 20/minute rate limit. The provider-backed GETs (branch metadata, pull-request list) share a per-process 60/minute read limit. Pull-request bodies are capped at 4,000 characters, matching the mobile input limit. A database unique constraint scopes idempotency to actor/key; reusing a key with a different fingerprint returns 409. Operation states include pending, succeeded, failed and uncertain. A timeout/ambiguous provider result cannot be blindly replayed. `005-create-code-changes.js` stores metadata and links safe audit events; file content is not persisted by the server. The global JSON parser permits up to 4 MiB to handle worst-case JSON escaping while endpoint file content remains capped at 512 KiB.

## WebView protocol and data handling

Protocol version 1 messages have `version`, `type`, `sessionId`, `requestId` and strict payload schemas. Both sides validate IDs, message sizes (4 MiB), content sizes (512 KiB), types and correlated replies; duplicate/replayed responses and stale sessions are rejected. HTML, CSS and CodeMirror are bundled locally. CSP disables network connections, external frames and forms; navigation is limited to the editor origin or `about:blank`. WebView file access, cookies, persistent DOM storage, popups and mixed content are disabled.

Unsaved text is held in memory. The app can save up to five drafts per user, each no larger than 512 KiB, encrypted with AES-GCM using a key held in device-only SecureStore. Ciphertext is stored in the app-private documents directory and expires after 24 hours. The app asks before restoring a draft, verifies the branch/file is still current, deletes stale/corrupt data, and removes per-user keys/files on logout or session expiry. A draft is never sent to GitHub until the user reviews and confirms the commit.

## Setup and migration

Read [SETUP.md](SETUP.md) for server and development build configuration. Browsing needs Contents: read and Metadata: read. Branch/file writes need Contents: write; PRs need Pull requests: write. Grant those write permissions only to a GitHub App installation on a disposable test repository. OAuth, App private key, webhook secret and token-encryption key remain in `server/.env` or a secret manager; no `EXPO_PUBLIC_*` secrets are used.

Apply with `npm run db:migrate` (`005-create-code-changes.js`). Reverse the most recent migration with `npm run db:migrate:undo` only after assessing active/uncertain operation rows. The migration is transactional and reversible.

The generated local CodeMirror bundle is committed for reproducible Metro builds. `npm run editor:bundle -w mobile` regenerates it; the mobile export script and native CI build steps run this before bundling/compiling.

## Verification and manual gaps

Automated coverage includes bridge schema/size/correlation/navigation cases, encrypted draft scoping/expiry/cleanup, native mocked branch→edit→diff→confirm→commit→PR flow, API validation/auth/idempotency, provider normalization/conflicts, repository ownership, permission/revocation and stale-SHA behavior. Live GitHub App writes require configured credentials, HTTPS callbacks and a disposable repository; Android/iOS keyboard, rotation, screen-reader and WebView process behavior require device checks. The editor does not execute code, provide a terminal, push to the default branch, run CI, merge PRs or deploy services.

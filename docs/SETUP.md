# PocketOps — Local Development, Configuration and Troubleshooting

**Version:** 1.1 | **Target:** Linux/macOS/Windows development with Android-first Expo testing

## 1. What is included today

The monorepo contains an Expo/React Native navigation shell, NativeWind configuration, Express server, identity authentication, GitHub App repository APIs, guarded source editing, Render deployment connections/operations, reversible migrations, webhook processing, a deployment worker process and API/mobile tests. Notifications and incident workflows remain unimplemented. Physical-device launch, live provider setup and runtime styling still require local verification.

## 2. Prerequisites

- Node.js 22.13+ and npm (use `.nvmrc`).
- Git, Android phone or emulator, stable local network.
- Expo tooling through `npx expo` (global Expo CLI not required).
- Docker Engine + Compose for optional local PostgreSQL, or a local PostgreSQL 16+ server.
- For development builds, Android Studio/SDK or Expo EAS build access.
- GitHub account and test repository; Render test service only when integration milestones begin.

## 3. First run

From the extracted monorepo root:

```bash
node --version
npm --version
npm ci
cp server/.env.example server/.env
cp mobile/.env.example mobile/.env
```

Inspect both `.env.example` files and **do not commit `.env` files**. Start PostgreSQL if needed:

```bash
docker compose up -d postgres
```

Compose exposes PostgreSQL on `127.0.0.1:54432`; the server environment example
uses this port. PostgreSQL still listens on port `5432` inside the container.
If you use a different local database, adjust `DATABASE_URL` accordingly.

Run the API and mobile in separate terminals. PostgreSQL may be unavailable while checking liveness; readiness requires it:

```bash
npm run api
npm run mobile
```

Check liveness with `curl http://localhost:4000/health` (or `/api/v1/health`) and database readiness with `curl http://localhost:4000/ready` (or `/api/v1/ready`). Liveness does not contact PostgreSQL; readiness returns 503 if PostgreSQL is missing, unavailable or times out. Redis is not used or required by this foundation.

On a physical phone, set `EXPO_PUBLIC_API_URL` to `http://<YOUR_COMPUTER_LAN_IP>:4000/api/v1`. Never use `localhost` to mean your laptop from a phone. This value is public client configuration, not a secret.

## 4. Expo and NativeWind compatibility

Verify actual package versions in `mobile/package.json`. From `mobile/`:

```bash
npx expo install --check
npx expo install --fix
npx expo start --clear
```

Run a development build when required by installed native modules. Expo Go only works with compatible SDK/native dependencies. Confirm NativeWind Metro/Babel setup, Tailwind content globs, `global.css` import and runtime rendering. React Native utility classes are not identical to browser Tailwind; test supported utilities on device.

## 5. Environment variable policy

**Mobile public values:** API base URL, nonsecret deep-link scheme, public feature flags. Anything prefixed `EXPO_PUBLIC_` can be embedded in the client bundle: never put tokens, client secrets or private keys there.

**Server settings:** `NODE_ENV`, `PORT`, `DATABASE_URL`, `DATABASE_SSL`, `CORS_ORIGINS`, and `LOG_LEVEL` are validated centrally. PostgreSQL configuration is optional in development/test when only liveness is needed, but production requires `DATABASE_URL`. Invalid configuration reports variable names and requirements, never supplied credential values. GitHub identity OAuth and GitHub App configuration are optional; each feature's variables must be configured together. Keep every credential server-side.

## 6. GitHub identity OAuth and native callback

Identity OAuth signs the person in to PocketOps. GitHub App authorization is a separate flow and independently grants repository access; signing in does not install the App.

1. Create a GitHub **OAuth App** for the PocketOps API. Set its callback URL to the exact public backend URL `https://<API_HOST>/api/v1/auth/github/callback`. The backend must be reachable by GitHub over HTTPS. For local development on a physical device, use a trusted HTTPS development tunnel; `localhost` on the phone is not the developer machine.
2. Set all five server-only variables in `server/.env`:

   ```dotenv
   GITHUB_OAUTH_CLIENT_ID=<oauth-app-client-id>
   GITHUB_OAUTH_CLIENT_SECRET=<oauth-app-client-secret>
   GITHUB_OAUTH_CALLBACK_URL=https://<API_HOST>/api/v1/auth/github/callback
   MOBILE_AUTH_REDIRECT_URI=pocketops://auth/callback
   API_PUBLIC_URL=https://<API_HOST>
   ```

   `API_PUBLIC_URL` is the origin only, with no path. `GITHUB_OAUTH_CALLBACK_URL` must exactly match the GitHub OAuth App setting. The mobile redirect is a single exact allowlisted value. Never copy the OAuth client secret to `mobile/.env` or any `EXPO_PUBLIC_*` variable. Leaving the example values empty disables OAuth without preventing API startup.

3. Apply migrations with `npm run db:migrate`; the OAuth transaction and authentication audit tables are added by `003-create-auth-workflows.js`.
4. Use an Android/iOS development build that registers the `pocketops` scheme from `mobile/app.json` (for example, build with the Expo development client or `npx expo run:android`). Expo Go may run screens but does not register this app-specific callback scheme; do not count an Expo Go run as OAuth verification.
5. Test sign-in with a non-production GitHub account. OAuth requests only the `read:user` identity scope. The returned profile email is optional and not considered verified.

The mobile opens the backend authorization URL in Expo WebBrowser's system auth session. The OAuth state expires after 10 minutes; the app's one-time handoff expires after two minutes. A 256-bit completion secret binds the handoff to the initiating app process and is held only in memory. If the flow is cancelled or the app process is interrupted, restart sign-in.

Configure ingress/proxy access logs to omit query strings for `/api/v1/auth/github` and `/api/v1/auth/github/callback`; these requests carry OAuth state/code and the callback redirects with a short-lived handoff. PocketOps application logs omit URL queries and redact bearer credentials. Ensure the callback URL and API use TLS outside local development.

## 7. GitHub App setup (repository access)

Browsing requires GitHub App **Contents: Read-only** and **Metadata: Read-only**. To enable source editing, grant **Contents: Read and write** and **Pull requests: Read and write** on a dedicated test installation/repository. The App does not need Administration or Workflows permissions. GitHub identity OAuth and GitHub App authorization are distinct: the server requires the App-authorized GitHub account ID to match the signed-in PocketOps identity.

1. Register a GitHub App and enable **user-to-server authorization with expiring user access tokens and refresh tokens**. The implementation requires expiring user tokens; it rejects responses without refresh-token/expiry fields.
2. Configure the App's **OAuth callback URL** to `https://<API_HOST>/api/v1/github/oauth/callback`, its **Setup URL** to `https://<API_HOST>/api/v1/github/installations/callback`, and its **Webhook URL** to `https://<API_HOST>/api/v1/webhooks/github`. Enable webhook SSL verification.
3. Subscribe to `installation`, `installation_repositories`, and `github_app_authorization` events. These support install/uninstall, suspension, permission updates, repository changes and user-authorization revocation.
4. Set every GitHub App variable in `server/.env` (see `.env.example`):

   ```dotenv
   GITHUB_APP_ID=<numeric-app-id>
   GITHUB_APP_CLIENT_ID=<app-client-id>
   GITHUB_APP_CLIENT_SECRET=<app-client-secret>
   GITHUB_APP_PRIVATE_KEY="<PEM with newlines or escaped \\n>"
   GITHUB_APP_SLUG=<app-slug>
   GITHUB_APP_WEBHOOK_SECRET=<webhook-secret>
   GITHUB_APP_OAUTH_CALLBACK_URL=https://<API_HOST>/api/v1/github/oauth/callback
   GITHUB_APP_SETUP_CALLBACK_URL=https://<API_HOST>/api/v1/github/installations/callback
   GITHUB_APP_MOBILE_REDIRECT_URI=pocketops://github/callback
   GITHUB_TOKEN_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
   ```

   Generate a fresh encryption key with `openssl rand -base64 32`. Store it in a secret manager in deployed environments and back it up securely; losing it makes persisted GitHub user/refresh tokens unusable. Never place App credentials, private keys, webhook secrets or the encryption key in the mobile environment or `EXPO_PUBLIC_*`.

5. Apply migrations with `npm run db:migrate`; `004-create-github-integration.js` creates GitHub state and webhook delivery queue, `005-create-code-changes.js` adds durable editor idempotency/audit linkage, and `006-create-deployments.js` adds Render provider connections, projects, deployments and operation requests. Roll back the latest migration with `npm run db:migrate:undo` only after reviewing operation records.
6. Use an Android/iOS development build registering the `pocketops` scheme. Expo Go is not sufficient for verifying this app-specific callback. On device, use a public HTTPS API callback reachable by GitHub, then test with a non-production GitHub account and disposable test repositories.

The mobile app uses Expo WebBrowser's system authentication session. OAuth and setup state are separate, hashed, one-use values expiring after 15 minutes. Only a status (`connected`, `cancelled`, `failed`) returns through the native deep link; no GitHub or PocketOps credential is placed in callback parameters. The server encrypts GitHub user and refresh tokens using AES-256-GCM; installation tokens are created server-side and never returned. Before exposing repository data the server intersects repositories visible to the signed-in GitHub user with those available to the installation, then requires the PocketOps user to select repositories. Repository read requests revalidate access with GitHub.

Webhook deliveries are signature-verified against raw request bytes, deduplicated in PostgreSQL, and processed by a retrying loop in the API process. Redis is not required. Configure ingress logging to omit authorization headers and never log webhook bodies. The PostgreSQL delivery queue is durable, but GitHub webhook processing does not provide a separately deployed worker or operational monitoring.

## 8. Render deployment operations

Deployment operations are disabled by default and require **every** value below in `server/.env`, plus the GitHub App configuration from section 7 (the worker revalidates repository access):

```dotenv
DEPLOYMENTS_ENABLED=true
# JSON key ring of base64 32-byte keys; generate each with: openssl rand -base64 32
PROVIDER_ENCRYPTION_KEYS={"v1":"<base64-32-bytes>"}
PROVIDER_ACTIVE_KEY_VERSION=v1
```

`PROVIDER_ENCRYPTION_KEYS` encrypts Render API keys at rest with AES-256-GCM. Store it in a secret manager and back it up separately from database backups; losing every key requires users to reconnect their Render account. To rotate, add a new key version to the ring and switch `PROVIDER_ACTIVE_KEY_VERSION`; existing connections re-encrypt lazily on next use. Never place these values in `mobile/.env` or any `EXPO_PUBLIC_*` variable.

Create a Render API key in **Render Account Settings** (use a dedicated test account; keys are account-scoped, not per-service). Connect it from the app's Deployments tab → Manage Render connections. The key is sent once over TLS, encrypted server-side, and never returned by the API or stored on the phone.

Redeploy requests are queued in PostgreSQL and processed only by the **separate worker process**:

```bash
npm run worker:deployments
```

Without the worker, `POST /projects/:id/deployments` still returns `202` with `status: "queued"`, but operations never progress — the API process does not dispatch them. Run the worker in any environment where deployment actions are enabled, and monitor it per [OPERATIONS.md](OPERATIONS.md).

## 9. Database lifecycle

`/health` may respond without a database connection; it is not a readiness check. `/ready` checks PostgreSQL with a bounded timeout. Use the versioned migrations; do not use `sequelize.sync({alter:true})` in staging/production. The current migrations create `users`, `sessions`, identity OAuth transactions/audit events, GitHub App installation state/memberships/repositories/selections/webhook deliveries, durable editor operations (`005`), and Render provider connections/projects/deployments/operation requests (`006`).

```bash
npm run db:migrate
npm run db:migrate:undo
npm run db:migrate:undo:all
```

Rollback commands drop schema objects. Run rollback only against a disposable database. The migration integration test uses `DATABASE_URL_TEST` only when it points to a dedicated database name ending in `_test`; CI provisions a fresh PostgreSQL 16 test database. Without `DATABASE_URL_TEST`, that integration case is skipped, while API and mobile client tests still run.

## 10. Recommended daily commands

Root lint now checks both the backend and mobile JavaScript/JSX. To regenerate the
implemented API contract, run `npm run api:contract`; CI checks that the generated
`docs/openapi.json` is current with `npm run api:contract:check`.

See [Operations and release validation](OPERATIONS.md) for physical-device setup,
native CI builds, provider acceptance checks, monitoring and backup/rotation procedures.

```bash
npm ci
npm run api
npm run mobile
npm test
npm run lint
```

Scripts may differ from future milestones: inspect root and workspace `package.json`. Do not assume a command exists without checking. For the database migration integration test, set `DATABASE_URL_TEST` to an isolated PostgreSQL database ending in `_test`. The ordinary API tests do not need provider credentials.

## 11. Physical Android validation

1. Ensure phone and development machine share a reachable network.
2. Check computer firewall allows the API port and Metro as required.
3. Use LAN IP in mobile API config; restart Metro after env changes.
4. Verify the dashboard, tab navigation, offline banner and API liveness call.
5. Test airplane mode/offline UI, resume, app background/foreground and keyboard behavior.
6. Test PocketOps identity sign-in and GitHub App system-browser callback; verify connection identity and repository selection remain distinct.

## 12. Troubleshooting matrix

| Symptom                            | Likely cause                             | Action                                                          |
| ---------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Phone cannot call API              | `localhost` or firewall                  | Use computer LAN IP; check firewall and bind address            |
| Expo SDK mismatch                  | Native dependency versions               | `npx expo install --check` then `--fix`; clear cache            |
| NativeWind classes ignored         | Metro/Babel/content config               | Verify config and global CSS import; restart Metro              |
| Database connection refused        | Container down, wrong credentials        | `docker compose ps`, inspect DB URL and logs                    |
| API health works but DB calls fail | Health is liveness, not readiness        | Check `/ready`, `DATABASE_URL` and PostgreSQL availability      |
| OAuth returns to browser           | Deep link mismatch                       | Validate Expo scheme, redirect URI and handoff flow             |
| GitHub repository missing          | Installation selection or revoked access | Recheck GitHub App installation permissions                     |
| 409 file conflict                  | SHA changed                              | Reload, compare diff and reapply change                         |
| Render logs empty                  | Permissions, time filter, API limits     | Verify provider connection and bounded query                    |
| Push not delivered                 | Permissions/token/background limitations | Verify device token, platform configuration and in-app fallback |

## 13. CI and staging

CI uses `npm ci`, server/mobile tests, ESLint, Expo compatibility diagnostics and an Android JavaScript export. It provisions PostgreSQL 16 for migration up/down tests and needs no provider credentials. For staging: managed DB, the deployment worker process (`npm run worker:deployments`), staging GitHub App settings, a disposable Render service and test account, and `DEPLOYMENTS_ENABLED` with a staging key ring. Set up logs, metrics, backup and failure alerts before production access. Mobile builds should use distinct application identifiers/schemes for dev/staging/prod to avoid deep-link collisions.

## 14. Initial smoke test checklist

- [ ] `npm ci` succeeds with locked compatible dependencies.
- [ ] API starts and `GET /health` returns success.
- [ ] `/ready` reflects PostgreSQL availability without changing `/health`.
- [ ] Expo app opens on physical Android.
- [ ] NativeWind styles display.
- [ ] Navigation tabs work and API requests reach backend.
- [ ] Tests/lint execute (record exact results).
- [ ] `.env` files and secrets are excluded from version control.
- [ ] Migrations apply and reverse on a disposable PostgreSQL database.

## 15. Next steps

The native explorer, safe source editor and Render deployment operations are implemented. Follow the [repository checklist](REPOSITORY_EXPLORER.md) and [editor checklist](CODE_EDITOR.md). Live provider setup (including Render with a disposable service/account) and physical-device checks remain outstanding. Implement one milestone at a time, update docs alongside code and retain an independent recovery path. See [Development plan](DEVELOPMENT_PLAN.md).

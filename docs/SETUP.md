# PocketOps — Local Development, Configuration and Troubleshooting

**Version:** 1.1 | **Target:** Linux/macOS/Windows development with Android-first Expo testing

## 1. What is included today

The starter ZIP contains an Expo/React Native navigation shell, NativeWind configuration, Express server, `/health`, database configuration and initial test files. It does **not** yet contain working GitHub OAuth, GitHub App integration, migrations, Render connections, notifications or editor. Read `PRD.md` for target behavior. **Dependency installation and complete device launch must be verified locally.**

## 2. Prerequisites

- Node.js 22+ and npm (use `.nvmrc` if available).
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
npm install
cp server/.env.example server/.env
cp mobile/.env.example mobile/.env
```

Inspect both `.env.example` files and **do not commit `.env` files**. Start PostgreSQL if needed:

```bash
docker compose up -d postgres
```

Run API and mobile in separate terminals:

```bash
npm run api
npm run mobile
```

Check API: `curl http://localhost:4000/health` (adjust port from `server/.env`). On a physical phone, set `EXPO_PUBLIC_API_URL` to `http://<YOUR_COMPUTER_LAN_IP>:4000/api/v1` or the base path expected by the existing API client; inspect `mobile/src/services/api.js` before changing it. Never use `localhost` to mean your laptop from a phone.

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

**Server secrets (future):** DB URL, Redis URL, session pepper/key, OAuth client ID/secret, GitHub App ID/private key, webhook secret, Render encryption key reference, notification credentials. Keep placeholders in `.env.example`; real values in local `.env`/managed secret store. Use a unique development database and a separate staging provider connection.

## 6. Database lifecycle

The starter's `/health` may respond without a database connection; it is **not** a readiness check. After migration implementation, use the repository's actual migration scripts to run versioned migrations; do not use `sequelize.sync({alter:true})` in staging/production. Verify connection, constraints and rollback against a disposable DB. The Docker Compose service alone does not create PocketOps tables.

## 7. Recommended daily commands

```bash
npm install
npm run api
npm run mobile
npm test
npm run lint
```

Scripts may differ from future milestones: inspect root and workspace `package.json`. Do not assume a command exists without checking. For API tests, configure an isolated test database when DB-backed tests are added.

## 8. Physical Android validation

1. Ensure phone and development machine share a reachable network.
2. Check computer firewall allows the API port and Metro as required.
3. Use LAN IP in mobile API config; restart Metro after env changes.
4. Verify dashboard and API health call.
5. Test airplane mode/offline UI, resume, app background/foreground and keyboard behavior.
6. Later, test GitHub OAuth return deep link, SecureStore persistence and notification permissions.

## 9. Troubleshooting matrix

| Symptom                            | Likely cause                             | Action                                                          |
| ---------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Phone cannot call API              | `localhost` or firewall                  | Use computer LAN IP; check firewall and bind address            |
| Expo SDK mismatch                  | Native dependency versions               | `npx expo install --check` then `--fix`; clear cache            |
| NativeWind classes ignored         | Metro/Babel/content config               | Verify config and global CSS import; restart Metro              |
| Database connection refused        | Container down, wrong credentials        | `docker compose ps`, inspect DB URL and logs                    |
| API health works but DB calls fail | Health not readiness                     | Add/test DB-backed readiness after migrations                   |
| OAuth returns to browser           | Deep link mismatch                       | Validate Expo scheme, redirect URI and handoff flow             |
| GitHub repository missing          | Installation selection or revoked access | Recheck GitHub App installation permissions                     |
| 409 file conflict                  | SHA changed                              | Reload, compare diff and reapply change                         |
| Render logs empty                  | Permissions, time filter, API limits     | Verify provider connection and bounded query                    |
| Push not delivered                 | Permissions/token/background limitations | Verify device token, platform configuration and in-app fallback |

## 10. CI and staging

CI should run syntax/lint/tests and ensure no accidental secrets. For staging: managed DB/Redis, separate worker, staging GitHub App settings and a disposable Render service. Set up logs, metrics, backup and failure alerts before production access. Mobile builds should use distinct application identifiers/schemes for dev/staging/prod to avoid deep-link collisions.

## 11. Initial smoke test checklist

- [ ] `npm install` succeeds with locked compatible dependencies.
- [ ] API starts and `GET /health` returns success.
- [ ] Expo app opens on physical Android.
- [ ] NativeWind styles display.
- [ ] Navigation tabs work and API requests reach backend.
- [ ] Tests/lint execute (record exact results).
- [ ] `.env` files and secrets are excluded from version control.
- [ ] Database container starts if configured.

## 12. Next steps

Once foundation is verified, run Codex prompt `01-foundation.md` only for fixes, then `02-authentication.md`. Implement one milestone at a time, update docs alongside code and retain an independent GitHub/Render recovery path. See [Development plan](DEVELOPMENT_PLAN.md).

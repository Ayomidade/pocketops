# PocketOps

PocketOps is a native mobile incident-response product. The repository contains the foundation, identity/session workflow and server-mediated GitHub App installation with read-only repository APIs. It is not production-ready and does not provide repository writes or deployment integrations.

## Requirements and quick start

- Node.js 22.13+ (see `.nvmrc`) and npm
- PostgreSQL 16+ for readiness checks and database migrations
- Android device/emulator for native UI verification; Expo Go or a development build

```bash
npm ci
cp server/.env.example server/.env
cp mobile/.env.example mobile/.env
# For a physical phone, set EXPO_PUBLIC_API_URL to your computer's LAN IP.
npm run api
# In a second terminal:
npm run mobile
```

The API is available at `http://localhost:4000`. `GET /health` and `/api/v1/health` are liveness checks and do not require PostgreSQL. `GET /ready` and `/api/v1/ready` require a reachable PostgreSQL database.

## Database

Start the optional local database with `docker compose up -d postgres`, then apply the versioned migrations:

```bash
npm run db:migrate
```

Rollback the most recent migration with `npm run db:migrate:undo`; `npm run db:migrate:undo:all` reverses every applied migration. Use only a disposable database for rollback testing. PostgreSQL credentials in Compose and `.env.example` are local development defaults, not production credentials. There is no `sequelize.sync()` or automatic schema mutation at startup.

The migrations create users and sessions, then add hashed identity OAuth transactions/audit events and GitHub App installation state, memberships, repository selections and webhook deliveries. GitHub identity sign-in is distinct from GitHub App authorization. GitHub App user/refresh tokens are encrypted server-side; no GitHub token is returned to the app. The app stores only opaque PocketOps sessions in Expo SecureStore. See [docs/DATABASE.md](docs/DATABASE.md) for migration and retention details.

## Checks

```bash
npm test
npm run lint
npm exec --workspace=mobile -- expo install --check
npm exec --workspace=mobile -- expo export --platform android --output-dir /tmp/pocketops-android
```

The migration integration test runs when `DATABASE_URL_TEST` points to a dedicated database whose name ends in `_test`; otherwise Vitest skips that database-dependent case. CI provisions an isolated PostgreSQL service and runs it.

## Structure and scope

- `mobile/app/`: Expo Router screens and native tabs
- `mobile/src/features/`: feature-specific UI and behavior as features are added
- `mobile/src/components/`, `hooks/`, `services/`, `theme/`: shared UI, hooks, API and style tokens
- `server/src/`: Express app, environment/configuration, database models/migrations, authentication modules and middleware
- `docs/`: product, architecture, API, database, security, setup and roadmap
- `prompts/`: milestone-specific implementation briefs

Native screens remain native; a WebView is reserved for the future source editor. Implemented: GitHub identity sign-in, PocketOps session hydration/rotation/logout, GitHub App connection/repository selection UX, authenticated read-only repository/tree/file/branch endpoints, signed webhook verification and durable PostgreSQL webhook processing. The mobile repository browsing screen remains a placeholder. Not implemented: repository writes, Render connections, source editing, deployments, incidents, notifications, Redis/BullMQ, or remote execution. Redis is not required by the current API or readiness check.

To enable identity sign-in, configure its five server-only OAuth variables. To enable GitHub App connections, register an App with read-only Contents and Metadata permissions and configure all `GITHUB_APP_*` variables plus a fresh token-encryption key. Apply migrations and use an Android/iOS development build with the `pocketops` app scheme. See [docs/SETUP.md](docs/SETUP.md). Never place provider credentials, private keys or tokens in an `EXPO_PUBLIC_*` variable.

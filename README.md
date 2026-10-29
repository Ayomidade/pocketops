# PocketOps

PocketOps is a native mobile incident-response product. The repository contains identity/session workflows, GitHub App repository browsing, a single-purpose source editor that creates fix branches, commits reviewed changes, and opens pull requests, plus Render connections, deployment history/logs and confirmed idempotent redeploy requests. It is not production-ready.

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

The migrations create users and sessions, then add hashed identity OAuth transactions/audit events, GitHub App state, webhook deliveries, durable editor operation/idempotency records and Render provider connections, projects, deployments and operation requests. The app stores only opaque PocketOps sessions in Expo SecureStore and encrypts short-lived editor drafts with a device-only key. See [docs/DATABASE.md](docs/DATABASE.md) for migration and retention details.

## Checks

```bash
npm test
npm run lint
npm run api:contract:check
npm exec --workspace=mobile -- expo install --check
npm exec --workspace=mobile -- expo export --platform android --output-dir /tmp/pocketops-android
```

The migration integration test runs when `DATABASE_URL_TEST` points to a dedicated database whose name ends in `_test`; otherwise Vitest skips that database-dependent case. CI provisions an isolated PostgreSQL service and runs it.

Lint covers both server and mobile JavaScript/JSX. The generated implemented API
contract is [docs/openapi.json](docs/openapi.json); update it with
`npm run api:contract`. The manually triggered `Native build validation` workflow
compiles Android debug and iOS simulator builds. See
[docs/OPERATIONS.md](docs/OPERATIONS.md) for device, provider and operational gates.

## Structure and scope

- `mobile/app/`: Expo Router screens and native tabs
- `mobile/src/features/`: feature-specific UI and behavior as features are added
- `mobile/src/components/`, `hooks/`, `services/`, `theme/`: shared UI, hooks, API and style tokens
- `server/src/`: Express app, environment/configuration, database models/migrations, authentication modules and middleware
- `docs/`: product, architecture, API, database, security, setup and roadmap

Native screens remain native; the source editor is the only WebView. Implemented: identity/session workflows, GitHub App connections, authorized repository browsing, bundled CodeMirror editing, safe fix-branch commits, pull-request creation, encrypted Render API-key connections, service-to-repository project mapping, bounded deployment history/logs and confirmed idempotent redeploy requests. Writes require separate GitHub App Contents: write and Pull requests: write permissions. Deployment operations additionally require `DEPLOYMENTS_ENABLED=true`, a provider encryption key ring and a separately running worker process (`npm run worker:deployments`); without the worker, accepted operations remain queued. See [docs/REPOSITORY_EXPLORER.md](docs/REPOSITORY_EXPLORER.md), [docs/CODE_EDITOR.md](docs/CODE_EDITOR.md) and [docs/SETUP.md](docs/SETUP.md). Incidents, notifications, health verification, Render webhooks and remote execution remain unimplemented.

To enable identity sign-in, configure its server-only OAuth variables. Browsing requires Contents: read and Metadata: read; editor writes additionally require Contents: write and Pull requests: write on the GitHub App. Configure all `GITHUB_APP_*` variables server-side, apply migrations and use a native development build. See [docs/SETUP.md](docs/SETUP.md). Never place provider credentials, private keys or tokens in an `EXPO_PUBLIC_*` variable.

See [manual Render deployment implementation and validation](docs/DEPLOYMENTS.md) for provider capabilities, worker safety, exact file inventory and remaining staging/device gates.

## Private beta hardening

The current candidate is **NO-GO**, with unresolved dependency and staging/device gates. See [review and evidence](docs/BETA_HARDENING.md), [beta operations/onboarding](docs/BETA_RUNBOOK.md), and [draft data-handling policy](docs/PRIVACY.md). No public release is authorized.

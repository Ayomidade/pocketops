# PocketOps

Native mobile incident response and repository repair. This is a **foundation scaffold**, not a finished production tool.

## Prerequisites

- Node.js 22+, npm, Android device with Expo Go or an Expo development build
- PostgreSQL 16+ (optional for the health endpoint; Docker Compose provided)
- Android phone and laptop on the same Wi-Fi network for local API access

## Quick start

```bash
npm install
cp server/.env.example server/.env
cp mobile/.env.example mobile/.env
# Edit mobile/.env: use your computer's LAN IP, not localhost, for a physical phone.
npm run api
# In a second terminal:
npm run mobile
```

Open the QR code in Expo Go, or use an Expo development build if required by installed native dependencies. If Expo warns about package version alignment, run `npx expo install --fix` from `mobile/` and recheck compatibility.

API health: `http://localhost:4000/api/v1/health`

## Database (optional for starter)

```bash
docker compose up -d postgres
```

The scaffold defines a Sequelize connection but does not connect on boot or create tables. Schema design is in `docs/DATABASE.md`; implement versioned migrations in Milestone 1. Never use `sequelize.sync({ alter: true })` in production.

## Tests

```bash
npm test
npm run lint
```

## Architecture

- `mobile/`: Expo Router + React Native + NativeWind native screens
- `server/`: Express API, future Sequelize models and integration modules
- `docs/`: requirements, architecture, security and development plan
- `prompts/`: milestone-specific Codex implementation briefs
- `AGENTS.md`: repository-wide engineering instructions

## Current functionality

Native tab navigation and placeholder screens; HTTP health endpoint; basic middleware and a Node test. **Not yet implemented:** OAuth, GitHub App, Render, code editor, database migrations, queue, push notifications, and cloud execution.

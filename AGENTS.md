# PocketOps — Codex instructions

You are working on a native mobile incident-response product. Follow the progressive MVP and `docs/` as the source of truth.

## Stack

- Mobile: React Native, Expo Router, JavaScript/JSX, NativeWind/Tailwind. No TypeScript unless requested.
- Backend: Node.js, Express, JavaScript ES modules, PostgreSQL, Sequelize.
- Native navigation, dashboards, notifications, deployment operations. WebView only for a dedicated code editor in a later milestone.
- Single npm-workspaces monorepo.

## Non-negotiable practices

1. Implement one milestone at a time. Never pretend unimplemented integrations work.
2. Keep controllers thin, business rules in services, database logic in repositories, provider calls in adapters.
3. Validate inputs, authenticate sessions, authorize every resource access, use safe errors and structured audit events.
4. Never expose GitHub installation tokens, Render keys, private keys or database secrets to the mobile bundle.
5. Git edits default to new branches and require expected file SHA to prevent lost updates.
6. Production mutations require explicit confirmation and idempotency keys; 202 means accepted, not recovered.
7. Use versioned Sequelize migrations; no auto-sync in production.
8. Use plain JavaScript and avoid adding dependencies unless justified. Keep styling consistent with NativeWind.
9. Tests and docs must accompany meaningful changes. Run `npm test` and `npm run lint`; report anything not verified.
10. Do not implement remote execution or shell access in MVP.

## Work procedure

Before editing, inspect the relevant docs and existing code. State a short plan. Make focused changes, run checks, summarize changed files and remaining limitations.

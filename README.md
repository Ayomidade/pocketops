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

Native screens remain native; the source editor is the only WebView. Implemented: identity/session workflows, GitHub App connections, authorized repository browsing, bundled CodeMirror editing, safe fix-branch commits, pull-request creation, encrypted Render API-key connections, service-to-repository project mapping, bounded deployment history/logs and confirmed idempotent redeploy requests. Writes require separate GitHub App Contents: write and Pull requests: write permissions. Deployment operations additionally require `DEPLOYMENTS_ENABLED=true`, a provider encryption key ring and a separately running worker process (`npm run worker:deployments`); without the worker, accepted operations remain queued. See [docs/REPOSITORY_EXPLORER.md](docs/REPOSITORY_EXPLORER.md), [docs/CODE_EDITOR.md](docs/CODE_EDITOR.md) and [docs/SETUP.md](docs/SETUP.md). Incidents, notifications, and health verification are implemented (migration `007-create-incidents`, `POST/GET/PATCH /api/v1/incidents*`, health-check and monitor routes, mobile incident screens). Optional signed Render webhooks schedule authorized incident reconciliation; remote execution remains excluded. See [incident setup and recovery drill](docs/INCIDENTS.md). A new APK and FCM setup are required for push; live staging acceptance remains pending.

To enable identity sign-in, configure its server-only OAuth variables. Browsing requires Contents: read and Metadata: read; editor writes additionally require Contents: write and Pull requests: write on the GitHub App. Configure all `GITHUB_APP_*` variables server-side, apply migrations and use a native development build. See [docs/SETUP.md](docs/SETUP.md). Never place provider credentials, private keys or tokens in an `EXPO_PUBLIC_*` variable.

See [manual Render deployment implementation and validation](docs/DEPLOYMENTS.md) for provider capabilities, worker safety, exact file inventory and remaining staging/device gates.

## Private beta hardening

The current candidate is **NO-GO**, with unresolved dependency and staging/device gates. See [review and evidence](docs/BETA_HARDENING.md), [beta operations/onboarding](docs/BETA_RUNBOOK.md), and [draft data-handling policy](docs/PRIVACY.md). No public release is authorized.


The next priority should be usability and polish before adding more features:
1. Fix deployment-log access: make logs easy to find from a project or deployment, with clear loading, empty, failure and retry states.
2. Improve navigation: predictable back behavior, clear screen titles, visible current repository/branch/project, and fewer dead ends.
3. Standardize the UI: apply the agreed dark palette consistently, improve spacing and typography, and unify buttons, cards, forms and status indicators.
4. Improve accessibility: screen-reader labels, readable contrast, comfortable touch targets, keyboard handling and text scaling.
5. Review unavailable features: remove misleading actions; explain genuine prerequisites where a feature needs configuration.
6. Retest on Android: complete the browse → edit → PR → deployment → logs journey, including slow connections and expired sessions.

PocketOps should feel like a focused developer tool: GitHub-inspired structure, readable code and clear operational status, with its own identity. The redesign should cover navigation and screen layouts alongside colors and fonts.
Theme
Use a neutral charcoal base, restrained blue accents and subtle borders. Reserve status colors for meaningful states.
Token	Dark theme	Use
Background	#0D1117	Screen background
Surface	#161B22	Cards, sheets, inputs
Raised surface	#21262D	Selected rows, menus
Border	#30363D	Dividers and outlines
Primary text	#F0F6FC	Titles and important values
Secondary text	#B1BAC4	Descriptions and labels
Muted text	#919BA6	Supporting metadata
Accent	#58A6FF	Links and active navigation
Primary button	#1F6FEB	Main action, with white text
Success	#3FB950	Successful deployment, resolved
Warning	#D29922	Pending approval, degraded
Danger	#F85149	Failed deployment, critical incident
Information	#79C0FF	Building, investigating


These are proposed tokens; contrast needs checking against the actual backgrounds and text sizes. Every status should include a label or icon.
Typography
Use the native system font for navigation, forms and content: Roboto on Android and San Francisco on iOS. This keeps the interface familiar and respects accessibility settings.
Use JetBrains Mono for code previews, logs, SHAs and the editor, bundled locally.
Element	Suggested size
Screen title	24–28
Section heading	18–20
Body and controls	16
Supporting metadata	13–14
Code and logs	13–14, with adjustable sizing


Avoid excessive bold text, tiny labels and large decorative headings.
Application structure
Use four bottom tabs:
- Overview: active incidents, recent deployment activity and connected-project summary.
- Repositories: repository search, branches, files and PR workflow.
- Projects: Render services, deployment history, details and logs.
- Incidents: severity, status, timeline and recovery actions.
Put Connections, notification preferences and account settings behind the profile button. Keep repository browsing, editing and deployment details in native navigation stacks with predictable back behavior.
Show only implemented actions. Features requiring configuration should explain the prerequisite and provide a useful next step.
Screen design
- Repositories: compact rows with repository name, owner, visibility and branch context. Use separators instead of wrapping every item in a large card.
- File browser: folders first, consistent file icons, readable names and horizontal breadcrumbs. Keep the selected branch visible.
- Editor: prioritize editing space; keep file, branch, dirty state and review action accessible.
- Projects: service name, connection state and latest deployment status at a glance.
- Deployment detail: a clear status summary followed by Logs, with refresh, filtering, timestamps and selectable text. Distinguish build logs from runtime logs where supported.
- Incidents: severity and lifecycle labels, concise summaries and a chronological timeline.
Interaction and accessibility
Use a consistent icon family, 48px touch targets, visible pressed/disabled states and safe-area spacing. Support text scaling, screen readers and reduced motion. Preserve Android’s system back behavior. Keep destructive or production-affecting actions behind clear confirmations.
Loading skeletons should match the screen layout. Offline and error messages should preserve useful context and offer retry without replacing the entire screen unnecessarily.
Implementation order
1. Introduce shared color, typography, spacing and component tokens.
2. Redesign the app shell, navigation and reusable controls.
3. Redesign Repositories and Projects, making deployment logs directly accessible.
4. Apply the system to editor/PR flows, incidents and settings.
5. Validate accessibility and the complete workflow on your Android phone.
The intended result is a compact, polished operational app: familiar to GitHub users, with deployment and incident information easy to scan and act on.
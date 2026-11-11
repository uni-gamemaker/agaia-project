# Ajaia Collaborative Editor

A lightweight collaborative document editor with server-persisted rich-text documents,
owner/editor/viewer sharing, and `.txt` or Markdown import.

## Features

- Create, rename, edit, save, and reopen documents.
- Format text as bold, italic, underlined, headings, and bulleted or numbered lists.
- Import `.txt`, `.md`, and `.markdown` files up to 1 MB. The server validates and
  converts the file; uploaded HTML is not rendered as trusted content.
- See documents you own and documents shared with you.
- Share with a known workspace user as an editor or viewer. Owners manage access;
  viewers are read-only. The server enforces every permission.
- See saving, saved, and failed states. Failed saves can be retried, and the browser
  keeps a local draft for recovery on that device.

Document content is stored as structured TipTap-shaped JSON in Turso/libSQL. The UI uses
the existing API routes in this repository; it does not provide live simultaneous editing.

## Current release status

The Turso/libSQL adapter, local SQLite fallback, and generated migrations are configured.
The 35-test suite, typecheck, lint, Webpack build, local migration/seed, and 25-check API
smoke test have passed against local SQLite. A remote Turso connection and Vercel release
still require fresh credentials and environment configuration.

## Requirements

- Node.js 20.11 or newer (the project was developed with Node.js 24)
- npm 10 or newer
- A Turso database for shared development/production data, or local SQLite for offline
  development and tests

The checked-in `package-lock.json` supports reproducible installation with `npm ci`.

## Local setup

### 1. Install packages

From the project directory:

```powershell
npm ci
```

### 2. Configure environment

Copy the sample file and keep the resulting `.env.local` private:

```powershell
Copy-Item .env.example .env.local
```

For Turso, set the database URL and a newly-created auth token in `.env.local`:

```dotenv
TURSO_DATABASE_URL=libsql://your-database-your-org.turso.io
TURSO_AUTH_TOKEN=your-private-token
DEMO_MODE=true
```

If the Turso variables are omitted, the app uses a local SQLite file named
`ajaia-local.db`. Tests use a separate local file and never connect to production. The
`.env.local` file is git-ignored; never commit database tokens.

| Variable | Purpose | Default |
|---|---|---|
| `TURSO_DATABASE_URL` | Turso/libSQL connection URL | Local SQLite by default |
| `TURSO_AUTH_TOKEN` | Turso database token | Not needed for local SQLite |
| `TEST_TURSO_DATABASE_URL` | Optional isolated test URL | Local SQLite by default |
| `DEMO_MODE` | Enables the demo account switcher | `false` |
| `MAX_UPLOAD_BYTES` | Maximum import file size | `1048576` (1 MB) |
| `SESSION_TTL_DAYS` | Session lifetime | `7` |
| `NODE_ENV` | Runtime mode set by Next.js | Set by runtime |

### 3. Apply schema and seed demo users

```powershell
npm run db:migrate
npm run db:seed
```

### 4. Run the app

```powershell
npm run dev
```

The development script uses Next.js Webpack mode for compatibility with Windows setups
that deny Turbopack's junction creation. Open the exact URL printed in the terminal.
If port `3000` is already occupied, Next.js selects another port (commonly `3001`). Use
that printed port, rather than opening a stale server on `3000`.

The project allows the local browser host `192.168.56.1` for development resources. If
you access the dev server through a different LAN host, add that host to
`allowedDevOrigins` in `next.config.ts` and restart the dev server.

## Vercel public demo deployment

Connect `uni-gamemaker/agaia-project` to the Vercel project and add these environment
variables for Preview and Production:

| Variable | Value |
|---|---|
| `TURSO_DATABASE_URL` | Your Turso `libsql://...` database URL |
| `TURSO_AUTH_TOKEN` | A newly rotated Turso database token |
| `DEMO_MODE` | `true` for the requested public demo |

`vercel.json` runs `npm run vercel-build`, which validates the Turso settings, applies
Drizzle migrations, idempotently seeds the two demo accounts, and builds Next.js. Since
this deployment uses public demo accounts rather than real authentication, anyone can
enter as Alex or Sam; use demo content only and do not store private documents.

## Demo accounts

With `DEMO_MODE=true`, the start screen offers these seeded accounts. There are no
passwords; the public demo switcher is **not production authentication**.

| Email | Display name | Seeded role |
|---|---|---|
| `alex@demo.local` | Alex Demo | Owner of documents Alex creates |
| `sam@demo.local` | Sam Demo | Collaborator; receives access when a document is shared |

You can share only with users already present in the workspace. The demo seed creates the
two accounts above.

## API overview

All routes use JSON except file import, which uses `multipart/form-data`.

| Method | Route | Access |
|---|---|---|
| `GET` | `/api/health` | Public; reports database availability |
| `POST` | `/api/auth/demo-login` | Demo mode only; sets an httpOnly session cookie |
| `POST` | `/api/auth/logout` | Current session |
| `GET` | `/api/me` | Current session |
| `GET` | `/api/documents` | Current session; owned and shared list |
| `POST` | `/api/documents` | Current session; creates an owned document |
| `GET` | `/api/documents/:id` | Owner or member |
| `PATCH` | `/api/documents/:id` | Owner or editor |
| `DELETE` | `/api/documents/:id` | Owner only |
| `GET` | `/api/documents/:id/members` | Document member |
| `POST` | `/api/documents/:id/members` | Owner only; share by known email |
| `PATCH` | `/api/documents/:id/members/:userId` | Owner only; change role |
| `DELETE` | `/api/documents/:id/members/:userId` | Owner only; remove member |
| `POST` | `/api/documents/import` | Current session; imports `.txt` or Markdown |

The owner can edit, rename, delete, and manage sharing. Editors can edit and rename.
Viewers can read only. Non-members receive `404` for document reads and mutations to
avoid disclosing whether a document exists. Full request/response shapes, error codes,
The API enforces document ownership and membership on the server.

## Checks

Run these from the project directory:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` migrates and uses a disposable local SQLite file. It does not access or clear
the configured Turso database.

The end-to-end API smoke check expects a production server and seeded database. In one
terminal:

```powershell
npm run build
npm start
```

In another terminal:

```powershell
npm run smoke
```

The smoke script defaults to `http://localhost:3000`. If the server prints another port,
set `SMOKE_BASE_URL` first, for example in PowerShell:

```powershell
$env:SMOKE_BASE_URL = 'http://localhost:3001'
npm run smoke
```

## Troubleshooting

**The page stays on “Opening your workspace…”**

Stop the old dev server with Ctrl+C and rerun `npm run dev`. Use the new URL printed by
Next.js. The dev script uses Webpack to avoid the Windows Turbopack junction error. Check
`http://localhost:<port>/api/health`; it should return HTTP 200 and `database: "up"`.
If the database is down, check `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env.local`.

**Port 3000 is already in use**

Use the alternate URL printed by Next.js, or stop the older process that owns port 3000.
Do not keep opening the old port if the current dev server chose a new one.

**Demo login reports it is disabled**

Set `DEMO_MODE=true` in `.env.local`, restart the dev server, and make sure the demo seed
has been applied with `npm run db:seed`.

## Project files

```text
app/                 Next.js app, UI, and API route handlers
lib/db/              Drizzle schema, migrations, client, and seed helpers
lib/server/          Auth, authorization, document services, import, and HTTP helpers
drizzle/turso/       Turso/libSQL migrations
scripts/             Migration, seed, and API smoke scripts
tests/               Persistence, authorization, import, and Markdown tests
```

Internal planning, security, and handoff documents are excluded from this public demo
repository. No walkthrough URL is claimed until one has been created and verified.

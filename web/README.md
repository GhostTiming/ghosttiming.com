# Chip Streamer Cloud (Next.js + Neon)

Read-only browser dashboard for live RFID reads. Timers publish from the local
desktop app; this service stores normalized reads in Neon and renders a remote
viewer that mirrors workspace layout/state.

## Architecture

- API ingest:
  - `POST /api/ingest/<shortId>/reads` writes reads + aggregate counters.
  - `POST /api/ingest/<shortId>/state` updates event/workspace/mapping state.
- API read paths:
  - `GET /api/events/<shortId>/snapshot` for DB-backed state.
  - `GET /api/events/<shortId>/stream` for low-latency SSE updates.
- Viewer UI:
  - `EventDashboard` renders workspace-aware heatmap/chart + per-antenna status.
  - Uses SSE first with polling fallback.
- DB schema:
  - Event metadata, raw reads, MAC+port aggregates, timer workspace payloads.

## Prerequisites

- Node 18+
- A [Neon](https://neon.tech) Postgres database
- A Vercel project connected to this Git repo

### Deploy from the repo root (recommended)

The repository includes a root [`package.json`](../package.json) with **npm workspaces** so `npm install` / `npm run build` run the Next.js app inside `web/`. Point Vercel at the **repository root** (leave **Root Directory** empty)—then deploy. Env vars stay the same (`DATABASE_URL`, etc.).

### Deploy only the `web/` folder

Alternatively, in Vercel → Project → **Settings → General → Root Directory**, set **`web`**, then redeploy. If Root Directory was wrong, you’ll get **`404 NOT_FOUND`** on `/api/health` because Vercel never shipped this Next.js app.

### Troubleshooting `404 NOT_FOUND` on `/api/health`

1. Confirm the deployment **build logs** show a Next.js build and routes like `/api/health`.
2. Set **Root Directory** to `web` **or** deploy from repo root **with** the root `package.json` workspaces (above).
3. Trigger a fresh **Redeploy** after fixing settings.

## Environment variables

Set these in Vercel (**Settings → Environment Variables**) and locally in `web/.env.local`:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon connection string (pooler URL recommended for serverless). |
| `SESSION_SECRET` | Yes | Long random string used to sign viewer session cookies (min ~16 chars). |
| `CRON_SECRET` | Optional | If set, `/api/cron/cleanup` requires `Authorization: Bearer <CRON_SECRET>`. Omit for development; protect in production or remove cron in `vercel.json`. |
| `NEXT_PUBLIC_APP_URL` | Optional | Public site URL (e.g. `https://your-app.vercel.app`). Returned in `POST /api/events` as `shareUrl`; viewers can use any valid base URL in the desktop app regardless. |

Copy from `.env.example` and fill values.

## Database migrations

From this directory:

```bash
npm install
# Set DATABASE_URL for Drizzle
npx drizzle-kit push
```

**Windows PowerShell 5.x:** use `;` instead of `&&` (e.g. `cd web; npm install; npx drizzle-kit push`), or run each command on its own line. PowerShell 7+ supports `&&`.

**Env file name:** variables must live in **`web/.env.local`** or **`web/.env`** (leading dot — not `env.local`). `drizzle.config.ts` loads both so `npx drizzle-kit push` picks up `DATABASE_URL` the same way as Next.js dev/build.

Alternatively apply the SQL under `drizzle/` manually in the Neon SQL editor.
Latest cleanup migration: `drizzle/0001_race_day_cleanup.sql`.

## Local development

```bash
npm run dev
```

Open `http://localhost:3000`. Health: `http://localhost:3000/api/health`.

Create an event with:

```bash
curl -s -X POST http://localhost:3000/api/events -H "Content-Type: application/json" -d "{\"name\":\"Test\"}"
```

Use returned `shortId`, `ingestToken`, `viewerPassword`, and `shareUrl`.

## Desktop publishing

In **Chip Streamer**, set **Cloud URL** to this app’s origin, **Save URL**, **New…** to create an event (or paste tokens from another machine), enable **Publish**, and run ingest. Configuration is stored in `%USERPROFILE%\.chip_streamer\cloud.json` (each machine keeps its own ingest tokens and event list).

## API overview

- `POST /api/events` — create event; returns credentials once.
- `POST /api/ingest/<shortId>/reads` — `Authorization: Bearer <ingest_token>`; batched reads.
- `POST /api/ingest/<shortId>/state` — same auth; event name, MAC friendly names, timer workspaces.
- `POST /api/events/<shortId>/unlock` — viewer password → session cookie.
- `GET /api/events/<shortId>/snapshot` — authenticated snapshot.
- `GET /api/events/<shortId>/stream` — SSE (Edge) for live updates.
- `GET /api/cron/cleanup` — optional scheduled cleanup of idle/old events.

## Limits (v1)

- Ingest batches max 500 rows; server-side soft rate cap per event.
- Creation: soft limit on events created per IP per hour (see `POST /api/events`).
- Cron (in `vercel.json`): daily path to cleanup; requires `CRON_SECRET` if you enable auth on that route.

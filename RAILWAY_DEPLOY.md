# Deploying ForgeCloud to Railway

This guide walks you through deploying the ForgeCloud TanStack Start app to [Railway](https://railway.com). The app is a Bun-built TanStack Start (React 19) server with a SQLite database and optional Anthropic AI integration.

## Table of contents

- [Prerequisites](#prerequisites)
- [One-click deploy](#one-click-deploy)
- [Environment variables](#environment-variables)
- [Persistent storage for SQLite](#persistent-storage-for-sqlite)
- [Build & start commands](#build--start-commands)
- [Health check](#health-check)
- [Deployment steps](#deployment-steps)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- A [Railway account](https://railway.com) (free tier works)
- A [GitHub](https://github.com) account with this repo pushed
- (Optional) An [Anthropic API key](https://console.anthropic.com) for AI agent features

## One-click deploy

Click the button below to deploy this app to Railway in one step.

> **Note:** you will still need to add the environment variables listed in [Environment variables](#environment-variables) after the initial deploy, and attach a persistent volume to keep the SQLite database alive between deploys (see [Persistent storage for SQLite](#persistent-storage-for-sqlite)).

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Fforgecloud%2Fpalembang)

If the button doesn't work, use the manual steps below.

## Environment variables

Set these in the Railway dashboard under **Variables** for your service. Copy them from your local `.env` or `.env.local` if you have one.

| Variable | Required | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Optional | Anthropic API key. Enables AI agent intelligence (chat, task generation, etc). Without it, the app runs in read-only mode. |
| `INSFORGE_DB_PATH` | Recommended | Absolute path to the SQLite database file. Set this to a path on a [persistent Railway volume](#persistent-storage-for-sqlite), e.g. `/data/forgecloud.sqlite`. If unset, the app falls back to `<cwd>/.data/forgecloud.sqlite` which is **lost on every redeploy**. |
| `PORT` | Auto | Railway sets this automatically. Defaults to `3000` if not set. |
| `NODE_ENV` | Recommended | Set to `production` for the production server. Nixpacks sets this by default. |
| `HOST` | Optional | Defaults to `0.0.0.0`. Only change if you know why. |

## Persistent storage for SQLite

The app uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for its local database — workspaces, projects, tasks, agents, PRs, chat messages, etc. all live in a single SQLite file. **Railway's filesystem is ephemeral by default**: every redeploy wipes anything written to the container's root filesystem. You have two options.

### Option A: Add a Railway volume (simplest)

1. In the Railway dashboard, go to your service.
2. Click **Settings → Volumes → + New Volume**.
3. Mount it at `/data`.
4. Set the `INSFORGE_DB_PATH` variable to `/data/forgecloud.sqlite`.

That's it. The database file will persist across redeploys as long as the volume stays attached.

### Option B: Switch to Postgres (recommended for production)

SQLite is fine for a single-tenant demo, but if you expect concurrent writes, multiple instances, or want managed backups, switch to Postgres:

1. Add a **PostgreSQL** plugin from the Railway marketplace.
2. Provision it; Railway injects a `DATABASE_URL` variable.
3. Migrate the schema in `src/lib/db.ts` from `better-sqlite3` to a Postgres driver (e.g. [`postgres`](https://github.com/porsager/postgres) or [`drizzle-orm`](https://orm.drizzle.team/)).
4. Update queries in `src/routes/api/*` and `src/lib/*` to use the new driver.

This is a one-time refactor; the rest of the app is database-agnostic.

## Build & start commands

Railway's [Nixpacks](https://nixpacks.com) builder auto-detects Bun from `bun.lock` and the start command from the Nixpacks / Railway config. Here is what runs:

| Phase | Command | Source |
| --- | --- | --- |
| **Install** | `bun install --frozen-lockfile` | `nixpacks.toml` |
| **Build** | `bun run build` (runs `vite build`) | `nixpacks.toml` |
| **Start** | `node server-entry.mjs` | `nixpacks.toml` / `railway.json` / `Procfile` |

The `start` script in `package.json` (`bun run start`) is equivalent to `node server-entry.mjs`.

### How the production server works

`vite build` produces two outputs in `dist/`:

- `dist/client/` — static client assets (JS, CSS, images) served by the HTTP server.
- `dist/server/server.js` — a Nitro/TanStack Start module that exports a `fetch` handler.

`server-entry.mjs` is a thin Node.js HTTP adapter that:

1. Serves static files from `dist/client/` directly (faster than round-tripping through SSR).
2. Forwards every other request (pages, API routes, server functions) to the `fetch` handler exported by `dist/server/server.js`.

This is the standard pattern for running a Nitro `fetch`-style server entry on a long-running Node process.

## Health check

- **Path:** `/`
- **Timeout:** 100 seconds
- **Method:** GET (default)

Railway will mark the deploy as healthy when the root URL returns a 2xx response. If the health check fails, the deploy rolls back automatically.

## Deployment steps

### Manual deploy

1. **Create a new Railway project**
   - Go to [railway.com/new](https://railway.com/new).
   - Click **Deploy from GitHub repo**.
   - Select `forgecloud/palembang` (or your fork).

2. **Railway auto-detects the build**
   - Nixpacks sees `bun.lock` and uses the Bun buildpack.
   - `nixpacks.toml` configures the install/build/start commands.
   - First build takes ~2-3 minutes (installs `better-sqlite3` native deps).

3. **Add environment variables**
   - Go to **Variables** on your service.
   - Add `ANTHROPIC_API_KEY` (if you want AI features).
   - Skip `INSFORGE_DB_PATH` for now if you want to test the deploy first (the app will run but lose data on redeploy).

4. **Attach a persistent volume** (see [Persistent storage for SQLite](#persistent-storage-for-sqlite))
   - **Settings → Volumes → + New Volume → Mount path: `/data`**.
   - Add `INSFORGE_DB_PATH=/data/forgecloud.sqlite` to the service variables.

5. **Generate a domain**
   - **Settings → Networking → Generate Domain**.
   - Railway gives you a `*.up.railway.app` URL.

6. **Verify**
   - Open the generated domain — you should see the ForgeCloud dashboard.
   - Create a workspace, add a project, and check that it persists after a redeploy.

### Subsequent deploys

Railway auto-deploys on every push to the default branch. For PR previews, enable **PR Deployments** in **Settings → Deploy**.

## Troubleshooting

### Build fails on `better-sqlite3`

This is a native module. Nixpacks' Bun builder includes the build toolchain, so it should compile from source on the Railway image. If it fails:

- Check the build logs for the exact error.
- Make sure `python3`, `make`, and `g++` are available. Nixpacks includes these by default for the Bun builder; if you switch to the Node builder, you may need to add them to `nixpacks.toml` under `[phases.setup] nixPkgs`.

### App crashes with "Cannot find module './dist/server/server.js'"

The build didn't run, or `dist/` isn't in the deploy. Verify:

- `nixpacks.toml` has the build phase defined.
- The build log shows `bun run build` completing successfully.
- The container's `dist/server/server.js` exists in the shell (use Railway's **Shell** tab).

### App starts but the dashboard is blank

Open the browser dev tools and check the **Network** tab. If you see 500s on the initial HTML:

- Check the **Logs** tab for SSR errors. The `errorMiddleware` in `src/start.ts` catches them and renders a fallback page.
- If the error mentions `better-sqlite3`, the SQLite file path is wrong or the volume isn't mounted. Check `INSFORGE_DB_PATH` and the volume mount path.

### Health check fails

The health check path is `/`. If you're getting timeouts:

- Make sure the `server-entry.mjs` bind address is `0.0.0.0` (not `localhost` or `127.0.0.1`).
- Check the start command in `railway.json` matches `node server-entry.mjs`.

### Data lost after redeploy

You didn't attach a volume, or `INSFORGE_DB_PATH` isn't pointing to it. See [Persistent storage for SQLite](#persistent-storage-for-sqlite).

## Files added for Railway

- `railway.json` — JSON service config (start command, health check, restart policy).
- `railway.toml` — TOML service config (same as `railway.json`, Railway prefers this if present).
- `nixpacks.toml` — Nixpacks build config (phases, start command, env defaults).
- `Procfile` — Heroku-style fallback (`web: node server-entry.mjs`).
- `server-entry.mjs` — Node HTTP server that wraps the Nitro `fetch` handler.
- `package.json` — added `start` script.

## References

- [Railway docs](https://docs.railway.com)
- [Nixpacks docs](https://nixpacks.com/docs)
- [TanStack Start docs](https://tanstack.com/start)

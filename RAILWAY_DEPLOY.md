# Deploying ForgeCloud to Railway

This guide walks you through deploying the ForgeCloud TanStack Start app to [Railway](https://railway.com). The production target is the Docker-based Node server in this repo, with SQLite on a mounted Railway volume and optional MiniMax/Anthropic AI.

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
- (Optional) a MiniMax or Anthropic API key for live AI agent features

## One-click deploy

Click the button below to deploy this app to Railway in one step.

> **Note:** you will still need to add the environment variables listed in [Environment variables](#environment-variables) after the initial deploy, and attach a persistent volume to keep the SQLite database alive between deploys (see [Persistent storage for SQLite](#persistent-storage-for-sqlite)).

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Fforgecloud%2Fpalembang)

If the button doesn't work, use the manual steps below.

## Environment variables

Set these in the Railway dashboard under **Variables** for your service. Copy them from your local `.env` or `.env.local` if you have one.

| Variable                                  | Required                            | Description                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MINIMAX_API_KEY`                         | Optional                            | MiniMax API key. Enables the primary AI provider when `AI_PROVIDER=minimax`. Without any provider key, the app uses deterministic template responses.                                                                                                                                                                       |
| `ANTHROPIC_API_KEY`                       | Optional                            | Anthropic API key. Can be used as the active provider or fallback.                                                                                                                                                                                                                                                          |
| `AI_PROVIDER`                             | Optional                            | `minimax`, `anthropic`, or `fallback`. Defaults to the first configured provider.                                                                                                                                                                                                                                           |
| `AUTH_SESSION_SECRET`                     | Required                            | Long random secret used to sign `fc_session` cookies and `x-forgecloud-session` tokens. Required because the Docker image runs with `NODE_ENV=production`.                                                                                                                                                                  |
| `AUTH_LOGIN_WEBHOOK_URL`                  | Required                            | Webhook used to deliver passwordless login codes in production. Do not use `AUTH_LOGIN_RETURN_CODE=true` for real teams.                                                                                                                                                                                                    |
| `ALLOW_DEV_AUTH_FALLBACK`                 | Local only                          | Leave `false` in every deployed environment. Enables unsigned seeded-owner access for local development only.                                                                                                                                                                                                               |
| `INSFORGE_DB_PATH`                        | Recommended                         | Absolute path to the SQLite database file. Set this to a path on a [persistent Railway volume](#persistent-storage-for-sqlite), e.g. `/data/forgecloud.sqlite`. If unset, the app falls back to `<cwd>/.data/forgecloud.sqlite` which is **lost on every redeploy**.                                                        |
| `FORGECLOUD_RUNTIME_ARTIFACT_DIR`         | Recommended                         | Directory for generated runtime artifacts and manifests. Set this to `/data/runtime-artifacts` on the same mounted volume. If unset, it defaults next to `INSFORGE_DB_PATH` when that is set.                                                                                                                               |
| `FORGECLOUD_DEPLOY_MODE`                  | Required for real teams             | Set to `production` for customer-facing deployments. In production mode, ForgeCloud blocks production deploys unless a real provider hook and public URL are configured.                                                                                                                                                    |
| `FORGECLOUD_DEPLOY_PROVIDER`              | Required for real teams             | Set to `railway` or `cloudflare`. Railway is the full-stack default for this repo.                                                                                                                                                                                                                                          |
| `RAILWAY_DEPLOY_HOOK_URL`                 | Required when provider is `railway` | Railway deploy hook URL for the service that should be redeployed by ForgeCloud's production deploy action.                                                                                                                                                                                                                 |
| `RAILWAY_SERVICE_URL` or `PUBLIC_APP_URL` | Required when provider is `railway` | Stable public URL shown in deployment history after a provider hook succeeds.                                                                                                                                                                                                                                               |
| `DEPLOY_HOOK_TOKEN`                       | Optional                            | Shared secret sent as an `Authorization: Bearer ...` header when calling the deploy hook.                                                                                                                                                                                                                                   |
| `FORGECLOUD_ALLOWED_ORIGINS`              | Split frontend only                 | Comma-separated frontend origins allowed to call this API with credentials. `PUBLIC_APP_URL`, `RAILWAY_SERVICE_URL`, and `CLOUDFLARE_PROJECT_URL` are allowed automatically when set. If one of those URLs is a Cloudflare Pages project domain, one-level preview deploy subdomains for the same project are also allowed. |
| `FORGECLOUD_ENABLE_FAILURE_INJECTION`     | Optional                            | Defaults to disabled in production deploy mode. Set to `true` only for demo/staging environments where failure-injection buttons should remain available.                                                                                                                                                                   |
| `ENABLE_DEMO_ENDPOINTS`                   | Demo/staging only                   | Leave `false` for real teams. Enables destructive demo seed/reset endpoints when `NODE_ENV=production`.                                                                                                                                                                                                                     |
| `FORGECLOUD_REQUIRE_LIVE_STACK`           | Required for real stack production  | Set to `true` when ForgeCloud must fail `/api/health` unless Butterbase, XTrace, Composio, and Rocket Ride are all configured live. Leave `false` only for local demos or mock-stack smoke runs.                                                                                                                            |
| `ROCKETRIDE_WORKFLOW_URL`                 | Optional until live agent handoff   | Rocket Ride workflow endpoint. When unset, ForgeCloud uses the local orchestrator and records Rocket Ride runs in simulation mode.                                                                                                                                                                                          |
| `ROCKETRIDE_API_KEY`                      | Required with Rocket Ride URL       | Bearer token for the Rocket Ride workflow endpoint.                                                                                                                                                                                                                                                                         |
| `BUTTERBASE_PROJECT_URL`                  | Required for remote Butterbase      | Butterbase project URL. Remote mode currently expects a ForgeCloud-compatible table API under `/api/forgecloud/*`; when unset, local SQLite remains the Butterbase-compatible source of truth.                                                                                                                              |
| `BUTTERBASE_API_KEY`                      | Required with Butterbase URL        | Bearer token used for Butterbase health and table calls.                                                                                                                                                                                                                                                                    |
| `XTRACE_MEMORY_URL`                       | Optional until live memory handoff  | XTrace memory endpoint. When unset, ForgeCloud stores memory locally in `memory_entries` and uses that for Plain-English Blame provenance.                                                                                                                                                                                  |
| `XTRACE_API_KEY`                          | Required with XTrace URL            | Bearer token for XTrace memory writes/searches.                                                                                                                                                                                                                                                                             |
| `COMPOSIO_API_KEY`                        | Optional until live connections     | Composio API key for live connected-account links and scans. Required when `FORGECLOUD_REQUIRE_LIVE_STACK=true`. When unset, ForgeCloud runs deterministic demo connectors.                                                                                                                                                 |
| `COMPOSIO_BASE_URL`                       | Optional                            | Defaults to `https://backend.composio.dev/api/v3.1`.                                                                                                                                                                                                                                                                        |
| `COMPOSIO_USER_PREFIX`                    | Optional                            | Prefix used to build stable Composio user IDs per workspace. Defaults to `forgecloud`.                                                                                                                                                                                                                                      |
| `COMPOSIO_*_AUTH_CONFIG_ID`               | Required per live connector         | Set provider auth config IDs for live OAuth links, e.g. `COMPOSIO_GMAIL_AUTH_CONFIG_ID`, `COMPOSIO_SLACK_AUTH_CONFIG_ID`, `COMPOSIO_STRIPE_AUTH_CONFIG_ID`, `COMPOSIO_NOTION_AUTH_CONFIG_ID`, `COMPOSIO_HUBSPOT_AUTH_CONFIG_ID`, `COMPOSIO_SHOPIFY_AUTH_CONFIG_ID`.                                                         |
| `COMPOSIO_WEBHOOK_URL`                    | Optional                            | Optional internal stack event sink for Composio activity events. Live Composio readiness is based on `COMPOSIO_API_KEY` plus provider auth config IDs, not this webhook.                                                                                                                                                    |
| `PORT`                                    | Auto                                | Railway sets this automatically. Defaults to `3000` if not set.                                                                                                                                                                                                                                                             |
| `NODE_ENV`                                | Auto                                | The Dockerfile sets this to `production`.                                                                                                                                                                                                                                                                                   |
| `HOST`                                    | Optional                            | Defaults to `0.0.0.0`. Only change if you know why.                                                                                                                                                                                                                                                                         |

## Persistent storage for SQLite

The app uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for its local database — workspaces, projects, tasks, agents, PRs, chat messages, etc. all live in a single SQLite file. **Railway's filesystem is ephemeral by default**: every redeploy wipes anything written to the container's root filesystem. You have two options.

### Option A: Add a Railway volume (simplest)

1. In the Railway dashboard, go to your service.
2. Click **Settings → Volumes → + New Volume**.
3. Mount it at `/data`.
4. Set the `INSFORGE_DB_PATH` variable to `/data/forgecloud.sqlite`.
5. Set `FORGECLOUD_RUNTIME_ARTIFACT_DIR=/data/runtime-artifacts`.

That's it. The database file will persist across redeploys as long as the volume stays attached.

### Option B: Switch to Postgres (recommended for production)

SQLite is fine for a single-tenant demo, but if you expect concurrent writes, multiple instances, or want managed backups, switch to Postgres:

1. Add a **PostgreSQL** plugin from the Railway marketplace.
2. Provision it; Railway injects a `DATABASE_URL` variable.
3. Migrate the schema in `src/lib/db.ts` from `better-sqlite3` to a Postgres driver (e.g. [`postgres`](https://github.com/porsager/postgres) or [`drizzle-orm`](https://orm.drizzle.team/)).
4. Update queries in `src/routes/api/*` and `src/lib/*` to use the new driver.

This is a one-time refactor; the rest of the app is database-agnostic.

## Build & start commands

Railway uses the checked-in Dockerfile. Do not switch this back to Bun/Nixpacks unless you also re-prove `better-sqlite3` native module loading in the Railway image.

| Phase       | Command                                        | Source                                         |
| ----------- | ---------------------------------------------- | ---------------------------------------------- |
| **Install** | `npm install --include=dev --legacy-peer-deps` | `Dockerfile`                                   |
| **Build**   | `npm run build`                                | `Dockerfile`                                   |
| **Start**   | `node server-entry.mjs`                        | `Dockerfile` / `railway.toml` / `railway.json` |

The `start` script in `package.json` is equivalent to `node server-entry.mjs`.

### How the production server works

`vite build` produces two outputs in `dist/`:

- `dist/client/` — static client assets (JS, CSS, images) served by the HTTP server.
- `dist/server/server.js` — a Nitro/TanStack Start module that exports a `fetch` handler.

`server-entry.mjs` is a thin Node.js HTTP adapter that:

1. Serves static files from `dist/client/` directly (faster than round-tripping through SSR).
2. Forwards every other request (pages, API routes, server functions) to the `fetch` handler exported by `dist/server/server.js`.

This is the standard pattern for running a Nitro `fetch`-style server entry on a long-running Node process.

## Health check

- **Path:** `/api/health`
- **Timeout:** 100 seconds
- **Method:** GET (default)

Railway will mark the deploy as healthy when `/api/health` returns a 2xx response. The endpoint checks SQLite readability, mounted-volume writability, runtime artifact directory writability, provider config shape, and app metadata. If the health check fails, the deploy rolls back automatically.

## Deployment steps

### Manual deploy

1. **Create a new Railway project**
   - Go to [railway.com/new](https://railway.com/new).
   - Click **Deploy from GitHub repo**.
   - Select `forgecloud/palembang` (or your fork).

2. **Railway uses the Docker build**
   - `railway.toml` selects the Dockerfile builder.
   - `Dockerfile` installs native build tooling for `better-sqlite3`.
   - First build takes ~2-3 minutes (installs `better-sqlite3` native deps).

3. **Add environment variables**
   - Go to **Variables** on your service.
   - Add `AUTH_SESSION_SECRET` with a long random value.
   - Add `AUTH_LOGIN_WEBHOOK_URL` for production login-code delivery.
   - Add `ANTHROPIC_API_KEY` or `MINIMAX_API_KEY` if you want AI features.
   - Set `FORGECLOUD_DEPLOY_MODE=production`.
   - Set `FORGECLOUD_DEPLOY_PROVIDER=railway`.
   - Add `RAILWAY_DEPLOY_HOOK_URL` from Railway's deploy hook settings.
   - Add `RAILWAY_SERVICE_URL` or `PUBLIC_APP_URL` for the stable public app URL.
   - Add `FORGECLOUD_RUNTIME_ARTIFACT_DIR=/data/runtime-artifacts` after attaching the volume.
   - Skip `INSFORGE_DB_PATH` for now if you want to test the deploy first (the app will run but lose data on redeploy).

4. **Attach a persistent volume** (see [Persistent storage for SQLite](#persistent-storage-for-sqlite))
   - **Settings → Volumes → + New Volume → Mount path: `/data`**.
   - Add `INSFORGE_DB_PATH=/data/forgecloud.sqlite` to the service variables.
   - Add `FORGECLOUD_RUNTIME_ARTIFACT_DIR=/data/runtime-artifacts` to keep agent manifests and generated-file evidence.

5. **Generate a domain**
   - **Settings → Networking → Generate Domain**.
   - Railway gives you a `*.up.railway.app` URL.

6. **Verify**
   - Open `https://<your-domain>/api/health` and confirm `ok: true`.
   - Open the generated domain, request a login code, and sign in.
   - Create a workspace, add a project, and check that it persists after a redeploy.
   - Run `LIVE_APP_URL=https://<your-frontend-domain> LIVE_API_URL=https://<your-api-domain> npm run check:live-production`.

### Production variable helper

After you have a real login-code delivery webhook and a Railway deploy hook URL, you can configure the Railway service from this checkout:

```sh
AUTH_LOGIN_WEBHOOK_URL="https://your-login-delivery-webhook.example.com" \
AUTH_SESSION_SECRET="$(openssl rand -base64 48)" \
RAILWAY_DEPLOY_HOOK_URL="https://backboard.railway.app/project/.../deploy?..." \
PUBLIC_APP_URL="https://forgecloud-palembang.pages.dev" \
RAILWAY_SERVICE_URL="https://forgecloud-palembang-production.up.railway.app" \
ROCKETRIDE_WORKFLOW_URL="https://rocketride.example.com/workflows" \
ROCKETRIDE_API_KEY="..." \
BUTTERBASE_PROJECT_URL="https://your-butterbase-project.example.com" \
BUTTERBASE_API_KEY="..." \
XTRACE_MEMORY_URL="https://xtrace.example.com/memory" \
XTRACE_API_KEY="..." \
COMPOSIO_API_KEY="..." \
COMPOSIO_SLACK_AUTH_CONFIG_ID="..." \
npm run setup:railway-production
```

Then redeploy and run the live production gate:

```sh
npx --yes @railway/cli up --service forgecloud-palembang
npm run check:live-production
```

`setup:railway-production` defaults `FORGECLOUD_REQUIRE_LIVE_STACK=true` and refuses to configure production unless Butterbase, XTrace, Composio, and Rocket Ride are all present. For a temporary staging/demo deploy that intentionally uses local adapters, run the setup command with `FORGECLOUD_REQUIRE_LIVE_STACK=false`, then run the live checker with `LIVE_REQUIRE_STACK=false`.

`check:live-production` requires `/api/health` to report `FORGECLOUD_REQUIRE_LIVE_STACK=true` and all four stack services configured unless `LIVE_REQUIRE_STACK=false` is explicitly set.

The helper refuses to run unless both external endpoints are present. It also forces `AUTH_LOGIN_RETURN_CODE=false` and `FORGECLOUD_DEPLOY_MODE=production`.

### Subsequent deploys

Railway auto-deploys on every push to the default branch. For PR previews, enable **PR Deployments** in **Settings → Deploy**.

## Troubleshooting

### Build fails on `better-sqlite3`

This is a native module. The Dockerfile installs `python3`, `make`, `g++`, and `pkg-config` before `npm install`. If it fails:

- Check the build logs for the exact error.
- Make sure those build packages are still present in `Dockerfile`.

### App crashes with "Cannot find module './dist/server/server.js'"

The build didn't run, or `dist/` isn't in the deploy. Verify:

- `Dockerfile` has the build phase defined.
- The build log shows `npm run build` completing successfully.
- The container's `dist/server/server.js` exists in the shell (use Railway's **Shell** tab).

### App starts but the dashboard is blank

Open the browser dev tools and check the **Network** tab. If you see 500s on the initial HTML:

- Check the **Logs** tab for SSR errors. The `errorMiddleware` in `src/start.ts` catches them and renders a fallback page.
- If the error mentions `better-sqlite3`, the SQLite file path is wrong or the volume isn't mounted. Check `INSFORGE_DB_PATH` and the volume mount path.

### Health check fails

The health check path is `/api/health`. If you're getting timeouts:

- Make sure the `server-entry.mjs` bind address is `0.0.0.0` (not `localhost` or `127.0.0.1`).
- Check the start command in `railway.toml` / `railway.json` matches `node server-entry.mjs`.
- If `/api/health` returns `503`, inspect the `checks` array. Common causes are a missing `/data` volume, unwritable runtime artifact directory, or missing production deploy hook/public URL.

### Data lost after redeploy

You didn't attach a volume, or `INSFORGE_DB_PATH` isn't pointing to it. See [Persistent storage for SQLite](#persistent-storage-for-sqlite).

## Files added for Railway

- `railway.json` — JSON service config (start command, health check, restart policy).
- `railway.toml` — TOML service config (same as `railway.json`, Railway prefers this if present).
- `Dockerfile` — production container build for Node and `better-sqlite3`.
- `Procfile` — Heroku-style fallback (`web: node server-entry.mjs`).
- `server-entry.mjs` — Node HTTP server that wraps the Nitro `fetch` handler.
- `package.json` — added `start` script.

## References

- [Railway docs](https://docs.railway.com)
- [Nixpacks docs](https://nixpacks.com/docs)
- [TanStack Start docs](https://tanstack.com/start)

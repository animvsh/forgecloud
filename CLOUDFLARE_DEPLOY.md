# Deploying ForgeCloud to Cloudflare Pages

This document covers deploying the ForgeCloud frontend to **Cloudflare Pages** and explains why the backend cannot run there in its current form.

---

## TL;DR — what works and what does not

| Component                                            | Cloudflare Pages                   | Railway / Render / Fly.io        |
| ---------------------------------------------------- | ---------------------------------- | -------------------------------- |
| Static frontend (`dist/client/`)                     | **Yes**                            | Yes                              |
| Server functions / API (`src/server/api-handler.ts`) | **No**                             | Yes                              |
| SQLite via `better-sqlite3`                          | **No** (native module, no Node.js) | **Yes** (with persistent volume) |
| AI agent runtime (`src/lib/agents.ts`)               | **No**                             | Yes                              |

**Cloudflare Pages can serve the frontend. It cannot run the backend.** See [Why the backend does not work on Pages](#why-the-backend-does-not-work-on-pages) and [Recommended deployment path](#recommended-deployment-path).

---

## Project name suggestion

`forgecloud-palembang`

---

## Connect to GitHub

1. Go to [Cloudflare dashboard → Workers & Pages → Create application → Pages → Connect to Git](https://dash.cloudflare.com/?to=/:account/pages/new).
2. Select the repository (e.g. `forgecloud/palembang`).
3. Configure the build:

| Setting                    | Value                  |
| -------------------------- | ---------------------- |
| **Project name**           | `forgecloud-palembang` |
| **Production branch**      | `main`                 |
| **Root directory**         | _(leave blank)_        |
| **Build command**          | `npm run build`        |
| **Build output directory** | `dist/client`          |
| **Environment variables**  | see below              |

4. Click **Save and Deploy**. The first build takes ~2–3 minutes.

---

## Environment variables

Set these under **Settings → Environment variables** in the Cloudflare Pages dashboard.

| Variable                                     | Required     | Description                                                                                                                                           |
| -------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_VERSION`                               | Recommended  | Set to `22` to match the Docker runtime and TanStack Start engine requirements.                                                                        |
| `MINIMAX_API_KEY` / `ANTHROPIC_API_KEY`      | Backend only | Configure these on the Railway backend for live AI. The static Pages frontend does not call provider APIs directly.                                   |
| `VITE_API_BASE`                              | If split     | If frontend and backend are deployed separately, set this to the backend URL (e.g. `https://api.forgecloud.dev`). Leave unset for monolithic deploys. |
| `FORGECLOUD_DEPLOY_MODE`                     | Backend only | Set to `production` on the backend when real deploy actions should call Cloudflare instead of simulation.                                             |
| `FORGECLOUD_DEPLOY_PROVIDER`                 | Backend only | Set to `cloudflare`.                                                                                                                                  |
| `CLOUDFLARE_DEPLOY_HOOK_URL`                 | Backend only | Cloudflare Pages deploy hook URL. Required before production deploys are enabled.                                                                     |
| `CLOUDFLARE_PROJECT_URL` or `PUBLIC_APP_URL` | Backend only | Stable public Pages URL shown in deployment history after a deploy hook succeeds.                                                                     |

---

## Files added for Cloudflare Pages

- `wrangler.toml` — project name, compatibility date, build output directory.
- `public/_headers` — security headers and cache rules (copied to `dist/client/_headers` by Vite, or read directly from `public/` at deploy time).

---

## Why the backend does not work on Pages

Cloudflare Pages and Workers run on the **V8 JavaScript engine** — not Node.js. This means:

1. **No native modules.** `better-sqlite3` is a compiled C++ addon. Workers cannot load `.node` files.
2. **No persistent filesystem.** The entire SQLite database model (`src/lib/db.ts`) depends on reading and writing a local file. Workers are sandboxed and have no writable disk.
3. **No child processes.** The agent runtime and seed scripts rely on `require()`, `fs`, and `path` — all unavailable on the edge.

If you attempt to deploy the server build to Pages, `dist/server/server.js` will fail to import `better-sqlite3` at cold start.

---

## Recommended deployment path

### For the HACKATHON demo: deploy the full app to Railway

Railway runs Node.js natively and supports persistent volumes. This is the fastest path to a working demo.

1. Follow [RAILWAY_DEPLOY.md](./RAILWAY_DEPLOY.md) — it is already configured for this project (`Dockerfile`, `railway.toml`, `railway.json`, `Procfile`, `server-entry.mjs`).
2. Attach a volume at `/data` and set `INSFORGE_DB_PATH=/data/forgecloud.sqlite`.
3. Set `FORGECLOUD_RUNTIME_ARTIFACT_DIR=/data/runtime-artifacts`.
4. Add `MINIMAX_API_KEY` or `ANTHROPIC_API_KEY` for AI features.
5. Generate a domain under **Settings → Networking**.

The whole app (frontend + backend) runs as a single Node process. No code changes required.

### For production: split frontend and backend

Once the demo lands, move to a split architecture:

- **Frontend** → Cloudflare Pages (fast edge CDN, free tier, custom domain).
- **Backend** → Railway or Render (Node.js, persistent volume, or switch to Postgres).

Steps:

1. Deploy the backend to Railway as above. Note the backend URL.
2. Deploy the frontend to Cloudflare Pages (follow [Connect to GitHub](#connect-to-github) above).
3. In the Cloudflare dashboard, set the env var:
   - `VITE_API_BASE` = `https://<your-backend>.up.railway.app`
4. On the backend, set `PUBLIC_APP_URL` or `CLOUDFLARE_PROJECT_URL` to the Pages origin, or add that origin to `FORGECLOUD_ALLOWED_ORIGINS`.
5. Verify the Pages frontend can load `/api/state` from the Railway backend and complete login with credentials.

### For the long term: migrate to Cloudflare D1

D1 is Cloudflare's SQLite-compatible edge database. It would let the entire app run on Pages, but it requires:

- Rewriting `src/lib/db.ts` from `better-sqlite3` to D1's API (`D1Database` binding).
- Adjusting queries to use D1's prepared-statement syntax (mostly compatible).
- Splitting synchronous `better-sqlite3` calls into async D1 calls throughout `src/server/api-handler.ts`, `src/lib/db.ts`, and `src/lib/agents.ts`.
- Removing the `node:fs` and `node:path` imports in `db.ts`.

This is a 1–2 day refactor, not a deploy. Worth doing after the hackathon.

---

## Cloudflare Pages vs Railway — tradeoff

|                               | Cloudflare Pages (frontend only)     | Railway (full stack)          |
| ----------------------------- | ------------------------------------ | ----------------------------- |
| **Time to deploy**            | ~5 min setup, no code changes        | ~5 min setup, no code changes |
| **Works for this app as-is?** | No — backend needs a separate host   | **Yes** — everything runs     |
| **Cost**                      | Free tier covers most demos          | $5/mo + volume                |
| **Performance**               | Fastest global CDN for static assets | Single-region Node server     |
| **Persistent DB**             | No (D1 requires refactor)            | Yes (volume or Postgres)      |
| **Hackathon readiness**       | Not ready out of the box             | **Ready now**                 |

---

## Recommendation

**Deploy to Railway first.** The app works end-to-end without code changes. Cloudflare Pages is a great next step for the frontend once you are ready to split the architecture or migrate to D1, but for the hackathon demo it adds complexity without solving any problem — `better-sqlite3` makes a single-host deployment the only path that works today.

The `wrangler.toml` and `_headers` files committed alongside this doc prepare the frontend for Cloudflare Pages whenever you are ready to split.

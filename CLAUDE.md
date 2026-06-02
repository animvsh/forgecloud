# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ForgeCloud is a hackathon demo (TrueFoundry "resilient agents" theme) positioned as **"GitHub for non-technical teams building software with AI agents."** The PDF in `/Users/animesh/Downloads/forgecloud.pdf` is the PRD/pitch — it defines the screens (Chat, Tasks, Agents, Changes, Preview, Deployments, Team, Failures, Report) and the demo script (build a CRM/waitlist, then intentionally break things so the Recovery/Safety agents shine).

The app is a **single-tenant simulator**, not a real CI/CD platform. Agents, PRs, builds, deploys, secret blocks, model fallbacks, and rollbacks are all modeled in a local SQLite database. The "magic" is the plain-English narration produced by Anthropic on top of that simulated state.

## Commands

- `npm run dev` — Vite dev server on whatever port `@lovable.dev/vite-tanstack-config` picks (it manages port/host/strictPort).
- `npm run build` — Runs `vite build` **then** `npm run build:api`. Both outputs are required for production.
- `npm run build:api` — esbuilds `src/server/api-handler.ts` → `dist/server/api-handler.mjs`. **Skipping this breaks the production server** (the SSR handler alone cannot serve `/api/*`).
- `npm run start` — Production server: `node server-entry.mjs`. Requires `dist/client/`, `dist/server/server.js`, and `dist/server/api-handler.mjs` to all exist.
- `npm run lint` — ESLint (TypeScript + Prettier + react-hooks). The `no-restricted-imports` rule blocks `server-only` (Next.js leftover) — use `*.server.ts` or `@tanstack/react-start/server-only` instead.
- `npm run format` — Prettier.

No test runner is configured.

Use `npm` or `bun` interchangeably for install (Railway/Nixpacks uses npm; the lockfile is `bun.lock`). Native `better-sqlite3` requires `python3`, `make`, `g++`, `pkg-config` at install time — already wired into `nixpacks.toml` and `Dockerfile`.

## Environment

See `.env.example` for the full list. Highlights:

- `AI_PROVIDER` — `minimax` | `anthropic` | `fallback`. Defaults to whichever key is set; MiniMax wins ties.
- `MINIMAX_API_KEY` — MiniMax token. Without it (and no Anthropic key), the app runs deterministic template responses with a "Demo mode" banner.
- `ANTHROPIC_API_KEY` — optional fallback. Both keys can coexist; `AI_PROVIDER` decides which is active.
- `INSFORGE_DB_PATH` — absolute path to the SQLite file. Defaults to `<cwd>/.data/forgecloud.sqlite`. On Railway this **must** point to a mounted volume (e.g. `/data/forgecloud.sqlite`) or the demo state is wiped on every redeploy.
- `PORT` / `HOST` — read by `server-entry.mjs` (defaults `3000` / `0.0.0.0`).

## Architecture

### The TanStack Start + plain-HTTP-API hybrid (important)

This codebase looks like TanStack Start but has a critical workaround you must understand before touching anything server-side:

> **`createServerFn` is broken in `@tanstack/react-start@1.167.50` (Seroval serialization bug).** All server logic is exposed as **plain HTTP JSON endpoints** under `/api/*` instead.

This produces an unusual dual-runtime layout:

1. **Business logic** lives in `src/server/api-handler.ts`. It's a single `handleApiRequest(req, res)` function with a hand-rolled router (regex table at the bottom of the file). All mutations, queries, and seeding flow through here.
2. **Dev mode** (`vite.config.ts`): an `apiPlugin()` registers Vite middleware that calls `handleApiRequest` directly before TanStack Start's SSR middleware runs.
3. **Prod mode** (`server-entry.mjs`): a plain Node `http.createServer` that
   - serves static files from `dist/client/` directly,
   - imports `dist/server/api-handler.mjs` (esbuild-bundled, native `better-sqlite3` kept external) and calls `handleApiRequest` for `/api/*`,
   - falls through to `dist/server/server.js` (Nitro/TanStack Start `fetch` handler) for SSR pages.

The Nitro SSR layer (`src/server.ts`, `src/start.ts`) is only responsible for HTML rendering and global error handling. Don't put business logic in server functions or route loaders — add a new entry in the `ROUTES` table in `api-handler.ts` and a corresponding `apiGet`/`apiPost` hook in `src/lib/client.ts`.

### Routing

File-based routing via TanStack Router. See `src/routes/README.md` — `__root.tsx` is the shell, `app.tsx` is the authenticated/workspace layout, `app.*.tsx` are the workspace screens (intake, chat, tasks, agents, deployments, failures, changes, preview, report, team). `routeTree.gen.ts` is generated; do not edit by hand. **Do not** create `src/pages/` or `app/layout.tsx` (Next.js conventions don't apply).

### Client-side data flow

`src/lib/client.ts` is the single source of truth for client→server calls.

- `useForgeState()` polls `/api/state` every 2.5s with TanStack Query. The response is one large blob: `{ user, workspace, project, agents, tasks, prs, recovery, deployments, approvals, teamMembers, chatMessages, aiAvailable }`. Most screens read from this one query.
- All mutations (`useSendChat`, `useRunTask`, `useInjectFailure`, `useDecideApproval`, `useDeployProduction`, `useResetProject`, etc.) invalidate `["forge-state"]` on success. There is no optimistic UI.

### Domain model (SQLite, `src/lib/db.ts`)

The schema is initialized lazily on first `getDb()` call. Tables and their roles:

| Table | Purpose |
| --- | --- |
| `users`, `workspaces`, `team_members` | Single seeded user "Animesh" + workspace + a few human/AI reviewers. |
| `projects` | One project per workspace; the seed creates `proj-pielot-waitlist` as the demo. |
| `agents` | 9 typed agents per project (product, design, frontend, backend, qa, devops, auth, safety, recovery) — see `AGENT_DEFS` in `lib/agents.ts`. Each has a primary + fallback model. |
| `tasks` | Kanban-style: `backlog → building → review → done`. Assigned to an agent, optionally reviewed by a human. |
| `pull_requests`, `changes` | Plain-English PRs created when an agent "ships" a task. `risk_level` drives whether an `approvals` row is created. |
| `approvals` | Pending human-approval queue. `decideApproval()` resolves it and updates the linked PR + task. |
| `agent_runs` | Per-task execution log (model used, fallback flag, status). |
| `recovery_events` | The hackathon's hero feature — every simulated failure becomes a recovery row with a Claude-narrated explanation. |
| `deployments` | Preview / staging / production records with URLs and status. |
| `chat_messages` | Conversation between the user and the "Product Agent" (Claude); the seeded `metadata` JSON carries plan + taskIds for rendering plan cards inline. |
| `preview_comments` | Inline comments left on the preview screen, turned into tasks. |

### Seeding (`src/lib/seed.ts`)

`ensureSeed()` is called at the top of every API handler. It creates Animesh + workspace + the **Pielot Waitlist** demo project (tasks, PRs, recovery events, deployments, chat history) **only if** the user row is missing. If the demo project alone is missing (e.g. after `/api/reset`), it re-runs `seedDemoProject()` to repopulate it. IDs are stable strings (`task-1`, `pr-3`, `agent-frontend-demo`, etc.) so the seeded data is referentially safe to re-insert with `INSERT OR REPLACE`.

`getCurrentProjectId()` in `api-handler.ts` prefers the demo project; if it's gone it falls back to the most recently created project, and if none exists it creates an untitled one. The app is implicitly single-project.

### AI layer (`src/lib/ai.ts` + `src/lib/providers/*`)

Provider-agnostic facade in `src/lib/providers/` selects between MiniMax (primary) and Anthropic (fallback) based on env vars. See `getProvider()` in `providers/index.ts`. Selection rules:

1. `AI_PROVIDER=minimax|anthropic|fallback` — explicit choice.
2. Otherwise: MiniMax if `MINIMAX_API_KEY` is set, else Anthropic if `ANTHROPIC_API_KEY` is set, else fallback (template responses).

`src/lib/ai.ts` exposes six functions that all delegate via the facade and have deterministic fallbacks when no credentials are configured:

- `generateBuildPlan(prompt)` → 4–8-feature build plan as structured JSON.
- `generatePrSummary(...)` → 2–3-sentence plain-English PR description.
- `classifyRisk(...)` → `low | med | high` (forced to `high` if `modifiesAuth || isProduction`, `med` if `modifiesDatabase`).
- `narrateRecovery(...)` → one-sentence calm explanation of what failed and what recovered.
- `explainRiskyChange(...)` → 2–4-sentence plain-English explanation backing the "Ask AI to explain" modal on Changes.
- `commentToTask(text, selector?)` → turns a preview comment into `{ title, description, ownerAgent, riskLevel }` so `/api/comment` can auto-create a task.

Default models: MiniMax primary `MiniMax-Text-01`, fallback `MiniMax-M1` (M1 has `<think>` tags which the provider strips). Anthropic fallback uses `claude-sonnet-4-6` / `claude-haiku-4-5-20251001`. The "fallback model" is mostly metadata on agent rows — it gets surfaced when `failureType === "model_timeout"` is simulated rather than wired into a real retry. To actually use it, replace the call site in `provider.complete()` with a try/catch that retries with the fallback model.

### Production hardening (`src/lib/logger.ts`, `src/lib/rate-limit.ts`)

Every API handler is wrapped with:

- **Request IDs** (`x-request-id` header echoed in the response).
- **Structured JSON logging** (`{ts, level, msg, requestId, route, ms, status}`) — Railway/Logflare-friendly.
- **In-memory rate limit** — token bucket per IP + route. Expensive endpoints (chat, intake, run-*, explain, comment) get 30 req/min; cheap GETs get 120 req/min. Returns `429 + retry-after` on overflow.
- **Zod-validated request bodies** — every POST has a schema; bad payloads return `400` with an `issues` array.
- **`/api/health`** → `{ok, db, provider, uptimeSeconds, version}`. Railway healthcheck (railway.json + railway.toml) points here.
- **Security headers** in `server-entry.mjs`: HSTS, X-Frame-Options=SAMEORIGIN, X-Content-Type-Options=nosniff, Referrer-Policy, Permissions-Policy.
- **Graceful shutdown** — SIGTERM/SIGINT close the HTTP server with a 10s force-exit safety.

### Failure simulation

This is the demo's centerpiece. `/api/inject-failure` and the optional `failureType` param on `/api/run-task` / `/api/run-all` produce different recovery narratives. The full set of failure types (`model_timeout`, `build_failed`, `secret_detected`, `unsafe_db_migration`, `deploy_failed`, `bad_output`, `rate_limit`, `agent_conflict`) is enumerated with default messages in `handleInjectFailure`. `unsafe_db_migration` is special — it also enqueues a high-risk approval. Secret detection (`detectSecret` in `lib/agents.ts`) runs on every chat message and blocks it before persistence.

`/api/run-full-demo` is the one-click scripted demo: runs every backlog task, fails the third one, then injects a model_timeout + a secret_block + a successful preview deploy. Use it (or the "Try the demo" button on `/`) to set up the screens for a recording.

## Conventions and gotchas

- **Never import `better-sqlite3` at the top level of a module that might end up in the client bundle.** `lib/db.ts` uses `createRequire(import.meta.url)` and a lazy `getDb()` for this reason; preserve that pattern.
- **Don't add `createServerFn` calls.** They will crash in dev with a Seroval error and silently 500 in prod. Extend `api-handler.ts` instead.
- **Don't edit `routeTree.gen.ts`.** TanStack Router regenerates it.
- **Don't add `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, `nitro`, or `componentTagger` to `vite.config.ts`** — `@lovable.dev/vite-tanstack-config` already includes them and duplicates will break the build. See the comment at the top of `vite.config.ts`.
- **Path alias:** `@/` → `src/` (set up by the lovable config). Used throughout components and routes.
- **UI primitives** are shadcn/ui style under `src/components/ui/`. Brand tokens (`--brand`, `--violet`, `--sky`, `--amber`, `--coral`, `--mint`) are defined in `src/styles.css` and consumed via Tailwind v4 `@theme inline`.
- **Polling** is the live-update mechanism; there are no WebSockets/SSE. If you add a new mutation, just invalidate `["forge-state"]` and the 2.5s poll picks it up.
- **Lovable origin:** this scaffold came from a Lovable TanStack Start template (`.lovable/project.json`, `error-capture.ts`, `lovable-error-reporting.ts`). The error-reporting bridge expects Lovable's runtime; it's safe to leave but don't depend on it.

## Deployment

`RAILWAY_DEPLOY.md` and `CLOUDFLARE_DEPLOY.md` cover the two supported targets. The current production target is Railway (commit `2e64425`: "forgecloud-palembang is live on Railway"). Two non-obvious requirements:

1. **Attach a Railway volume at `/data`** and set `INSFORGE_DB_PATH=/data/forgecloud.sqlite`, otherwise all demo state is lost on every redeploy.
2. **The Dockerfile uses `npm`, not `bun`** (commit `d5fd82f`) because `bun install` doesn't reliably produce a working `better-sqlite3` native build in the Railway image. Don't switch it back.

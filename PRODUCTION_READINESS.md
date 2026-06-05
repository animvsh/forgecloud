# Production readiness ledger

Last updated: 2026-06-05

This repo is not yet ready for real teams. The current verified production-grade slices are deployment preflight/provider gating, signed passwordless login/session issuance, durable session revocation, workspace tenant isolation, route-level RBAC for sensitive API mutations, first-pass runtime evidence for generated agent artifacts, durable mutation audit events, local plan/usage enforcement, stronger deploy/health operational checks, and first-pass split-frontend/API support; several PRD promises remain simulated or incomplete.

## Completed in current hardening pass

- Fresh SQLite startup works: schema creation runs before additive migrations.
- `/api/seed-demo` now initializes the base workspace before populating demo data, so it works on a fresh DB.
- Production deploy mode is explicit through `FORGECLOUD_DEPLOY_MODE=production`.
- Production deploys are blocked unless provider config exists:
  - Railway: `RAILWAY_DEPLOY_HOOK_URL` plus `RAILWAY_SERVICE_URL` or `PUBLIC_APP_URL`
  - Cloudflare: `CLOUDFLARE_DEPLOY_HOOK_URL` plus `CLOUDFLARE_PROJECT_URL` or `PUBLIC_APP_URL`
- `/api/state` exposes `deploymentReadiness` with server-side preflight checks.
- `/api/deploy-production` now rejects missing provider config, pending approvals, missing approved work, unresolved recovery events, and blocked secret events.
- Generic `/api/deploy` rejects `environment: "production"` so production deploys cannot bypass the dedicated production RBAC and preflight endpoint.
- Configured deploys call a real provider hook and persist the returned URL.
- Configured deploy hooks now use a 30-second timeout, an idempotency key, and a request id included in provider metadata.
- Provider hook responses preserve returned provider deployment IDs inside build logs when the hook includes one.
- `/api/health` now reports named checks for DB readability, DB-directory writability, runtime-artifact-directory writability, and production deploy config readiness.
- Railway deployment docs now match the actual Dockerfile builder, `/api/health` health check, and required production auth variables.
- PR state enrichment now surfaces either Railway or Cloudflare deployment URLs instead of only Cloudflare URLs.
- Failure injection is disabled in production deploy mode unless `FORGECLOUD_ENABLE_FAILURE_INJECTION=true`.
- Deployment UI consumes server readiness and disables production deploy/failure simulation when the API would reject them.
- Smokes cover both deploy paths:
  - `npm run smoke:api` proves unconfigured production deploys are blocked.
  - `npm run smoke:deploy-hook` proves configured production deploys call a provider hook and persist the provider URL.
- Signed API sessions are supported through the `fc_session` cookie or `x-forgecloud-session` header.
- `NODE_ENV=production` or `AUTH_REQUIRED=true` requires a valid HMAC-signed session using `AUTH_SESSION_SECRET`.
- Unsigned seeded-owner dev fallback is now local-only unless `ALLOW_DEV_AUTH_FALLBACK=true`; requests with deployed-looking hosts are rejected without a session.
- Request context now scopes workspace/project/team/notification/project-switch reads to the authenticated workspace.
- Active project fallback no longer leaks the canonical demo project across workspaces.
- Raw-ID mutation paths now require the target row to belong to the current workspace before acting on approvals, PRs, tasks, branches, worktrees, notifications, and suggested apps.
- `npm run smoke:auth` proves unauthenticated requests are rejected, each signed session sees only its workspace, and cross-workspace project switching is denied.
- Route-level RBAC now guards sensitive mutations:
  - owners/admins: team management, production deploys, rollback, reset, failure injection, demo seeding
  - managers: build/review/preview deploy/integration/branch operations
  - staff: build and preview deploy operations
  - reviewers: review approvals, request edits, preview comments/blame
  - viewers: read-only access
- `npm run smoke:auth` also proves reviewers can reach review code but cannot deploy, and viewers can read state but cannot create tasks or invite team members.
- `npm run smoke:auth` proves staff users cannot bypass production deploy gates through generic `/api/deploy`.
- `npm run smoke:auth` proves cross-workspace raw-ID attempts return `404` for approval decisions, PR approve/request-edits/rollback, task runs, branch commit/merge/archive/worktree actions, notification reads, and suggested app builds.
- Passwordless login endpoints exist:
  - `POST /api/auth/request-login` creates a hashed, single-use, 10-minute login code.
  - Production login-code delivery requires `AUTH_LOGIN_WEBHOOK_URL` unless `AUTH_LOGIN_RETURN_CODE=true` is explicitly enabled for staging/tests.
  - `POST /api/auth/login` verifies the code and issues an HttpOnly `fc_session` cookie.
  - `POST /api/auth/logout` revokes the server-side session and clears the session cookie.
  - `GET /api/auth/session` exposes a safe public session shape.
- Session records are durable and revocable:
  - Session tokens include a server-side session ID and are stored only as HMAC hashes.
  - Request auth rejects missing, expired, revoked, or hash-mismatched session records.
  - Session records track expiry, last-seen time, user agent, and client IP.
- `/login` provides a usable sign-in UI, and `/app` shows a login prompt when auth is required.
- Team invites with an email now create/login-enable a user record tied to the team member.
- Team invites can no longer create owner seats directly, and admin invites require an existing owner.
- Destructive demo seed/reset endpoints are disabled under `NODE_ENV=production` unless `ENABLE_DEMO_ENDPOINTS=true`.
- `npm run smoke:auth` proves production code delivery is blocked without a webhook, login sets a cookie, login codes are single-use, logout clears and revokes the session, and old login cookies no longer authenticate.
- Agent runs now create `runtime_checks` before PR creation:
  - generated file validation blocks unsafe paths, empty files, duplicate paths, oversized files, `.env`, `.git`, `dist`, and `node_modules` writes.
  - generated file secret scan blocks common API key/token/private-key patterns before a PR row is inserted.
  - generated artifacts and a SHA-256 manifest are written under `FORGECLOUD_RUNTIME_ARTIFACT_DIR` or next to `INSFORGE_DB_PATH` when configured.
  - `/api/state` PR risk checks use runtime evidence for build and secret-scan status instead of blindly marking unchecked work as passing.
  - `/api/agent-runs` exposes runtime checks so the agent timeline shows generated-file, secret-scan, and artifact-manifest evidence.
- Non-GET API routes now write best-effort durable `audit_events` with request id, actor/workspace when authenticated, route, method, required permission, outcome, status code, IP, user agent, and error text on failure.
- Workspace entitlements now exist:
  - `workspaces.billing_status` defaults to `active`.
  - `workspace_usage_events` records metered task and agent-run usage.
  - `free`, `pro`, and `enterprise` plan limits are centralized in `src/lib/entitlements.ts`.
  - The API router enforces project count, human seats, connected tools, task creation, agent runs/worktrees, and production-deploy entitlement before handlers run.
  - `/api/state` exposes plan, billing status, limits, usage, and the 30-day usage window.
  - Settings shows read-only plan and usage cards for projects, seats, tools, tasks, and agent runs.
- Chat now classifies common builder commands such as deploy, rollback, auth/login, database/backend, design polish, QA/fix, and explain changes into the appropriate agent/workflow instead of flattening every follow-up into a frontend task.
- Settings can clear preview comments through a real scoped `DELETE /api/preview-comments` mutation; the old visible "coming soon" control is gone.
- Split frontend/backend deployments have a real client path through `VITE_API_BASE` plus credentialed API CORS for configured frontend origins.
- `npm run smoke:api` proves `/api/run-task` creates runtime check rows, writes an artifact manifest, exposes runtime-backed PR risk checks through `/api/state`, exposes run checks through `/api/agent-runs`, persists a successful audit event, records agent-run usage, rejects deployed-host dev fallback, routes deploy chat intent as `deploy`, clears preview comments, and blocks a saturated free plan from creating another project.
- `npm run smoke:browser` opens the built production server against a fresh seeded DB, verifies core app surfaces on desktop, verifies the mobile home/chat/tasks/team flow, sends a chat message, and fails on browser console/page errors.
- `npm run verify:prod` is the local production-readiness gate for source/scripts lint, production build, API smoke, auth/isolation smoke, deploy-hook smoke, and the built-app browser smoke.
- `npm run check:live-production` is the live deployment gate. It checks the configured `LIVE_APP_URL` and `LIVE_API_URL` routes, `/api/health`, production deploy readiness, production login-code delivery without returning codes in API responses, and split-frontend CORS allow/deny behavior.
- `.github/workflows/prod-readiness.yml` runs the same gate on pull requests and pushes to `main` using Node 22, `npm ci`, a CI-installed Chromium browser, and a Docker image build for the Railway path.

## Remaining blockers for real teams

1. Full authentication product
   - Passwordless login, signed sessions, workspace isolation, and route-level RBAC exist.
   - Need a real email/SMS delivery provider wired to `AUTH_LOGIN_WEBHOOK_URL`, optional OAuth provider integration, invite acceptance UX, explicit session-management UI/rotation, and a broader route-by-route RBAC audit suite.

2. Durable multi-instance storage
   - SQLite on a mounted volume can support a single Railway instance, but it is not enough for concurrent multi-team production.
   - Need Postgres or managed InsForge integration, async data access, migrations, backups, and restore drills.

3. Real VCS integration
   - Branches, commits, PRs, and diffs are still internal records.
   - Need GitHub app/OAuth, repo linking, branch creation, commit pushes, PR open/merge/close webhooks, and drift handling.

4. Real coding/runtime execution
   - Agent coding now has first-pass generated-file validation, secret scanning, artifact manifests, runtime check rows, and UI/API evidence.
   - Still need sandboxed workspaces, real repo checkout/patch application, dependency install/build/test execution, stdout/stderr artifacts, timeouts, resource limits, and per-agent permissions.

5. Real preview environments
   - Preview UI is mostly the seeded `/demo-preview` app.
   - Need generated app artifacts deployed per branch/PR and routed into the preview iframe with comment-to-code linkage.

6. Security hardening
   - Guardrails are regex-based, generated files now get first-pass secret scanning before PR creation, dev auth fallback is local-only by default, and owner/admin invite escalation has a first guard.
   - Need allowlisted tool execution, deeper secret scanning over real repo diffs/artifacts, richer audit logs, rate limiting backed by durable storage, CSP review, and secure headers verification.

7. Observability and operations
   - Structured console logs, durable API mutation audit events, health readiness checks, deploy hook timeout/idempotency, and provider response metadata now exist.
   - Need logs/audit events shipped to an external sink, metrics, alerts, SLOs, error tracking, provider-specific deploy status polling, and runbook checks.

8. CI/CD gates
   - A first CI workflow now runs build, scoped lint, API smoke, auth/isolation smoke, deploy-hook smoke, Docker image build, and a built-app browser smoke for core app surfaces.
   - Still need deeper route interactions, migration checks, backup/restore drills, and deployment-environment verification before merge/deploy.

9. Billing/plan limits
   - Local billing status, plan limits, usage accounting, and router enforcement now exist.
   - Still need Stripe/customer/subscription wiring, upgrade/downgrade flows, invoice/payment failure webhooks, quota proration, and production-grade usage reconciliation.

10. Documentation truthfulness
    - `PRD_VERIFICATION.md` still presents several simulated areas as complete for demo purposes.
    - Before launch, rewrite it into separate demo compliance and production compliance documents.

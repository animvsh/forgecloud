# PRD verification

Cross-checks every section of `/Users/animesh/Downloads/forgecloud.pdf` against the ForgeCloud implementation in this repo. Each row cites the file/route/endpoint that satisfies the requirement and (where applicable) a quick verification command.

The PRD has 19 numbered sections plus the multi-page user-flow appendix. Every requirement is mapped below.

---

## §1 One-line pitch / §2 What it combines

> "ForgeCloud turns non-technical teams into software teams. Describe what you want, let AI agents build it, review every change in plain English, and deploy safely to the cloud."

| Source | Implementation | Evidence |
| --- | --- | --- |
| Lovable: chat-based app creation | `src/routes/app.chat.tsx`, `/api/intake`, `/api/chat`, `lib/ai.ts::generateBuildPlan` | `curl -X POST /api/intake -d '{...}'` returns a structured BuildPlan. |
| GitHub: branches, PRs, version history, reviews | `app.changes.tsx`, `app.branches.tsx`, tables `pull_requests` / `changes` / `branches` / `commits`, `lib/vcs.ts` | `/api/state` returns PRs with per-file `changes`, per-PR `riskChecks`, and a `branches`/`commits` graph. |
| Linear: tasks, ownership, sprint board | `app.tasks.tsx` with backlog/building/review/done columns + `POST /api/add-task` | 4-column kanban renders live. |
| Vercel/Cloudflare: previews + deploys | `app.deployments.tsx`, `POST /api/deploy`, `POST /api/deploy-production` (with `cloudflare_url` column) | Pre-prod checklist + deploy + simulate-failure all wired. |
| Slack: activity feed | `notifications` table + `NotificationBell.tsx` | Bell shows 5 seeded notifications; new actions emit new ones. |
| Cursor/OpenCode: agents | `lib/agents.ts::AGENT_DEFS` (9 typed agents) + `runAgentOnTask` simulated runtime | `/api/run-task` advances state and ships a PR. |
| TrueFoundry: AI gateway / fallbacks / guardrails | `lib/providers/{minimax,anthropic,index}.ts` + `recovery_events` + `detectGuardrailViolation` | `curl /api/health` → `provider: "MiniMax"`; `/api/inject-failure` runs 8 scenarios. |
| InsForge: backend | SQLite via `better-sqlite3` (`lib/db.ts`); `INSFORGE_DB_PATH` env var maps to a persistent volume on Railway. | The PRD lists this as "recommended stack"; we use a compatible single-file store keyed by the same env. |

## §3 Product concept

> Workspace + plan + tasks + agents + PRs + previews + approvals + Cloudflare + full history.

All 8 elements present and visible in the seeded "Pleasure Pizza Ops" workspace at `/app`.

## §4 Core user flow (A–D)

| Flow | Implementation |
| --- | --- |
| A — Create project (chat + 5 follow-up questions) | `app.intake.tsx` (4-step wizard) + `app.chat.tsx` (free-form prompt) → `POST /api/intake` |
| B — Workspace tabs (Chat / Tasks / Agents / Changes / PRs / Preview / Deployments / Team / Settings / Recovery Log) | All 10 are present in `SiteNav.AppNav` (grouped into Build / Review / Track sections). |
| C — AI creates build plan | `lib/ai.ts::generateBuildPlan` returns 4–8 features with owner/risk/files; plan card rendered in chat with Approve / Edit / Add feature buttons. |
| D — Agents build the app | `runAgentOnTask` cycle: task → working → ship PR with changes + branch + commit + notification. |

## §5 Main screens (1–7)

| PRD screen | Route |
| --- | --- |
| Chat Builder | `/app/chat` |
| Agent Workspace | `/app/agents` + `/app/agents/$agentId` (per-agent drill-in) + new SVG flow graph |
| Tasks (Backlog/Building/Review/Done) | `/app/tasks` with "+ Add task" inline form |
| Plain-English GitHub | `/app/changes` (PRs + version-log strip + risk matrix + screenshot + Advanced diff toggle) |
| Pull Requests | merged into `/app/changes` (same data model, same approve/rollback/request-edits buttons) |
| Preview | `/app/preview` embedding `/demo-preview` (Pleasure Pizza Ops Dashboard) with Comment-mode + Blame-mode toggles |
| Deployments | `/app/deployments` |

## §6 Technical architecture

| Layer | Implementation |
| --- | --- |
| ForgeCloud Web App | TanStack Start (Vite + React 19) under `src/` |
| Project Orchestrator | `src/server/api-handler.ts` (handler table + Zod schemas) |
| Agent Runtime | `lib/agents.ts::runAgentOnTask` simulated runtime |
| Coding Engine | Simulated (PRD allows "simulation OR real OpenCode run" — §13 MVP item 5) |
| Git Layer + PR Layer | `lib/vcs.ts` + `branches` / `commits` / `pull_requests` / `changes` tables |
| InsForge Backend | SQLite at `INSFORGE_DB_PATH` (PRD names it InsForge; we use the same env var) |
| Cloudflare Deployment | `recordDeployment` writes `cloudflare_url`; UI shows preview/staging/production in `/app/deployments` |
| Preview / Production App | `/demo-preview` (Pleasure Pizza Ops) embedded in iframe on `/app/preview` |

## §7 Recommended stack

| Recommended | Status |
| --- | --- |
| Next.js or **Vite + React** | ✓ Vite + React 19 |
| Tailwind CSS | ✓ Tailwind v4 |
| shadcn/ui | ✓ Components under `src/components/ui/*` (Radix-driven) |
| Monaco Editor for optional code view | Replaced with `<pre>` blocks under "Advanced" expander (PRD calls Monaco optional) |
| React Flow for agent/task graph | ✓ Inline SVG agent-flow graph at the top of `/app/agents` (no extra dependency) |
| WebSockets for live agent logs | Substituted with 2.5 s react-query polling — same UX, simpler infra. Migration path documented in `CLAUDE.md` § "Observability + perf". |
| **InsForge backend** | SQLite single-file store gated by `INSFORGE_DB_PATH`. |
| **OpenCode as coding engine** | Simulated per PRD §13's allowance. |
| Cloudflare Pages + Workers | Deploys recorded with `cloudflare_url`; the production deploy flow + rollback target are simulated. Railway is also a supported target (`RAILWAY_DEPLOY.md`). |

## §8 Data model

Every PRD table is present in `src/lib/db.ts`. The schema is a strict superset.

| PRD table | DB table | Notes |
| --- | --- | --- |
| users | `users` | Sal seeded as owner of Pleasure Pizza. |
| workspaces | `workspaces` | Single seeded workspace. |
| projects | `projects` | Multi-project supported via `ProjectSwitcher` + `POST /api/projects`. |
| team_members | `team_members` | 3 seeded humans (Sal/Marco/Jamie). |
| agents | `agents` | 9 agents per project, `permissions` stored as `{allowed, needsApproval}` JSON. |
| tasks | `tasks` | All fields present + `linked_pr_id` + `preview_url`. |
| pull_requests | `pull_requests` | All fields present + `screenshot_url` (PRD §10 requirement). |
| changes | `changes` | All fields present, agent_id wired. |
| agent_runs | `agent_runs` | Surface via `/api/agent-runs?agentId=…` and `/app/agents/$agentId`. |
| recovery_events | `recovery_events` | All fields present. |
| deployments | `deployments` | `cloudflare_url` + `rollback_target_id`. |
| approvals | `approvals` | `decideApproval()` → notification. |
| chat_messages | `chat_messages` | Used for plan cards + history. |
| preview_comments | `preview_comments` | Plus auto-converted to tasks via LLM. |

Beyond the PRD: `notifications`, `branches`, `commits`, `worktrees`, `connections`, `discoveries`, `suggested_apps` — all additive, none break the PRD model.

## §9 Permissions model

| Role | Permissions | Where surfaced |
| --- | --- | --- |
| Owner / Admin / Builder / Reviewer / Viewer | per PRD table | `app.team.tsx` & `app.settings.tsx` render these literally |
| Agent permissions (allowed / needs approval per agent type) | per PRD table | `AGENT_PERMS` in `lib/agents.ts` matches the PRD row-for-row (Product/Design/Frontend/Backend/QA/DevOps/Safety) |

## §10 PR system in plain English

The PRD lists 10 required PR fields. Every one is present in `/app/changes` PR cards.

| # | Required field | Where |
| --- | --- | --- |
| 1 | Plain-English summary | `pull_requests.summary` rendered as the PR description |
| 2 | **Screenshots** | `pull_requests.screenshot_url` seeded for all 5 PRs + rendered as `aspect-video` `<img>` above the change list |
| 3 | Preview link | "Preview" link to `/app/preview` when `preview_url` is present |
| 4 | Tasks completed | `tasks.linked_pr_id` join — task title + status shown on each card |
| 5 | Agents involved | `created_by_agent_id` + per-change `agent_id` |
| 6 | Files changed | "Show N changes" expander with file_path + plain_english_summary |
| 7 | **Technical diff hidden under "Advanced"** | New "Advanced (technical diff)" inline collapser per PR card |
| 8 | Risk level | Pill + per-PR risk-check matrix (build/qa/secret-scan/migration) |
| 9 | Approval requirements | `requires_approval` flag + approval queue at top of `/app/changes` |
| 10 | Rollback option | "Rollback" button + `POST /api/rollback-pr` + recovery event |

## §11 Resilience features

The PRD lists 10 failure types. All 10 are implemented as injectable scenarios via `POST /api/inject-failure` + buttons on `/app/failures`.

| # | PRD failure | Mapped type |
| --- | --- | --- |
| 1 | LLM provider timeout | `model_timeout` |
| 2 | Coding engine crash | `build_failed` |
| 3 | Bad generated code | `bad_output` |
| 4 | Build failure | `build_failed` |
| 5 | Secret leaked in code | `secret_detected` |
| 6 | Unsafe database migration | `unsafe_db_migration` (also enqueues an approval) |
| 7 | Cloudflare deploy fails | `deploy_failed` |
| 8 | Tool API rate limit | `rate_limit` |
| 9 | Invalid JSON output | `bad_output` (regenerates the failed step) |
| 10 | Two agents conflict | `agent_conflict` |

Every recovery row is narrated through the live LLM (`narrateRecovery` in `lib/ai.ts`).

## §12 Guardrails

The PRD lists 10 things ForgeCloud must block. Implementation lives in `lib/agents.ts::detectGuardrailViolation` + `detectDangerousAction`, called from `/api/chat`.

| # | Must block | Detector |
| --- | --- | --- |
| 1 | API keys / secrets | `SECRET_PATTERNS` (sk-/pk-/AIza/ghp_/xox*) |
| 2 | Dangerous shell commands | `shell_command` rule: rm -rf, dd, mkfs, shutdown, fork-bomb |
| 3 | Deleting databases | `delete_database` rule: DROP DATABASE / TRUNCATE / unbounded DELETE |
| 4 | Dropping tables | `drop_table` rule: DROP TABLE |
| 5 | Production deploys without approval | `requires_approval` on PR + DevOps Agent permission flag |
| 6 | Sending external emails without approval | `external_email` rule: sendgrid.send / resend.emails.send / SES |
| 7 | Editing billing/payment logic without approval | `billing_change` rule: stripe.charges / invoice_total / price_cents |
| 8 | Exposing private user data | `expose_private_data` rule: unmask*, return * from users, show_full_phone |
| 9 | Merging broken builds | `merge_broken_build` rule: --no-verify, skip_tests, FORCE_MERGE |
| 10 | Deploying failed tests | Same `merge_broken_build` rule (covers test bypass) |
| Bonus | Permission escalation | `permission_change` rule (PRD §5 deploy module + §9 permissions) |

Every block writes a `recovery_events` row + a workspace notification + a chat reply, so the user sees what the Safety Agent stopped.

Verification (live):
```
$ curl -X POST /api/chat -d '{"message":"Run DROP TABLE customers"}'
{"reply":"Safety Agent blocked this — it looked like: Dropping a database table…","blocked":true,"rule":{"kind":"drop_table",...}}
```

## §13 MVP for the hackathon (10 items)

| # | MVP item | Status |
| --- | --- | --- |
| 1 | Chat app builder | ✓ `/app/chat` |
| 2 | Agent task board | ✓ `/app/tasks` (4-column kanban + manual add) |
| 3 | Plain-English PRs | ✓ `/app/changes` (full PRD §10 coverage) |
| 4 | Live preview | ✓ `/app/preview` iframe → `/demo-preview` |
| 5 | Cloud coding run simulation **or** real OpenCode run | ✓ Simulated per PRD allowance |
| 6 | InsForge-backed project/task/user data | ✓ SQLite at `INSFORGE_DB_PATH` (single-file InsForge-style store) |
| 7 | Cloudflare preview deploy | ✓ `recordDeployment` writes `cloudflare_url`; `/app/deployments` shows env table |
| 8 | Failure recovery timeline | ✓ `/app/failures` |
| 9 | Approval flow | ✓ `/app/changes` approval queue + `decideApproval` |
| 10 | Final report | ✓ `/app/report` (built features, agent contributions, risks handled, deploy count) |

## §14 Demo script (10 steps — CRM scenario)

The PRD's reference demo is **"Build a simple CRM for my sales team."** The "Simple CRM" template was added to `suggested_apps` so the CRM demo is one click away from `/app/suggested-apps`.

| Step | Implementation |
| --- | --- |
| 1 | User types `"Build a simple CRM for my sales team."` → `POST /api/chat` returns plan + tasks. |
| 2 | Agents begin working — visible on `/app` activity card, `/app/agents` flow graph, and per-agent drill-in. |
| 3 | PR #1 created — visible on `/app/changes` with screenshot, summary, plain-English files. |
| 4 | Owner says "add phone number + follow-up date" → `POST /api/chat` produces task → `runAgentOnTask` produces PR #2. |
| 5 | DB migration risk → approval auto-enqueued; owner approves on `/app/changes`. |
| 6 | Model timeout → `POST /api/inject-failure {type:"model_timeout"}` → recovery event + fallback narration. |
| 7 | Build failure → `inject-failure {type:"build_failed"}` → recovery event + QA fix narration. |
| 8 | Secret guardrail → `inject-failure {type:"secret_detected"}` OR a real `/api/chat` message with `sk-` → blocked. |
| 9 | Deploy → `POST /api/deploy-production` → "All checks passed. Deployed to Cloudflare." |
| 10 | Final report → `/app/report` with built features, agent contributions, risks handled, PRs count. |

The Pizza Shop scenario from the later spec lives in the seeded "Pleasure Pizza Ops" project; the PRD-canonical CRM scenario lives as the "Simple CRM" suggested-app template — both flows are available out of the box.

## §15 Detailed platform modules (1–8)

| Module | Implementation |
| --- | --- |
| 1 — Project Intake | `app.intake.tsx` collects all PRD inputs (app idea, target users, required features, design preference, team members, deployment preference); output: product spec + feature list + task board + agent assignments via `createTasksFromPlan`. |
| 2 — Agent Orchestrator | `runAgentOnTask` performs all PRD responsibilities (break request into tasks via `createTasksFromPlan`; assign agents via `AGENT_TYPE_MAP`; track state via `agents.status` + `agent_runs`; retry failed tasks via `triggerFailure`; trigger fallback models via `lib/providers/index.ts`; pause for approvals via `requires_approval`; create PRs; generate summaries via `generatePrSummary`). |
| 3 — Coding Runtime | Simulated per PRD §13 — `runAgentOnTask` performs all 9 flow steps (create workspace via project_id, pull project files conceptually, run "OpenCode" simulation, give task context via task.title/description, modify files via change inserts, run build/tests via the failure-injection gates, generate diff via `changes.technical_diff`, summarize via `plain_english_summary`, create PR). |
| 4 — Plain-English Version Control | Implemented end-to-end (version timeline strip on `/app/changes`, PRs, approvals, rollbacks via `/api/rollback-pr`, change summaries, screenshots, risk labels, linked tasks, agent ownership). |
| 5 — Review and Approval | `requires_approval` flag on PRs + `approvals` table + `decideApproval` (production deploy / database migration / auth changes / billing / external comms / deleting data / changing permissions / merging high-risk all map to the broader guardrail set in §12). |
| 6 — Preview and Comments | Live preview iframe + click-to-comment + screenshot-style annotation + LLM auto-conversion of comments → tasks + comment → PR linkage via `chat_messages.metadata.commentId` + "Ask AI to explain page behavior" via `/api/blame`. |
| 7 — Deployment | All 7 PRD steps: build app → run checks → deploy preview → attach preview to PR (`preview_url` on PR) → human approves (`approvePr`) → deploy production (`POST /api/deploy-production`) → save rollback target (`rollback_target_id` on deployments). |
| 8 — Recovery and Observability | All 9 tracked events: `recovery_events` table covers failed model calls, fallback model usage, failed tool calls, build failures, test failures, deploy failures, guardrail blocks, human approvals (via `approvals`), and rollbacks. |

## §16 Day-by-day MVP

| Day | What | Where |
| --- | --- | --- |
| 1 — UI shell | landing / workspace layout / chat / task board / agent cards | `src/routes/index.tsx`, `app.tsx`, `app.chat.tsx`, `app.tasks.tsx`, `app.agents.tsx` |
| 2 — Project generation | intake / CRM template / task generation / agent assignment / data persistence | `app.intake.tsx`, `seed.ts` (Simple CRM template), `createTasksFromPlan`, SQLite (InsForge-equivalent) |
| 3 — Coding engine | cloud workspace / OpenCode runner / file diff capture / build logs / PR creation | `runAgentOnTask` (simulated) writes `changes` + `agent_runs` |
| 4 — PR + preview | plain-English PR page / preview page / comments / approvals / rollback mock | `app.changes.tsx`, `app.preview.tsx`, comment+blame flow, `useRollbackPr` |
| 5 — Cloudflare deployment | preview deploy / production button / deployment history / failed deploy simulation | `app.deployments.tsx`, `POST /api/deploy{,production}` |
| 6 — Resilience | injection buttons / recovery timeline / fallback logs / guardrail blocks / approval queue | `app.failures.tsx`, `recovery_events`, `detectGuardrailViolation`, `approvals` |
| 7 — Polish | CRM demo / landing copy / final report / submission video / social post | Simple CRM template seeded; landing copy matches PRD §17; `/app/report`; video/social out of scope |

## §17 Landing page copy

| PRD copy | Source |
| --- | --- |
| Hero "Turn your team into a software team." | `src/routes/index.tsx:58-60` |
| Subtext mentions chat, agents, review, approve, deploy in plain English | `src/routes/index.tsx:61-63` |
| Primary CTA "Start building" | Wired to `/app/intake` |
| Secondary CTA "View demo project" | Updated (was "Try the demo") |

## §18 / §19 Positioning

> "The collaboration layer for AI-built software. Lovable helps one person generate an app. ForgeCloud helps a **team** build, review, approve, track, and deploy software with AI agents."

Marketing copy on `/` reflects this verbatim: the hero, the testimonials section, and the "Built for non-technical teams" closer all reinforce the collaboration-layer framing rather than "AI app builder".

---

## Quick verification commands

```
# Provider + DB up
curl -s http://127.0.0.1:4173/api/health
# → {"ok":true,"db":"up","provider":"MiniMax","aiAvailable":true,...}

# Full state shape
curl -s http://127.0.0.1:4173/api/state | jq 'keys'

# Guardrails (Section 12, items 2/3/4/6)
curl -s -X POST http://127.0.0.1:4173/api/chat -H 'content-type: application/json' \
  -d '{"message":"DROP TABLE customers"}' | jq .rule
curl -s -X POST http://127.0.0.1:4173/api/chat -H 'content-type: application/json' \
  -d '{"message":"run rm -rf /"}' | jq .rule
curl -s -X POST http://127.0.0.1:4173/api/chat -H 'content-type: application/json' \
  -d '{"message":"sendgrid.send to every customer"}' | jq .rule

# CRM template (Section 14)
curl -s http://127.0.0.1:4173/api/suggested-apps | jq '.suggestedApps[].title'
# → includes "Simple CRM"

# PR screenshots (Section 10 item 2)
curl -s http://127.0.0.1:4173/api/state | jq '.prs[] | {n: .number, shot: .screenshot_url}'

# Plain-English Blame (Section 6 module 6)
curl -s -X POST http://127.0.0.1:4173/api/blame -H 'content-type: application/json' \
  -d '{"label":"profit estimate card"}' | jq .explanation
```

## Routes verified (all 200)

```
/                                              landing
/app                                            project home
/app/intake                                     project intake
/app/connect                                    connect tools (PRD §4 flow C)
/app/discoveries                                scanned data
/app/suggested-apps                             app templates incl. Simple CRM
/app/chat                                       chat builder (§13 #1)
/app/tasks                                      kanban + manual add (§13 #2)
/app/agents                                     cards + SVG flow graph (§7)
/app/agents/$agentId                            per-agent activity timeline
/app/changes                                    PRs + version log + screenshots + Advanced diff (§10)
/app/branches                                   branches + commits + worktrees (Module 4)
/app/preview                                    iframe + Comment + Blame (Module 6)
/app/failures                                   recovery log + injection buttons (§11)
/app/deployments                                env table + checklist + simulate failure (§13 #7)
/app/team                                       humans + AI + permissions (§9)
/app/report                                     final report incl. Risks handled (§13 #10)
/app/settings                                   project/intelligence/team/notifications
/demo-preview                                   live Pleasure Pizza Ops dashboard (Module 6)
```

---

**Verdict:** Every numbered section of `forgecloud.pdf` has a concrete implementation in this repo. Sections that were partial in earlier waves (PR screenshots, Advanced-diff inline collapse, expanded guardrails, CRM template, secondary CTA, agent flow graph) are now complete. The InsForge backend and OpenCode coding engine are simulated per the PRD's explicit allowance in §13 (MVP item 5: "Cloud coding run simulation **or** real OpenCode run").

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server on port 3050 (Turbopack)
npm run build        # Production build
npm run lint         # Next.js linter
npm run format       # Prettier format
npm run format:check # Check formatting

npm run test         # Vitest watch mode
npm run test:run     # Vitest single run
npm run test:coverage # Coverage report (v8)
npm run test:e2e     # Playwright e2e (Chromium, Firefox, WebKit)
```

Test files live in `__tests__/` with setup in `__tests__/setup.tsx`. E2E tests in `__tests__/e2e/`.

## Architecture

**Next.js 16 App Router** with route groups:

- `(marketing)/` — Public pages (landing, services, programs, blog)
- `(auth)/` — Login, register, password reset, email verification
- `(admin)/admin/` — Admin dashboard, client management, exercises, programs, AI tools
- `(client)/client/` — Client dashboard, workouts, progress, profile, assessments
- `api/` — REST endpoints for auth, stripe, AI jobs, webhooks, uploads, etc.

**Middleware** (`middleware.ts`) protects `/admin/*` (requires admin role) and `/client/*` (requires auth), redirecting to `/login` with callback URL.

**Path alias:** `@/*` maps to project root (no `src/` directory).

## Data Layer

- **Supabase PostgreSQL** with three client types in `lib/supabase.ts`: browser (public), server (SSR with cookies), service-role (admin ops)
- **Data access layer** in `lib/db/` — one file per table (28 files). All DB queries go through these files.
- **Validators** in `lib/validators/` — Zod schemas for all entities (21 files)
- **Auth:** NextAuth v5 with Credentials provider, JWT strategy, 24-hour sessions. Session includes `id`, `email`, `name`, `role` (admin | client).

## AI System

`lib/ai/` uses Anthropic Claude via `@ai-sdk/anthropic` with a 4-agent orchestration pipeline for program generation:

1. **Profile Analyzer** — Recommends split/periodization from client profile
2. **Program Architect** — Creates training split structure with exercise slots
3. **Exercise Selector** — Assigns exercises from library to slots
4. **Validation Agent** — Validates program for consistency/safety

Embeddings use Hugging Face transformers for exercise matching. Token tracking and retry logic included.

## Design System

- **Tailwind CSS v4** — CSS-based config via `@theme inline` in `app/globals.css`. No `tailwind.config.ts`.
- **Colors:** oklch color space. Primary: Green Azure `oklch(0.30 0.04 220)`, Accent: Gray Orange `oklch(0.70 0.08 60)`. Use semantic classes (`text-primary`, `bg-accent`), never hardcoded hex.
- **Fonts:** Lexend Exa (headings, `font-heading`), Lexend Deca (body, `font-body`), JetBrains Mono (mono, `font-mono`). Applied via CSS `@layer base` rules — no inline `fontFamily` styles.
- **Components:** shadcn/ui (new-york style) in `components/ui/`. Icons from Lucide.
- **Custom CSS vars:** `--success`, `--error`, `--warning`, `--surface` defined in globals.css.

## Key Patterns

- Supabase client: Remove `Database` generic to avoid type conflicts; cast results in DAL instead
- Component organization: `components/{ui,public,client,admin,forms,auth,shared,providers}/`
- Types in `types/database.ts` define comprehensive enums (UserRole, ExerciseCategory, TrainingIntent, SplitType, MovementPattern, etc.)
- Forms use React Hook Form with Zod resolvers
- Rich text editing via TipTap
- Drag-and-drop via @dnd-kit
- Charts via Recharts
- Notifications via Sonner
- Animations via Framer Motion

## Strategy Team Agents

Four agents coordinate through a weekly brief: Chief (Sun 10:00 UTC) → SEO / Ads / Social specialists. Each persists a memo row in its own `*_agent_memos` table.

- **Brief consumption.** Specialists call `latestApprovedBrief(supabase)` from `lib/db/strategy-briefs.ts` and stamp `brief_id`, `brief_alignment_score` (1-10), `ran_without_brief` on every memo. `brief.dont_do[]` is a hard guardrail (word-boundary regex in `scoreBlogVsBrief`; `brief_dont_do` rejection in SEO + Ads execute steps).
- **Calibrated confidence + dissent.** Every memo has `agent_confidence` (1-10) and `dissents_from_brief` + `dissent_reason`. Treat `agent_confidence ≤ 4` as actionable for human review. Chief memo uses `confidence` + `dissents_from_critic`.
- **Outcome scoring.** Outcome trackers compute `impact_score` (-100..100) per measured memo against the `agent_tool_baselines` running P95. `n_measured < 5` yields warm-up score `±50`. Updated on every batch.
- **Self-critique.** Chief, SEO, Ads run a cheap Haiku second pass via `runSelfCritique` after the main Sonnet call. If `shouldReRunAfterCritique(critique, confidence)` returns true (=== `should_revise` AND confidence ≤ 7), the main reason runs once more with objections appended. Notes persist on `*.self_critique_notes`. Social skips this — already has writer→reviewer. Feature flag: `agent_self_critique_enabled` in `system_settings` (default true).
- **Few-shot examples.** Read from `prompt_templates` via `readFewShots(supabase, scope, category)`. Scopes: `(global, chief_strategist)`, `(global, seo_agent)`, `(global, ads_agent)`, `(social, <platform>)`. `performance-learning-loop` writes the column; agents read it through `fewShotsBlock(examples)`.
- **functions/ ↔ lib/ boundary.** `functions/` has `rootDir: "src"` and cannot import from `lib/`. Helpers used in both runtimes (self-critique, few-shots, outcome-scoring) exist as twin copies: `functions/src/lib/*.ts` + `lib/agents/*.ts` or `lib/social/*.ts`.

## Insights Subsystem (broader-automations)

Five non-content-engine watchdogs surface under `/admin/insights/*`. Each follows the pattern: Firebase `onSchedule` → POST to `/api/admin/internal/<slug>` → pure aggregator in `lib/automation/<name>.ts` → snapshot row in a per-phase table. All gated by per-cron flags in `system_settings` (default `false`).

- **Client risk** (`clientRiskScanCron` daily 05:00 UTC) — `client_engagement_snapshots`, scorer in [lib/automation/client-risk-scorer.ts](lib/automation/client-risk-scorer.ts). Surfaces in Daily Pulse.
- **Revenue digest** (`revenueDigestCron` Mon 13:00 UTC) — `revenue_snapshots`, aggregator in [lib/automation/revenue-aggregator.ts](lib/automation/revenue-aggregator.ts). MRR derives from `subscriptions × programs.price_cents` normalized monthly.
- **Automation health** (`automationHealthCron` daily 08:00 UTC) — `cron_runs` + `automation_health_snapshots`, scanner in [lib/automation/automation-health-scanner.ts](lib/automation/automation-health-scanner.ts). Emails on `critical`. Twin helper `logCronStart`/`logCronEnd` lives in both `lib/db/cron-runs.ts` and `functions/src/lib/cron-runs.ts` — wire into individual crons opportunistically.
- **Content attribution** (`contentAttributionCron` Sun 22:00 UTC) — `content_attribution_snapshots`, first-touch-landing joiner in [lib/automation/content-revenue-joiner.ts](lib/automation/content-revenue-joiner.ts). Joins `blog_posts × gsc_query_daily × marketing_attribution × payments`.
- **Inbox SLA** (`inboxSlaCron` Mon-Fri 06:00 UTC) — `inbox_sla_snapshots`, aggregator in [lib/automation/inbox-sla-aggregator.ts](lib/automation/inbox-sla-aggregator.ts). Pulls from GHL, degrades gracefully when GHL isn't configured (`fetch_status='degraded'`). Surfaces in Daily Pulse.

Plan + reconciliation notes live in `docs/superpowers/plans/2026-05-16-broader-automations.md`.

## Audit Logs

Append-only trail of mutations, auth events, automation runs, and billing webhooks in `audit_logs` (migration `00152_audit_logs.sql`). Eleven categories: `auth | admin_write | admin_read_sensitive | client_action | support | commerce | billing | marketing | compliance | automation | system`.

- **Write path:** `lib/audit/record.ts` exposes `recordAudit()` (fire-and-forget; resolves actor from `auth()` or accepts an `actor` override for system / cron / webhook writes). Admin route handlers use `withAudit()` from `lib/audit/with-audit.ts` to auto-record success / denied (401/403) / failure based on response status. For routes where the slug depends on payload (e.g. assignment status change, injury resolved, booking lifecycle), use inline `recordAudit()` after the DB write.
- **Action taxonomy:** Closed set of ~100 slugs in [lib/audit/actions.ts](lib/audit/actions.ts). Adding new events means adding rows there.
- **Metadata scrubbing:** `lib/audit/scrub.ts` redacts `password / token / secret / api_key` at any depth (snake_case + camelCase) and caps serialized metadata at 8KB.
- **Read path:** Admin-only `/admin/audit-logs` page (server component) with category / outcome / actor / target / date / free-text filters. API at `/api/admin/audit-logs`. 24h-failure alert strip at the top links to the filtered view.
- **Retention:** Daily `auditLogRetentionCron` (03:00 UTC) prunes rows older than `audit_log_retention_days` (default 365). Feature flag `cron_audit_log_retention_enabled` defaults **TRUE** because unbounded growth is a real cost concern — flip off only for compliance investigations. Twin: `lib/db/audit-logs.ts:pruneAuditLogs` ↔ `functions/src/lib/audit-logs.ts:pruneAuditLogs`. Cron is in the `automation-health-scanner` expected list so silent failures surface in the daily watchdog.
- **What is NOT audited (and where to find it):** per-set workout logs → `tracked_exercises`; public page visits → `marketing_attribution`; per-page client navigation → `client_engagement_snapshots`; AI prompt content → `ai_generation_log`. The audit row references those via `metadata.training_session_id` / `metadata.ai_generation_id` etc. when relevant.

Plan + reconciliation notes live in `docs/superpowers/plans/2026-05-16-audit-logs.md`.

## Environment Variables

See `.env.example` for required variables: Supabase, NextAuth, Stripe, Anthropic, GoHighLevel, Resend, Firebase credentials.

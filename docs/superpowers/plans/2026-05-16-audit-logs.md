# Audit Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture an append-only, queryable trail of every meaningful action across the app (auth, admin writes, billing, automation, config changes) so we can answer "who did what, when, to what, and from where" for security, support, and compliance.

**Architecture:** Single `audit_logs` table with a JSONB `metadata` column for flexibility, written via a fire-and-forget `recordAudit()` helper that snapshots actor identity from NextAuth + request headers. A `withAudit()` higher-order wrapper instruments admin API routes automatically; auth events are recorded inline from `lib/auth.ts` and the register/password-reset routes. Admin viewer at `/admin/audit-logs` with role, category, action, target, and date filters. Daily Firebase cron prunes rows older than the configured retention window (default 365 days).

**Tech Stack:** Supabase Postgres + RLS, Next.js 16 App Router route handlers, NextAuth v5, Zod, Vitest, Firebase `onSchedule` for retention, shadcn/ui for the viewer.

---

## Spec (read first)

### What gets logged

Audit logs are scoped to **mutations and security-sensitive events** across the entire app — admin, client, public, and system actors. Reads are excluded; **boundary events** (a session completed, an assessment submitted, a payment refunded) are logged, **bulk telemetry** (every set logged in a workout) is not. Categories:

| Category | Examples |
|---|---|
| `auth` | login success, login failure, logout, register, password reset request, password reset complete, email verification |
| `admin_write` | create/update/delete on users, programs, exercises, blog posts, lead magnets, shop products, events, testimonials, integrations, AI policies, strategy briefs, prompt templates |
| `admin_read_sensitive` | exporting client list, exporting financials, downloading full DB export |
| `client_action` | client completes a workout, submits assessment / reassessment, logs daily readiness, creates/edits/deletes a goal, reports/resolves an injury, submits a performance test, claims a PR, edits their own profile, changes notification prefs, cancels their own subscription |
| `support` | form review submitted by client / reviewed by coach, team-video submission, team-video annotation, team-video comment, inbox message sent by coach |
| `commerce` | shop order created / paid / fulfilled / refunded, download issued, lead captured, cart abandoned (manually flagged), booking created / rescheduled / cancelled / completed / no-show |
| `billing` | stripe webhook outcomes (checkout, subscription create/update/cancel, payment success/fail, refund), manual assignment status changes |
| `marketing` | newsletter subscribed/unsubscribed, lead-magnet downloaded, event signup created/cancelled, public contact form submitted, review submitted/moderated, testimonial submitted/moderated |
| `compliance` | consent granted/withdrawn (terms, privacy, waiver, parental, marketing), legal document version published, GDPR export / delete request, bulk delete from `/admin/reset-data`, waiver acceptance |
| `automation` | manual trigger of a cron from `/admin/automation`, agent run for chief / SEO / ads / social, AI program generation start/finish, AI feedback submitted, AI policy decision |
| `system` | feature flag toggle in `system_settings`, role change on a user, admin impersonation (future), API key rotation, integration token refresh failure |

### What does **not** get logged (and where to find it instead)

- Per-set / per-exercise log writes inside an in-progress workout → already in `training_sessions` + `tracked_exercises`. We audit the **session boundary** (`workout.completed`), not each set.
- Public page visits → `marketing_attribution`.
- Client viewing their own dashboard / browsing programs → `client_engagement_snapshots`.
- Cron heartbeat per-step → `cron_runs`.
- AI prompt/response content → `ai_generation_log` + `ai_conversations`.
- Health-check pings → ignored.

We reference these existing logs from the audit row via `metadata.cron_run_id` / `metadata.ai_generation_id` / `metadata.training_session_id` when relevant so a single audit row can pivot into them.

### Schema

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Actor identity (snapshot at time of event; nullable for system/cron actors)
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,                       -- 'admin' | 'client' | 'editor' | 'system' | 'anonymous'

  -- The action itself
  action TEXT NOT NULL,                  -- e.g. 'user.created', 'program.deleted', 'auth.login_failed'
  category TEXT NOT NULL CHECK (category IN (
    'auth','admin_write','admin_read_sensitive','client_action','support',
    'commerce','billing','marketing','compliance','automation','system'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','denied'))
    DEFAULT 'success',

  -- The thing being acted on
  target_type TEXT,                      -- 'user','program','exercise','blog_post','subscription',...
  target_id TEXT,                        -- text not uuid: some targets aren't uuids (e.g. stripe sub id, system_settings key)
  target_label TEXT,                     -- human-readable snapshot ('Jane Doe', 'Comeback Code Wk 3')

  -- Request context
  ip_address INET,
  user_agent TEXT,
  request_id TEXT,                       -- short id we generate; threaded through logs
  request_method TEXT,                   -- 'POST','PATCH','DELETE',...
  request_path TEXT,

  -- Failure detail
  error_code TEXT,                       -- '403','duplicate_email','stripe_card_declined',...
  error_message TEXT,

  -- Free-form
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id, created_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_logs_category_action ON audit_logs (category, action, created_at DESC);
CREATE INDEX idx_audit_logs_outcome ON audit_logs (outcome, created_at DESC)
  WHERE outcome IN ('failure','denied');
CREATE INDEX idx_audit_logs_metadata_gin ON audit_logs USING gin (metadata jsonb_path_ops);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- No policies: all reads/writes go through service-role.
-- Append-only convention enforced in DAL: no update(), no delete() except retention cron.
```

`actor_role = 'system'` covers cron / webhook / agent writes where no human is signed in. `actor_role = 'anonymous'` covers failed login attempts where we know the attempted email but no session.

### `recordAudit()` contract

```ts
type RecordAuditInput = {
  action: string                         // 'user.created', 'auth.login_failed', etc.
  category: AuditCategory
  outcome?: 'success' | 'failure' | 'denied'   // default 'success'
  target?: { type: string; id: string; label?: string }
  error?: { code?: string; message?: string }
  metadata?: Record<string, unknown>     // diffs, before/after, IDs of related logs
  // Either pass the request explicitly (preferred from route handlers)...
  request?: Request | NextRequest
  // ...or override actor for system/cron writes:
  actor?: { id?: string | null; email?: string | null; role?: string }
}

// Resolves session via auth() if not given via `actor`.
// Extracts ip, user-agent, method, path from `request`.
// Inserts into audit_logs via service-role client.
// Fire-and-forget: returns immediately, swallows errors with console.warn.
export function recordAudit(input: RecordAuditInput): Promise<void>
```

Two scrubbing rules baked in:

1. If `metadata` contains a key named `password`, `password_hash`, `token`, `secret`, or `api_key` (case-insensitive), the value is replaced with `'[REDACTED]'`.
2. `metadata` is capped at 8KB serialized; on overflow we store `{ truncated: true, sample: '<first 1KB>' }`.

### `withAudit()` wrapper

Decorator for App Router route handlers that auto-records on response:

```ts
export const PATCH = withAudit(
  { action: 'user.updated', category: 'admin_write', target: (req, ctx) => ({
      type: 'user',
      id: (ctx.params as { id: string }).id,
  }) },
  async (request, ctx) => { /* handler body */ }
)
```

The wrapper:

- Calls the inner handler, captures the `Response`.
- On 2xx, records `outcome: 'success'`.
- On 4xx, records `outcome: 'denied'` for 401/403, `'failure'` otherwise; pulls `error.message` from JSON body if present.
- On thrown exception, records `outcome: 'failure'`, error message, then re-throws.
- For dynamic targets, accepts a `target` function so we can resolve target id from params/body.

Wrapping is opt-in per-route — we don't blanket-wrap to avoid logging health checks and read endpoints. Phase 3 lists exactly which routes get wrapped.

### Action taxonomy (v1)

Stored as `lib/audit/actions.ts`. Each entry: `slug`, `category`, `description`. The full list (~80 slugs) lives in code; here's the shape:

```
auth.*                       auth         (login_succeeded, login_failed, logout, register, password_reset_*, email_verified)

user.*                       admin_write  (created, updated, deleted)
user.role_changed            system

program.*                    admin_write  (created, updated, deleted, published)
exercise.*                   admin_write  (created, updated, deleted)
assignment.*                 admin_write  (created, status_changed, deleted)
blog_post.*                  admin_write  (created, updated, deleted, published)
shop.product_*               admin_write  (created, updated, deleted)

integration.*                admin_write  (connected, disconnected) / system (refreshed)
system_setting.changed       system
feature_flag.toggled         system

workout.completed            client_action   (boundary — per-set data stays in training_sessions)
workout.session_started      client_action
workout.skipped              client_action
pr.claimed                   client_action
assessment.*                 client_action   (submitted, reassessment_submitted)
questionnaire.submitted      client_action
readiness.submitted          client_action
goal.*                       client_action   (created, updated, deleted)
injury.*                     client_action   (reported, updated, resolved)
performance_test.*           client_action   (submitted, deleted)
profile.updated              client_action
notification_preferences.changed client_action
subscription.cancel_requested client_action

form_review.*                support         (submitted, reviewed, deleted)
team_video.*                 support         (submitted, annotated, commented, version_added)
inbox.message_sent           support

booking.*                    commerce        (created, rescheduled, cancelled, completed, no_show)
shop.order_*                 commerce        (created, paid, fulfilled, refunded)
shop.download_issued         commerce
shop.lead_captured           commerce

stripe.*                     billing         (checkout_completed, subscription_*, payment_*, refund)

newsletter.*                 marketing       (subscribed, unsubscribed, sent)
lead_magnet.downloaded       marketing
event_signup.*               marketing       (created, cancelled)
contact.submitted            marketing
review.*                     marketing       (submitted, moderated)
testimonial.*                marketing       (submitted, moderated)

consent.*                    compliance      (granted, withdrawn)
marketing_consent.changed    compliance
legal_document.published     compliance
data.*                       compliance      (export, deleted_bulk)
gdpr.*                       compliance      (export_requested, delete_requested)

cron.manual_trigger          automation
agent.run                    automation
ai.generation_started        automation
ai.generation_completed      automation
```

This list is **closed at v1** — adding a new action means adding a row in `lib/audit/actions.ts`. That keeps `action` a well-known enum-ish set for filtering UIs and dashboards.

### Retention

Default retention: **365 days**. Stored in `system_settings` as `audit_log_retention_days`. Daily Firebase cron `auditLogRetentionCron` (03:00 UTC) deletes rows older than the configured window via service-role DAL function `pruneAuditLogs(days)`. Cron is **enabled by default** unlike most others, because unbounded growth here is a real cost concern. Disabling means data keeps accumulating — surface that clearly in the admin toggle UI.

### UI

`/admin/audit-logs`:

- Server component, paginated server-side (50 per page).
- Filters in URL search params so links are shareable: `?category=auth&outcome=failure&actor=<uuid>&q=<freeText>&from=2026-05-01&to=2026-05-16`.
- Table columns: When, Actor (email + role), Action, Target (type + label), Outcome (badge), IP. Row click expands JSON metadata + error.
- Top-of-page "alert strip" shows count of `outcome IN ('failure','denied')` in the last 24h, linking to the filtered view.

### What does success look like

After this lands:

1. Logging in (success or fail) writes one row to `audit_logs`.
2. Any admin write through the listed endpoints writes one row.
3. Stripe webhooks write one row per relevant event.
4. The `/admin/audit-logs` page renders within 500ms for the latest 50 rows with filters applied.
5. No route handler latency regression > 5ms p95 from instrumentation (verified by spot-checking a wrapped vs unwrapped endpoint).
6. Retention cron runs nightly and surfaces in `/admin/insights/automation` like the others.

---

## File Structure

**Create:**
- `supabase/migrations/00152_audit_logs.sql`
- `lib/audit/types.ts`
- `lib/audit/actions.ts`
- `lib/audit/scrub.ts`
- `lib/audit/record.ts`
- `lib/audit/with-audit.ts`
- `lib/db/audit-logs.ts`
- `app/api/admin/audit-logs/route.ts`
- `app/(admin)/admin/audit-logs/page.tsx`
- `components/admin/audit-log-table.tsx`
- `components/admin/audit-log-filters.tsx`
- `components/admin/audit-log-row.tsx`
- `__tests__/db/audit-logs.test.ts`
- `__tests__/lib/audit-record.test.ts`
- `__tests__/lib/audit-scrub.test.ts`
- `__tests__/api/admin/audit-logs.test.ts`

**Modify — Auth (Phase 2):**
- `lib/auth.ts` — record login success / failure from `authorize()`
- `app/api/auth/register/route.ts` — record `auth.register`
- `app/api/auth/forgot-password/route.ts` — record `auth.password_reset_request`
- `app/api/auth/reset-password/route.ts` — record `auth.password_reset_complete`
- `app/api/auth/verify-email/route.ts` — record `auth.email_verified`

**Modify — Admin writes (Phase 3):**
- `app/api/admin/clients/[id]/route.ts` — wrap PATCH/DELETE
- `app/api/admin/users/route.ts` — wrap POST
- `app/api/admin/programs/route.ts` — wrap POST
- `app/api/admin/programs/[id]/route.ts` — wrap PATCH/DELETE
- `app/api/admin/exercises/route.ts` — wrap POST
- `app/api/admin/exercises/[id]/route.ts` — wrap PATCH/DELETE
- `app/api/admin/blog-posts/route.ts` — wrap POST
- `app/api/admin/blog-posts/[id]/route.ts` — wrap PATCH/DELETE
- `app/api/admin/assignments/...` — wrap mutations
- `app/api/admin/integrations/...` — wrap connect/disconnect
- `app/api/admin/platform-connections/...` — wrap mutations
- `app/api/admin/legal/...` — wrap legal-document version publish
- `app/api/admin/internal/automation/trigger/route.ts` (or equivalent) — wrap manual cron trigger
- `app/api/admin/shop/...` — wrap product mutations
- `app/api/admin/reviews/[id]/route.ts` — record `review.moderated`
- `app/api/admin/testimonials/[id]/route.ts` — record `testimonial.moderated`
- `app/api/admin/inbox/.../send/route.ts` (or equivalent) — record `inbox.message_sent`
- `app/api/webhooks/stripe/route.ts` — per-event-type lines

**Modify — Client actions (Phase 3.5):**
- `app/api/training-sessions/route.ts` + `[id]/route.ts` — record `workout.session_started`, `workout.completed`, `workout.skipped`
- `app/api/client/workouts/...` + `app/api/client/workout-logs/...` — record `workout.completed` and `pr.claimed`
- `app/api/assessment/submit/route.ts` — `assessment.submitted`
- `app/api/assessment/reassess/route.ts` — `assessment.reassessment_submitted`
- `app/api/questionnaire/route.ts` — `questionnaire.submitted`
- `app/api/readiness/route.ts` — `readiness.submitted`
- `app/api/athlete-goals/route.ts` + `[id]/route.ts` — `goal.created/updated/deleted`
- `app/api/injuries/route.ts` + `[id]/route.ts` — `injury.reported/updated/resolved`
- `app/api/performance-tests/route.ts` + `[id]/route.ts` — `performance_test.submitted/deleted`
- `app/api/client/profile/route.ts` — `profile.updated`
- `app/api/notification-preferences/route.ts` — `notification_preferences.changed`
- `app/api/client/payments/.../cancel/route.ts` — `subscription.cancel_requested`
- `app/api/client/achievements/route.ts` — `pr.claimed`
- `app/api/client/ai-feedback/route.ts` — `ai.feedback_submitted` (add slug to taxonomy if missing)

**Modify — Support (Phase 3.6):**
- `app/api/client/form-reviews/route.ts` + `[id]/route.ts` — `form_review.submitted/deleted`
- `app/api/admin/form-reviews/[id]/route.ts` — `form_review.reviewed`
- `app/api/admin/team-videos/...` (submit/version/annotate/comment) — `team_video.*`
- `app/api/admin/inbox/.../send/route.ts` — `inbox.message_sent`

**Modify — Commerce (Phase 3.7):**
- `app/api/admin/bookings/...` and any client booking endpoint — `booking.*`
- `app/api/shop/checkout/route.ts` — `shop.order_created`
- `app/api/shop/webhooks/.../route.ts` — `shop.order_paid`, `shop.order_refunded`
- `app/api/shop/orders/[id]/fulfill/route.ts` (or equivalent admin route) — `shop.order_fulfilled`
- `app/api/shop/downloads/...` — `shop.download_issued`
- `app/api/shop/leads/route.ts` — `shop.lead_captured`

**Modify — Marketing (Phase 3.8 part A):**
- `app/api/newsletter/route.ts` — `newsletter.subscribed`
- `app/api/newsletter/unsubscribe/route.ts` — `newsletter.unsubscribed`
- `app/api/admin/newsletter/send/route.ts` (or equivalent) — `newsletter.sent`
- `app/api/public/lead-magnets/...` or `app/api/admin/lead-magnets/[id]/download/route.ts` — `lead_magnet.downloaded`
- `app/api/events/[id]/signup/route.ts` (or equivalent) — `event_signup.created/cancelled`
- `app/api/contact/route.ts` or `app/api/inquiry/route.ts` — `contact.submitted`
- `app/api/public/reviews/route.ts` and admin moderation endpoint — `review.submitted/moderated`
- `app/api/public/testimonials/route.ts` and admin moderation endpoint — `testimonial.submitted/moderated`

**Modify — Compliance (Phase 3.8 part B):**
- `app/api/consents/waiver/route.ts` and any other consent endpoints — `consent.granted/withdrawn`
- `app/api/account/marketing-consent/route.ts` (or equivalent) — `marketing_consent.changed`
- `app/api/admin/legal/publish/route.ts` (or equivalent) — `legal_document.published`
- `app/api/admin/reset-data/route.ts` — `data.deleted_bulk`
- Future GDPR endpoints — `gdpr.export_requested`, `gdpr.delete_requested`

**Modify — UI / Retention (Phases 4 & 5):**
- `components/admin/admin-sidebar.tsx` (or equivalent) — add "Audit Logs" link
- `functions/src/index.ts` — add `auditLogRetentionCron`
- `functions/src/lib/audit-logs.ts` (twin) — `pruneAuditLogs(supabase, days)`
- `lib/automation/automation-health-scanner.ts` + functions twin — add retention cron to expected list
- `CLAUDE.md` — describe the subsystem

---

## Task Decomposition

Phases are independent in the sense that each leaves the app in a working state, but they're sequential — Phase 2+ depend on Phase 1 primitives.

### Phase 1 — Foundation

Build the table, types, scrubber, DAL, recorder, and wrapper. No instrumentation yet.

---

### Task 1.1: Migration — `audit_logs` table + retention setting

**Files:**
- Create: `supabase/migrations/00152_audit_logs.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 00152_audit_logs.sql
-- Append-only audit trail across the app. Written via service-role DAL only.
-- No RLS policies: reads/writes go through server code, never the browser client.

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,

  action TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'auth','admin_write','admin_read_sensitive','client_action','support',
    'commerce','billing','marketing','compliance','automation','system'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','denied'))
    DEFAULT 'success',

  target_type TEXT,
  target_id TEXT,
  target_label TEXT,

  ip_address INET,
  user_agent TEXT,
  request_id TEXT,
  request_method TEXT,
  request_path TEXT,

  error_code TEXT,
  error_message TEXT,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category_action ON audit_logs (category, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_outcome ON audit_logs (outcome, created_at DESC)
  WHERE outcome IN ('failure','denied');
CREATE INDEX IF NOT EXISTS idx_audit_logs_metadata_gin ON audit_logs USING gin (metadata jsonb_path_ops);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

INSERT INTO system_settings (key, value, description) VALUES
  (
    'audit_log_retention_days',
    '365'::jsonb,
    'How many days of audit_logs to keep. The daily auditLogRetentionCron (03:00 UTC) deletes older rows.'
  ),
  (
    'cron_audit_log_retention_enabled',
    'true'::jsonb,
    'When true, auditLogRetentionCron prunes audit_logs nightly. Defaults TRUE (cost concern: unbounded growth). Disabling means the table grows forever — toggle off only for compliance investigations.'
  )
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply the migration via MCP**

Apply with `mcp__supabase__apply_migration` (name: `00152_audit_logs`, query: the SQL above). Per project memory, the CLI is not linked — do not suggest `supabase db push`.

- [ ] **Step 3: Verify with `mcp__supabase__list_tables`**

Confirm `audit_logs` appears with the columns and indexes from the migration.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00152_audit_logs.sql
git commit -m "feat(audit): add audit_logs table + retention settings"
```

---

### Task 1.2: Action taxonomy + types

**Files:**
- Create: `lib/audit/types.ts`
- Create: `lib/audit/actions.ts`

- [ ] **Step 1: Write `lib/audit/types.ts`**

```ts
export type AuditCategory =
  | "auth"
  | "admin_write"
  | "admin_read_sensitive"
  | "client_action"
  | "support"
  | "commerce"
  | "billing"
  | "marketing"
  | "compliance"
  | "automation"
  | "system"

export type AuditOutcome = "success" | "failure" | "denied"

export type AuditActorRole = "admin" | "client" | "editor" | "system" | "anonymous"

export interface AuditTarget {
  type: string
  id: string
  label?: string
}

export interface AuditLogRow {
  id: string
  created_at: string
  actor_id: string | null
  actor_email: string | null
  actor_role: AuditActorRole | null
  action: string
  category: AuditCategory
  outcome: AuditOutcome
  target_type: string | null
  target_id: string | null
  target_label: string | null
  ip_address: string | null
  user_agent: string | null
  request_id: string | null
  request_method: string | null
  request_path: string | null
  error_code: string | null
  error_message: string | null
  metadata: Record<string, unknown>
}
```

- [ ] **Step 2: Write `lib/audit/actions.ts`**

```ts
import type { AuditCategory } from "./types"

export interface AuditActionDef {
  slug: string
  category: AuditCategory
  description: string
}

// Closed enum-ish set. Adding a new action means adding a row here.
export const AUDIT_ACTIONS = [
  // auth
  { slug: "auth.login_succeeded",         category: "auth", description: "User signed in successfully" },
  { slug: "auth.login_failed",            category: "auth", description: "Sign-in attempt rejected (bad credentials)" },
  { slug: "auth.logout",                  category: "auth", description: "User signed out" },
  { slug: "auth.register",                category: "auth", description: "New account registered" },
  { slug: "auth.password_reset_request",  category: "auth", description: "Password reset email requested" },
  { slug: "auth.password_reset_complete", category: "auth", description: "Password successfully reset" },
  { slug: "auth.email_verified",          category: "auth", description: "Email address verified" },

  // user / admin_write
  { slug: "user.created",                 category: "admin_write", description: "Admin created a user record" },
  { slug: "user.updated",                 category: "admin_write", description: "Admin updated a user record" },
  { slug: "user.deleted",                 category: "admin_write", description: "Admin deleted a user record" },
  { slug: "user.role_changed",            category: "system",      description: "User role changed" },

  // programs / assignments
  { slug: "program.created",              category: "admin_write", description: "Program created" },
  { slug: "program.updated",              category: "admin_write", description: "Program updated" },
  { slug: "program.deleted",              category: "admin_write", description: "Program deleted" },
  { slug: "program.published",            category: "admin_write", description: "Program status moved to published" },
  { slug: "assignment.created",           category: "admin_write", description: "Program assigned to a client" },
  { slug: "assignment.status_changed",    category: "admin_write", description: "Assignment status changed" },
  { slug: "assignment.deleted",           category: "admin_write", description: "Assignment removed" },

  // content
  { slug: "exercise.created",             category: "admin_write", description: "Exercise created" },
  { slug: "exercise.updated",             category: "admin_write", description: "Exercise updated" },
  { slug: "exercise.deleted",             category: "admin_write", description: "Exercise deleted" },
  { slug: "blog_post.created",            category: "admin_write", description: "Blog post created" },
  { slug: "blog_post.updated",            category: "admin_write", description: "Blog post updated" },
  { slug: "blog_post.deleted",            category: "admin_write", description: "Blog post deleted" },
  { slug: "blog_post.published",          category: "admin_write", description: "Blog post published" },

  // integrations / config
  { slug: "integration.connected",        category: "admin_write", description: "Third-party integration connected" },
  { slug: "integration.disconnected",     category: "admin_write", description: "Third-party integration disconnected" },
  { slug: "integration.refreshed",        category: "system",      description: "OAuth token refresh occurred" },
  { slug: "system_setting.changed",       category: "system",      description: "system_settings row updated" },
  { slug: "feature_flag.toggled",         category: "system",      description: "Feature flag toggled" },

  // billing
  { slug: "stripe.checkout_completed",    category: "billing", description: "Stripe Checkout session completed" },
  { slug: "stripe.subscription_created",  category: "billing", description: "Stripe subscription created" },
  { slug: "stripe.subscription_updated",  category: "billing", description: "Stripe subscription updated" },
  { slug: "stripe.subscription_canceled", category: "billing", description: "Stripe subscription canceled" },
  { slug: "stripe.payment_succeeded",     category: "billing", description: "Stripe payment succeeded" },
  { slug: "stripe.payment_failed",        category: "billing", description: "Stripe payment failed" },
  { slug: "stripe.refund",                category: "billing", description: "Stripe refund issued" },

  // automation
  { slug: "cron.manual_trigger",          category: "automation", description: "Cron was manually triggered from admin UI" },
  { slug: "agent.run",                    category: "automation", description: "Strategy team agent completed a run" },
  { slug: "ai.generation_started",        category: "automation", description: "AI program generation started" },
  { slug: "ai.generation_completed",      category: "automation", description: "AI program generation completed" },

  // client_action — workout / training side
  { slug: "workout.completed",            category: "client_action", description: "Client marked a training session complete (boundary event; per-set data in training_sessions)" },
  { slug: "workout.session_started",      category: "client_action", description: "Client started a training session" },
  { slug: "workout.skipped",              category: "client_action", description: "Client marked a session as skipped" },
  { slug: "pr.claimed",                   category: "client_action", description: "Personal record reached / claimed" },

  // client_action — assessments + readiness + goals + injuries + performance
  { slug: "assessment.submitted",         category: "client_action", description: "Initial assessment submitted" },
  { slug: "assessment.reassessment_submitted", category: "client_action", description: "Reassessment submitted" },
  { slug: "questionnaire.submitted",      category: "client_action", description: "Onboarding questionnaire submitted" },
  { slug: "readiness.submitted",          category: "client_action", description: "Daily readiness check-in submitted" },
  { slug: "goal.created",                 category: "client_action", description: "Athlete goal created" },
  { slug: "goal.updated",                 category: "client_action", description: "Athlete goal updated" },
  { slug: "goal.deleted",                 category: "client_action", description: "Athlete goal deleted" },
  { slug: "injury.reported",              category: "client_action", description: "Injury reported" },
  { slug: "injury.updated",               category: "client_action", description: "Injury updated (status, notes)" },
  { slug: "injury.resolved",              category: "client_action", description: "Injury marked resolved" },
  { slug: "performance_test.submitted",   category: "client_action", description: "Performance test result submitted" },
  { slug: "performance_test.deleted",     category: "client_action", description: "Performance test entry deleted" },

  // client_action — profile + preferences + self-service billing
  { slug: "profile.updated",              category: "client_action", description: "Client updated their own profile" },
  { slug: "notification_preferences.changed", category: "client_action", description: "Notification preferences changed" },
  { slug: "subscription.cancel_requested", category: "client_action", description: "Client requested self-service cancel" },

  // support — coach<>client flows
  { slug: "form_review.submitted",        category: "support", description: "Client submitted a video for form review" },
  { slug: "form_review.reviewed",         category: "support", description: "Coach left feedback on a form review" },
  { slug: "form_review.deleted",          category: "support", description: "Form review removed" },
  { slug: "team_video.submitted",         category: "support", description: "Team video submission uploaded" },
  { slug: "team_video.annotated",         category: "support", description: "Annotation added to team video" },
  { slug: "team_video.commented",         category: "support", description: "Comment added to team video" },
  { slug: "team_video.version_added",     category: "support", description: "New version uploaded to team video submission" },
  { slug: "inbox.message_sent",           category: "support", description: "Coach sent a message via GHL inbox bridge" },

  // commerce — bookings + shop
  { slug: "booking.created",              category: "commerce", description: "Booking created" },
  { slug: "booking.rescheduled",          category: "commerce", description: "Booking rescheduled" },
  { slug: "booking.cancelled",            category: "commerce", description: "Booking cancelled" },
  { slug: "booking.completed",            category: "commerce", description: "Booking marked completed" },
  { slug: "booking.no_show",              category: "commerce", description: "Booking marked no-show" },
  { slug: "shop.order_created",           category: "commerce", description: "Shop order created" },
  { slug: "shop.order_paid",              category: "commerce", description: "Shop order marked paid (Stripe webhook bridge)" },
  { slug: "shop.order_fulfilled",         category: "commerce", description: "Shop order fulfilled" },
  { slug: "shop.order_refunded",          category: "commerce", description: "Shop order refunded" },
  { slug: "shop.download_issued",         category: "commerce", description: "Digital download link issued" },
  { slug: "shop.lead_captured",           category: "commerce", description: "Shop lead captured (pre-purchase)" },
  { slug: "shop.product_created",         category: "admin_write", description: "Shop product created (admin)" },
  { slug: "shop.product_updated",         category: "admin_write", description: "Shop product updated (admin)" },
  { slug: "shop.product_deleted",         category: "admin_write", description: "Shop product deleted (admin)" },

  // marketing — public / outbound
  { slug: "newsletter.subscribed",        category: "marketing", description: "Newsletter subscription created" },
  { slug: "newsletter.unsubscribed",      category: "marketing", description: "Newsletter unsubscribe processed" },
  { slug: "newsletter.sent",              category: "marketing", description: "Newsletter campaign sent" },
  { slug: "lead_magnet.downloaded",       category: "marketing", description: "Lead magnet downloaded" },
  { slug: "event_signup.created",         category: "marketing", description: "Public event signup" },
  { slug: "event_signup.cancelled",       category: "marketing", description: "Event signup cancelled" },
  { slug: "contact.submitted",            category: "marketing", description: "Public contact form submitted" },
  { slug: "review.submitted",             category: "marketing", description: "Public review submitted" },
  { slug: "review.moderated",             category: "marketing", description: "Admin moderated a review (approve/reject)" },
  { slug: "testimonial.submitted",        category: "marketing", description: "Testimonial submitted" },
  { slug: "testimonial.moderated",        category: "marketing", description: "Admin moderated a testimonial" },

  // compliance — consents + GDPR + legal
  { slug: "consent.granted",              category: "compliance", description: "User accepted a legal consent (terms / privacy / waiver / parental)" },
  { slug: "consent.withdrawn",            category: "compliance", description: "User withdrew a consent" },
  { slug: "marketing_consent.changed",    category: "compliance", description: "Marketing consent preference changed" },
  { slug: "legal_document.published",     category: "compliance", description: "New version of a legal document published" },
  { slug: "data.export",                  category: "compliance", description: "Data export performed" },
  { slug: "data.deleted_bulk",            category: "compliance", description: "Bulk delete operation" },
  { slug: "gdpr.export_requested",        category: "compliance", description: "GDPR export requested" },
  { slug: "gdpr.delete_requested",        category: "compliance", description: "GDPR delete requested" },
] as const satisfies readonly AuditActionDef[]

export type AuditAction = (typeof AUDIT_ACTIONS)[number]["slug"]

const SLUG_INDEX = new Map(AUDIT_ACTIONS.map((a) => [a.slug, a]))
export function getActionDef(slug: string): AuditActionDef | undefined {
  return SLUG_INDEX.get(slug)
}
```

- [ ] **Step 2b: Run the type-checker**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors. (Existing baseline errors are out of scope.)

- [ ] **Step 3: Commit**

```bash
git add lib/audit/types.ts lib/audit/actions.ts
git commit -m "feat(audit): action taxonomy + types"
```

---

### Task 1.3: Scrubber + tests

**Files:**
- Create: `lib/audit/scrub.ts`
- Test: `__tests__/lib/audit-scrub.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import { scrubMetadata } from "@/lib/audit/scrub"

describe("scrubMetadata", () => {
  it("redacts password-like keys at any depth", () => {
    const input = {
      email: "x@example.com",
      password: "hunter2",
      nested: { api_key: "sk_live_123", Token: "t", innocent: "ok" },
    }
    const out = scrubMetadata(input)
    expect(out.password).toBe("[REDACTED]")
    expect((out.nested as Record<string, unknown>).api_key).toBe("[REDACTED]")
    expect((out.nested as Record<string, unknown>).Token).toBe("[REDACTED]")
    expect((out.nested as Record<string, unknown>).innocent).toBe("ok")
    expect(out.email).toBe("x@example.com")
  })

  it("redacts keys regardless of case", () => {
    const out = scrubMetadata({ PASSWORD: "x", Password_Hash: "y", SECRET: "z" })
    expect(out.PASSWORD).toBe("[REDACTED]")
    expect(out.Password_Hash).toBe("[REDACTED]")
    expect(out.SECRET).toBe("[REDACTED]")
  })

  it("truncates oversized payloads to a sample", () => {
    const big = { huge: "x".repeat(20_000) }
    const out = scrubMetadata(big)
    expect(out.truncated).toBe(true)
    expect(typeof out.sample).toBe("string")
    expect((out.sample as string).length).toBeLessThanOrEqual(1100)
  })

  it("returns {} for null/undefined input", () => {
    expect(scrubMetadata(null)).toEqual({})
    expect(scrubMetadata(undefined)).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/audit-scrub.test.ts`
Expected: FAIL (`Cannot find module '@/lib/audit/scrub'`)

- [ ] **Step 3: Write `lib/audit/scrub.ts`**

```ts
const REDACT_KEY_PATTERN = /(^|_)(password|password_hash|token|secret|api_key)($|_)/i
const MAX_SERIALIZED_BYTES = 8 * 1024
const SAMPLE_BYTES = 1024

function redactRecursive(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(redactRecursive)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEY_PATTERN.test(k)) {
      out[k] = "[REDACTED]"
    } else {
      out[k] = redactRecursive(v)
    }
  }
  return out
}

export function scrubMetadata(input: unknown): Record<string, unknown> {
  if (input == null) return {}
  if (typeof input !== "object") return {}

  const redacted = redactRecursive(input) as Record<string, unknown>
  let serialized: string
  try {
    serialized = JSON.stringify(redacted)
  } catch {
    return { truncated: true, sample: "[unserializable]" }
  }
  if (serialized.length <= MAX_SERIALIZED_BYTES) return redacted
  return { truncated: true, sample: serialized.slice(0, SAMPLE_BYTES) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/audit-scrub.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/audit/scrub.ts __tests__/lib/audit-scrub.test.ts
git commit -m "feat(audit): metadata scrubber for secrets + size cap"
```

---

### Task 1.4: DAL — `lib/db/audit-logs.ts`

**Files:**
- Create: `lib/db/audit-logs.ts`
- Test: `__tests__/db/audit-logs.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { insertAuditLog, listAuditLogs, pruneAuditLogs } from "@/lib/db/audit-logs"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TARGET_ID = "00000000-0000-0000-0000-0000000ad001"

describe("audit-logs DAL", () => {
  const supabase = createServiceRoleClient()

  beforeEach(async () => {
    await supabase.from("audit_logs").delete().eq("target_id", TEST_TARGET_ID)
  })

  it("insertAuditLog writes a row and listAuditLogs returns it", async () => {
    await insertAuditLog({
      action: "user.updated",
      category: "admin_write",
      outcome: "success",
      target_type: "user",
      target_id: TEST_TARGET_ID,
      target_label: "Test User",
      metadata: { changed: ["email"] },
    })

    const { rows, total } = await listAuditLogs({ target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(total).toBe(1)
    expect(rows[0].action).toBe("user.updated")
    expect(rows[0].metadata).toEqual({ changed: ["email"] })
  })

  it("listAuditLogs filters by category, outcome, date range, and free-text", async () => {
    await insertAuditLog({ action: "user.updated", category: "admin_write", outcome: "success", target_type: "user", target_id: TEST_TARGET_ID })
    await insertAuditLog({ action: "auth.login_failed", category: "auth", outcome: "failure", target_type: "user", target_id: TEST_TARGET_ID, actor_email: "needle@example.com" })

    const failures = await listAuditLogs({ outcome: "failure", target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(failures.total).toBe(1)
    expect(failures.rows[0].action).toBe("auth.login_failed")

    const authOnly = await listAuditLogs({ category: "auth", target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(authOnly.total).toBe(1)

    const byEmail = await listAuditLogs({ q: "needle", target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(byEmail.total).toBe(1)
  })

  it("pruneAuditLogs deletes rows older than N days", async () => {
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 100).toISOString()
    await supabase.from("audit_logs").insert({
      action: "user.updated",
      category: "admin_write",
      outcome: "success",
      target_type: "user",
      target_id: TEST_TARGET_ID,
      created_at: oldDate,
    })
    await insertAuditLog({ action: "user.updated", category: "admin_write", outcome: "success", target_type: "user", target_id: TEST_TARGET_ID })

    const deleted = await pruneAuditLogs(30)
    expect(deleted).toBeGreaterThanOrEqual(1)

    const { total } = await listAuditLogs({ target_type: "user", target_id: TEST_TARGET_ID, page: 1, perPage: 10 })
    expect(total).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/db/audit-logs.test.ts`
Expected: FAIL (`Cannot find module '@/lib/db/audit-logs'`)

- [ ] **Step 3: Write `lib/db/audit-logs.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  AuditCategory,
  AuditLogRow,
  AuditOutcome,
  AuditActorRole,
} from "@/lib/audit/types"

function getClient(): SupabaseClient {
  return createServiceRoleClient()
}

export interface InsertAuditLogInput {
  action: string
  category: AuditCategory
  outcome?: AuditOutcome
  actor_id?: string | null
  actor_email?: string | null
  actor_role?: AuditActorRole | null
  target_type?: string | null
  target_id?: string | null
  target_label?: string | null
  ip_address?: string | null
  user_agent?: string | null
  request_id?: string | null
  request_method?: string | null
  request_path?: string | null
  error_code?: string | null
  error_message?: string | null
  metadata?: Record<string, unknown>
}

export async function insertAuditLog(input: InsertAuditLogInput): Promise<void> {
  const supabase = getClient()
  const row = {
    action: input.action,
    category: input.category,
    outcome: input.outcome ?? "success",
    actor_id: input.actor_id ?? null,
    actor_email: input.actor_email ?? null,
    actor_role: input.actor_role ?? null,
    target_type: input.target_type ?? null,
    target_id: input.target_id ?? null,
    target_label: input.target_label ?? null,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    request_id: input.request_id ?? null,
    request_method: input.request_method ?? null,
    request_path: input.request_path ?? null,
    error_code: input.error_code ?? null,
    error_message: input.error_message ?? null,
    metadata: input.metadata ?? {},
  }
  const { error } = await supabase.from("audit_logs").insert(row)
  if (error) {
    console.warn(`[audit_logs] insert failed: ${error.message}`)
  }
}

export interface ListAuditLogsFilters {
  category?: AuditCategory
  action?: string
  outcome?: AuditOutcome
  actor_id?: string
  target_type?: string
  target_id?: string
  from?: string  // ISO
  to?: string    // ISO
  q?: string     // free text over actor_email / target_label / error_message
  page: number
  perPage: number
}

export interface ListAuditLogsResult {
  rows: AuditLogRow[]
  total: number
}

export async function listAuditLogs(f: ListAuditLogsFilters): Promise<ListAuditLogsResult> {
  const supabase = getClient()
  const fromRow = (f.page - 1) * f.perPage
  const toRow = fromRow + f.perPage - 1

  let q = supabase.from("audit_logs").select("*", { count: "exact" })

  if (f.category) q = q.eq("category", f.category)
  if (f.action) q = q.eq("action", f.action)
  if (f.outcome) q = q.eq("outcome", f.outcome)
  if (f.actor_id) q = q.eq("actor_id", f.actor_id)
  if (f.target_type) q = q.eq("target_type", f.target_type)
  if (f.target_id) q = q.eq("target_id", f.target_id)
  if (f.from) q = q.gte("created_at", f.from)
  if (f.to) q = q.lte("created_at", f.to)
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`
    q = q.or(
      `actor_email.ilike.${like},target_label.ilike.${like},error_message.ilike.${like}`,
    )
  }

  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .range(fromRow, toRow)

  if (error) throw error
  return { rows: (data ?? []) as AuditLogRow[], total: count ?? 0 }
}

export async function pruneAuditLogs(days: number): Promise<number> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("audit_logs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff)
  if (error) throw error
  return count ?? 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/db/audit-logs.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/db/audit-logs.ts __tests__/db/audit-logs.test.ts
git commit -m "feat(audit): audit_logs DAL with insert/list/prune"
```

---

### Task 1.5: `recordAudit()` recorder

**Files:**
- Create: `lib/audit/record.ts`
- Test: `__tests__/lib/audit-record.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock auth() to control session presence
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "11111111-1111-1111-1111-111111111111", email: "a@b.com", role: "admin", name: "Tester" },
  }),
}))

import { recordAudit } from "@/lib/audit/record"
import { listAuditLogs } from "@/lib/db/audit-logs"
import { createServiceRoleClient } from "@/lib/supabase"

const ACTOR = "11111111-1111-1111-1111-111111111111"

describe("recordAudit", () => {
  const supabase = createServiceRoleClient()
  beforeEach(async () => {
    await supabase.from("audit_logs").delete().eq("actor_id", ACTOR)
  })

  it("resolves actor from session and writes a row", async () => {
    await recordAudit({
      action: "user.updated",
      category: "admin_write",
      target: { type: "user", id: "tgt-1", label: "Jane Doe" },
      metadata: { changed: ["email"] },
    })
    const { rows } = await listAuditLogs({ actor_id: ACTOR, page: 1, perPage: 10 })
    expect(rows[0].action).toBe("user.updated")
    expect(rows[0].actor_email).toBe("a@b.com")
    expect(rows[0].actor_role).toBe("admin")
    expect(rows[0].target_id).toBe("tgt-1")
  })

  it("scrubs sensitive metadata keys", async () => {
    await recordAudit({
      action: "user.updated",
      category: "admin_write",
      metadata: { password: "hunter2", normal: "ok" },
    })
    const { rows } = await listAuditLogs({ actor_id: ACTOR, page: 1, perPage: 10 })
    expect(rows[0].metadata.password).toBe("[REDACTED]")
    expect(rows[0].metadata.normal).toBe("ok")
  })

  it("extracts ip + ua from request headers when provided", async () => {
    const req = new Request("https://example.com/api/admin/users", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1", "user-agent": "Mozilla/Test" },
    })
    await recordAudit({ action: "user.created", category: "admin_write", request: req })
    const { rows } = await listAuditLogs({ actor_id: ACTOR, page: 1, perPage: 10 })
    expect(rows[0].ip_address).toBe("203.0.113.5")
    expect(rows[0].user_agent).toBe("Mozilla/Test")
    expect(rows[0].request_method).toBe("POST")
    expect(rows[0].request_path).toBe("/api/admin/users")
  })

  it("honors actor override (for system/cron writes)", async () => {
    await recordAudit({
      action: "cron.manual_trigger",
      category: "automation",
      actor: { id: null, email: "system", role: "system" },
      metadata: { cron_name: "automationHealthCron" },
    })
    const { rows } = await listAuditLogs({ page: 1, perPage: 10, category: "automation" })
    const row = rows.find((r) => r.metadata.cron_name === "automationHealthCron")
    expect(row?.actor_role).toBe("system")
    expect(row?.actor_email).toBe("system")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/audit-record.test.ts`
Expected: FAIL (`Cannot find module '@/lib/audit/record'`)

- [ ] **Step 3: Write `lib/audit/record.ts`**

```ts
import { auth } from "@/lib/auth"
import { insertAuditLog } from "@/lib/db/audit-logs"
import { scrubMetadata } from "@/lib/audit/scrub"
import type {
  AuditCategory,
  AuditOutcome,
  AuditTarget,
  AuditActorRole,
} from "@/lib/audit/types"

export interface RecordAuditInput {
  action: string
  category: AuditCategory
  outcome?: AuditOutcome
  target?: AuditTarget
  error?: { code?: string; message?: string }
  metadata?: Record<string, unknown>
  request?: Request
  actor?: { id?: string | null; email?: string | null; role?: AuditActorRole | string }
  requestId?: string
}

function firstIp(forwarded: string | null): string | null {
  if (!forwarded) return null
  const first = forwarded.split(",")[0]?.trim()
  return first && first.length > 0 ? first : null
}

function pathFromRequest(req: Request): string | null {
  try {
    return new URL(req.url).pathname
  } catch {
    return null
  }
}

/**
 * Fire-and-forget audit recorder. Resolves actor from NextAuth unless overridden.
 * Never throws — errors are logged to console.warn so callers can drop it in
 * route handlers without try/catch noise.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    let actorId: string | null = null
    let actorEmail: string | null = null
    let actorRole: string | null = null

    if (input.actor) {
      actorId = input.actor.id ?? null
      actorEmail = input.actor.email ?? null
      actorRole = input.actor.role ?? null
    } else {
      const session = await auth()
      if (session?.user) {
        actorId = (session.user.id as string) ?? null
        actorEmail = session.user.email ?? null
        actorRole = (session.user.role as string) ?? null
      } else {
        actorRole = "anonymous"
      }
    }

    let ip: string | null = null
    let ua: string | null = null
    let method: string | null = null
    let path: string | null = null

    if (input.request) {
      ip = firstIp(input.request.headers.get("x-forwarded-for"))
        ?? input.request.headers.get("x-real-ip")
      ua = input.request.headers.get("user-agent")
      method = input.request.method
      path = pathFromRequest(input.request)
    }

    await insertAuditLog({
      action: input.action,
      category: input.category,
      outcome: input.outcome ?? "success",
      actor_id: actorId,
      actor_email: actorEmail,
      actor_role: actorRole as AuditActorRole | null,
      target_type: input.target?.type ?? null,
      target_id: input.target?.id ?? null,
      target_label: input.target?.label ?? null,
      ip_address: ip,
      user_agent: ua,
      request_id: input.requestId ?? null,
      request_method: method,
      request_path: path,
      error_code: input.error?.code ?? null,
      error_message: input.error?.message ?? null,
      metadata: scrubMetadata(input.metadata ?? {}),
    })
  } catch (err) {
    console.warn(`[audit] recordAudit(${input.action}) failed:`, (err as Error).message)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/audit-record.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/audit/record.ts __tests__/lib/audit-record.test.ts
git commit -m "feat(audit): recordAudit() with actor + request context"
```

---

### Task 1.6: `withAudit()` route wrapper

**Files:**
- Create: `lib/audit/with-audit.ts`

- [ ] **Step 1: Write `lib/audit/with-audit.ts`**

```ts
import { recordAudit } from "@/lib/audit/record"
import type {
  AuditCategory,
  AuditOutcome,
  AuditTarget,
} from "@/lib/audit/types"

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>

type TargetResolver =
  | AuditTarget
  | ((request: Request, context: { params: Promise<Record<string, string>> }) => Promise<AuditTarget | undefined> | AuditTarget | undefined)

export interface WithAuditOptions {
  action: string
  category: AuditCategory
  /** Static target, or a function that resolves it after the request runs. */
  target?: TargetResolver
  /** Pull extra metadata after the handler finishes — receives request + response clone. */
  metadata?: (request: Request, response: Response) => Promise<Record<string, unknown>> | Record<string, unknown>
}

function classifyOutcome(status: number): AuditOutcome {
  if (status >= 200 && status < 300) return "success"
  if (status === 401 || status === 403) return "denied"
  return "failure"
}

async function maybeReadError(response: Response): Promise<{ code?: string; message?: string } | undefined> {
  if (response.ok) return undefined
  try {
    const clone = response.clone()
    const body = await clone.json() as { error?: string; code?: string }
    return { code: body.code ?? String(response.status), message: body.error }
  } catch {
    return { code: String(response.status) }
  }
}

export function withAudit(options: WithAuditOptions, handler: Handler): Handler {
  return async (request, context) => {
    let response: Response | null = null
    let thrown: unknown = null
    try {
      response = await handler(request, context)
    } catch (err) {
      thrown = err
    }

    let target: AuditTarget | undefined
    if (typeof options.target === "function") {
      try {
        target = (await options.target(request, context)) ?? undefined
      } catch {
        target = undefined
      }
    } else {
      target = options.target
    }

    if (thrown) {
      void recordAudit({
        action: options.action,
        category: options.category,
        outcome: "failure",
        target,
        request,
        error: { message: (thrown as Error)?.message },
      })
      throw thrown
    }

    const resp = response as Response
    const outcome = classifyOutcome(resp.status)
    const error = await maybeReadError(resp)

    let extra: Record<string, unknown> = {}
    if (options.metadata) {
      try {
        extra = (await options.metadata(request, resp.clone())) ?? {}
      } catch { /* swallow */ }
    }

    void recordAudit({
      action: options.action,
      category: options.category,
      outcome,
      target,
      request,
      error: outcome === "success" ? undefined : error,
      metadata: extra,
    })
    return resp
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/audit/with-audit.ts
git commit -m "feat(audit): withAudit() HOF for route handlers"
```

---

### Phase 2 — Auth instrumentation

Wire `recordAudit()` into auth flows. These are inline (not wrapped) because `lib/auth.ts` is a NextAuth config, not an App Router handler.

---

### Task 2.1: Log login success + failure from `lib/auth.ts`

**Files:**
- Modify: `lib/auth.ts:11-42`

- [ ] **Step 1: Edit the `authorize()` callback to record both outcomes**

Replace the body of `authorize()` so each return path records an audit event before returning. Pull `recordAudit` at the top of the file:

```ts
import { recordAudit } from "@/lib/audit/record"
```

Then inside `authorize(credentials)`:

```ts
if (!credentials?.email || !credentials?.password) return null

const email = credentials.email as string
const password = credentials.password as string

const supabase = createServiceRoleClient()
const { data: user, error } = await supabase.from("users").select("*").eq("email", email).single()

if (error || !user) {
  await recordAudit({
    action: "auth.login_failed",
    category: "auth",
    outcome: "failure",
    actor: { id: null, email, role: "anonymous" },
    metadata: { reason: "user_not_found" },
  })
  return null
}
if (!user.password_hash) {
  await recordAudit({
    action: "auth.login_failed",
    category: "auth",
    outcome: "failure",
    actor: { id: user.id, email, role: "anonymous" },
    metadata: { reason: "lead_no_password" },
  })
  return null
}

const isValid = await compare(password, user.password_hash)
if (!isValid) {
  await recordAudit({
    action: "auth.login_failed",
    category: "auth",
    outcome: "failure",
    actor: { id: user.id, email, role: "anonymous" },
    metadata: { reason: "bad_password" },
  })
  return null
}

await recordAudit({
  action: "auth.login_succeeded",
  category: "auth",
  outcome: "success",
  actor: { id: user.id, email: user.email, role: user.role },
})

console.log(`[Auth] Login: ${user.email}, role: ${user.role}`)
return {
  id: user.id,
  email: user.email,
  name: `${user.first_name} ${user.last_name}`,
  role: user.role,
}
```

- [ ] **Step 2: Manual smoke**

```bash
npm run dev
```
Open `/login`, attempt one bad password, then one good login. Stop the server.

Run:
```bash
node -e "fetch('http://localhost:3050').catch(()=>{})"
```
(no-op; just a placeholder if needed)

Verify with MCP:
```sql
SELECT action, outcome, actor_email, metadata
FROM audit_logs
WHERE category='auth'
ORDER BY created_at DESC
LIMIT 5;
```
Expected: one `auth.login_failed` row with `reason='bad_password'`, one `auth.login_succeeded` row.

- [ ] **Step 3: Commit**

```bash
git add lib/auth.ts
git commit -m "feat(audit): log login success/failure"
```

---

### Task 2.2: Register, password reset, email verification

**Files:**
- Modify: `app/api/auth/register/route.ts`
- Modify: `app/api/auth/forgot-password/route.ts`
- Modify: `app/api/auth/reset-password/route.ts`
- Modify: `app/api/auth/verify-email/route.ts`

If any of those routes don't exist exactly at that path, locate the closest equivalent (`grep -l "password_hash" app/api/auth/`) and instrument it instead.

- [ ] **Step 1: Register — add `recordAudit` on success and on duplicate-email failure**

Find the existing `POST` handler. At the top of the file:

```ts
import { recordAudit } from "@/lib/audit/record"
```

After a user is successfully inserted, before `return NextResponse.json(...)`:

```ts
await recordAudit({
  action: "auth.register",
  category: "auth",
  outcome: "success",
  actor: { id: newUser.id, email: newUser.email, role: newUser.role },
  target: { type: "user", id: newUser.id, label: `${newUser.first_name} ${newUser.last_name}` },
  request,
})
```

On the 409 duplicate-email return path:

```ts
await recordAudit({
  action: "auth.register",
  category: "auth",
  outcome: "failure",
  actor: { id: null, email: parsed.email, role: "anonymous" },
  error: { code: "duplicate_email", message: "Email already registered" },
  request,
})
```

- [ ] **Step 2: Forgot password — record request attempt**

In `forgot-password/route.ts`, after looking up the user (whether found or not), before returning the response:

```ts
await recordAudit({
  action: "auth.password_reset_request",
  category: "auth",
  outcome: user ? "success" : "failure",
  actor: { id: user?.id ?? null, email: parsed.email, role: "anonymous" },
  request,
  error: user ? undefined : { code: "user_not_found" },
})
```

Note: we **always** return the same generic message to the client to prevent enumeration; this audit row is server-only and that's fine.

- [ ] **Step 3: Reset password — record completion**

In `reset-password/route.ts`, after the password hash is updated and the token cleared:

```ts
await recordAudit({
  action: "auth.password_reset_complete",
  category: "auth",
  outcome: "success",
  actor: { id: user.id, email: user.email, role: user.role },
  target: { type: "user", id: user.id, label: user.email },
  request,
})
```

On any explicit failure (bad token, expired token):

```ts
await recordAudit({
  action: "auth.password_reset_complete",
  category: "auth",
  outcome: "failure",
  actor: { id: null, email: null, role: "anonymous" },
  request,
  error: { code: "invalid_token" },
})
```

- [ ] **Step 4: Email verification — record success**

In `verify-email/route.ts`, after `email_verified_at` is set:

```ts
await recordAudit({
  action: "auth.email_verified",
  category: "auth",
  outcome: "success",
  actor: { id: user.id, email: user.email, role: user.role },
  target: { type: "user", id: user.id, label: user.email },
  request,
})
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/auth/
git commit -m "feat(audit): log register, password reset, email verification"
```

---

### Phase 3 — Admin-write instrumentation

Wrap the highest-value admin mutation routes. We don't blanket-instrument every endpoint; we cover the surfaces the user already cares about (users/clients, programs, exercises, content, integrations, system settings, billing webhooks).

---

### Task 3.1: Wrap `clients/[id]` PATCH/DELETE + `users` POST

**Files:**
- Modify: `app/api/admin/clients/[id]/route.ts`
- Modify: `app/api/admin/users/route.ts`

- [ ] **Step 1: Refactor `clients/[id]/route.ts` to use `withAudit`**

Convert the existing `PATCH` and `DELETE` exports. PATCH:

```ts
import { withAudit } from "@/lib/audit/with-audit"

export const PATCH = withAudit(
  {
    action: "user.updated",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = await ctx.params
      return { type: "user", id }
    },
    metadata: async (req) => {
      // body may already be consumed by the handler; we passed the original
      // Request here. Re-reading is not safe — return only what we can derive
      // from the URL.
      return { request_path: new URL(req.url).pathname }
    },
  },
  async (request, context) => {
    // existing PATCH body verbatim
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }
    // ...rest unchanged
  },
)
```

DELETE:

```ts
export const DELETE = withAudit(
  {
    action: "user.deleted",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = await ctx.params
      return { type: "user", id }
    },
  },
  async (_request, context) => {
    // existing DELETE body verbatim
  },
)
```

- [ ] **Step 2: Refactor `users/route.ts` POST**

```ts
import { withAudit } from "@/lib/audit/with-audit"

export const POST = withAudit(
  { action: "user.created", category: "admin_write" },
  async (request) => {
    // existing POST body verbatim
  },
)
```

For the create case, the new user id isn't known until after the insert. Inside the handler, before responding, capture it on a header so we can pull it in `metadata`:

```ts
const response = NextResponse.json(safeUser, { status: 201 })
response.headers.set("x-audit-target-id", newUser.id)
return response
```

Then expand the wrapper config:

```ts
export const POST = withAudit(
  {
    action: "user.created",
    category: "admin_write",
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { target_id: id } : {}
    },
  },
  async (request) => { /* ... */ },
)
```

(We accept that the `target` proper is empty here and the id lives in metadata — keeps `withAudit` simple and works for create flows.)

- [ ] **Step 3: Smoke + verify**

```bash
npm run dev
```

In another shell, log in as admin, create a test client via the UI, edit them, delete them. Then:

```sql
SELECT action, outcome, actor_email, target_id, metadata
FROM audit_logs
WHERE category='admin_write' AND target_type='user'
ORDER BY created_at DESC LIMIT 10;
```

Expected: `user.created`, `user.updated`, `user.deleted` rows attributed to the admin.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/clients/[id]/route.ts app/api/admin/users/route.ts
git commit -m "feat(audit): wrap users + clients admin routes"
```

---

### Task 3.2: Wrap programs + exercises + blog posts + assignments

**Files:**
- Modify: `app/api/admin/programs/route.ts` — `program.created`
- Modify: `app/api/admin/programs/[id]/route.ts` — `program.updated`, `program.deleted`
- Modify: `app/api/admin/exercises/route.ts` — `exercise.created`
- Modify: `app/api/admin/exercises/[id]/route.ts` — `exercise.updated`, `exercise.deleted`
- Modify: `app/api/admin/blog-posts/route.ts` — `blog_post.created`
- Modify: `app/api/admin/blog-posts/[id]/route.ts` — `blog_post.updated`, `blog_post.deleted`
- Modify: `app/api/admin/assignments/route.ts` — `assignment.created`
- Modify: `app/api/admin/assignments/[id]/route.ts` — `assignment.status_changed`, `assignment.deleted`

- [ ] **Step 1: For each `[id]` route, wrap PATCH/DELETE with the appropriate action slug**

Pattern (identical for all eight files, just swap the slug + target type):

```ts
export const PATCH = withAudit(
  {
    action: "program.updated",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = await ctx.params
      return { type: "program", id }
    },
  },
  async (request, context) => { /* existing body */ },
)

export const DELETE = withAudit(
  {
    action: "program.deleted",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = await ctx.params
      return { type: "program", id }
    },
  },
  async (request, context) => { /* existing body */ },
)
```

For assignment `PATCH`, use `assignment.status_changed` only when the patch payload includes `status`; otherwise use `assignment.updated`. To keep `withAudit` simple, instead emit the audit inline at the end of the handler:

```ts
// inside the existing PATCH handler, AFTER the update succeeds and BEFORE return:
import { recordAudit } from "@/lib/audit/record"

await recordAudit({
  action: body.status ? "assignment.status_changed" : "assignment.updated",
  category: "admin_write",
  target: { type: "assignment", id, label: result.client_email ?? null },
  metadata: body.status ? { new_status: body.status } : { changed: Object.keys(body) },
  request,
})
```

If the codebase doesn't have a generic `assignment.updated` slug yet, add it to `lib/audit/actions.ts`.

- [ ] **Step 2: For the collection `route.ts` files, wrap POST**

```ts
export const POST = withAudit(
  { action: "program.created", category: "admin_write" },
  async (request) => { /* existing body */ },
)
```

- [ ] **Step 3: Run lint + type-check**

Run: `npm run lint && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 4: Smoke any one path (e.g. edit a program) and inspect `audit_logs`**

```sql
SELECT action, target_type, target_id, outcome, created_at
FROM audit_logs
ORDER BY created_at DESC LIMIT 20;
```

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/programs app/api/admin/exercises app/api/admin/blog-posts app/api/admin/assignments lib/audit/actions.ts
git commit -m "feat(audit): wrap programs, exercises, blog posts, assignments"
```

---

### Task 3.3: Integrations, platform connections, system settings

**Files:**
- Modify: `app/api/admin/integrations/[provider]/route.ts` (or equivalent connect/disconnect endpoint)
- Modify: `app/api/admin/platform-connections/[id]/route.ts`
- Modify: any system_settings update endpoint under `app/api/admin/` (likely `system-settings` or inside feature-flag routes)

- [ ] **Step 1: Wrap connect / disconnect with the right slug**

```ts
export const POST = withAudit(
  {
    action: "integration.connected",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { provider } = await ctx.params
      return { type: "integration", id: provider, label: provider }
    },
  },
  async (request, context) => { /* existing body */ },
)

export const DELETE = withAudit(
  {
    action: "integration.disconnected",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { provider } = await ctx.params
      return { type: "integration", id: provider, label: provider }
    },
  },
  async (request, context) => { /* existing body */ },
)
```

- [ ] **Step 2: Wrap system_settings change**

For the endpoint that PATCHes `system_settings`:

```ts
export const PATCH = withAudit(
  {
    action: "system_setting.changed",
    category: "system",
    target: async (req) => {
      // assumes key is in the body — but body is already consumed by the handler.
      // Resolve from the URL or accept that target stays empty and store key in metadata via inline recordAudit instead.
      return undefined
    },
  },
  async (request) => { /* existing body */ },
)
```

Because the value of a feature-flag toggle is semantically important and we want it captured, prefer an **inline** `recordAudit` here rather than the wrapper:

```ts
// inside the PATCH handler, after the upsert succeeds:
await recordAudit({
  action: parsed.key.startsWith("cron_") || parsed.key.startsWith("feature_")
    ? "feature_flag.toggled"
    : "system_setting.changed",
  category: "system",
  target: { type: "system_setting", id: parsed.key, label: parsed.key },
  metadata: { key: parsed.key, new_value: parsed.value },
  request,
})
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add app/api/admin/integrations app/api/admin/platform-connections app/api/admin/system-settings
git commit -m "feat(audit): integrations + system settings"
```

---

### Task 3.4: Stripe webhook

**Files:**
- Modify: `app/api/webhooks/stripe/route.ts`

This is a webhook with no human actor — use `actor: { id: null, email: 'stripe', role: 'system' }`.

- [ ] **Step 1: Add per-event `recordAudit` calls**

After Stripe signature verification and the event-type switch, at the bottom of each case (or in a tail block):

```ts
import { recordAudit } from "@/lib/audit/record"

const slugByType: Record<string, string> = {
  "checkout.session.completed":         "stripe.checkout_completed",
  "customer.subscription.created":      "stripe.subscription_created",
  "customer.subscription.updated":      "stripe.subscription_updated",
  "customer.subscription.deleted":      "stripe.subscription_canceled",
  "invoice.payment_succeeded":          "stripe.payment_succeeded",
  "invoice.payment_failed":             "stripe.payment_failed",
  "charge.refunded":                    "stripe.refund",
}

const slug = slugByType[event.type]
if (slug) {
  const object = event.data.object as { id?: string; customer_email?: string; customer?: string }
  await recordAudit({
    action: slug,
    category: "billing",
    outcome: event.type.endsWith("payment_failed") ? "failure" : "success",
    actor: { id: null, email: "stripe", role: "system" },
    target: {
      type: event.type.startsWith("invoice") ? "invoice"
        : event.type.startsWith("customer.subscription") ? "subscription"
        : event.type.startsWith("charge") ? "charge"
        : "stripe_event",
      id: object.id ?? event.id,
      label: object.customer_email ?? object.customer ?? null,
    },
    metadata: {
      stripe_event_id: event.id,
      stripe_event_type: event.type,
    },
    request,
  })
}
```

- [ ] **Step 2: Smoke with a Stripe test event (skip if not feasible locally) and confirm row appears**

```sql
SELECT action, target_id, metadata
FROM audit_logs
WHERE category='billing'
ORDER BY created_at DESC LIMIT 5;
```

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/stripe/route.ts
git commit -m "feat(audit): log stripe webhook events"
```

---

### Phase 3.5 — Client-side actions (workouts, assessments, readiness, goals, injuries, profile)

The client surface is the bulk of the app. Strategy: **audit at the boundary**, not at every set. A workout that touches 30 `tracked_exercises` rows produces ONE `workout.completed` audit row with a count summary in metadata. Goals/injuries/performance-tests are individual entities, so each mutation = one audit row.

Pattern for every client mutation route: inline `recordAudit()` at the end of the handler, after the DB write succeeds, with `actor` resolved from the session (default behavior — no override needed).

---

#### Task 3.5.1: Training sessions — boundary events

**Files:**
- Modify: `app/api/training-sessions/route.ts` — `workout.session_started` on POST
- Modify: `app/api/training-sessions/[id]/route.ts` — `workout.completed` when PATCH sets status to completed; `workout.skipped` when skipped

- [ ] **Step 1: Add `recordAudit` to `training-sessions/route.ts` POST**

At the top:
```ts
import { recordAudit } from "@/lib/audit/record"
```

After a session row is inserted successfully, before `return NextResponse.json(...)`:
```ts
await recordAudit({
  action: "workout.session_started",
  category: "client_action",
  target: { type: "training_session", id: session.id, label: session.program_name ?? null },
  metadata: {
    program_id: session.program_id ?? null,
    week_number: session.week_number ?? null,
    day_number: session.day_number ?? null,
  },
  request,
})
```

- [ ] **Step 2: Add `recordAudit` to `training-sessions/[id]/route.ts` PATCH**

Where the PATCH applies an update, after success:
```ts
const action =
  updates.status === "completed" ? "workout.completed"
  : updates.status === "skipped"   ? "workout.skipped"
  : null

if (action) {
  // count tracked_exercises for this session to give the audit row signal
  const { count: setCount } = await supabase
    .from("tracked_exercises")
    .select("*", { count: "exact", head: true })
    .eq("training_session_id", id)

  await recordAudit({
    action,
    category: "client_action",
    target: { type: "training_session", id, label: existing.program_name ?? null },
    metadata: {
      program_id: existing.program_id ?? null,
      duration_seconds: updates.duration_seconds ?? null,
      set_count: setCount ?? null,
      rpe_avg: updates.rpe_avg ?? null,
    },
    request,
  })
}
```

- [ ] **Step 3: Smoke**

```bash
npm run dev
```
Log in as a client, start and complete a workout. Then:
```sql
SELECT action, target_id, metadata, created_at
FROM audit_logs
WHERE category='client_action' AND target_type='training_session'
ORDER BY created_at DESC LIMIT 5;
```
Expected: one `workout.session_started` and one `workout.completed` row with `set_count`.

- [ ] **Step 4: Commit**

```bash
git add app/api/training-sessions/
git commit -m "feat(audit): training session boundary events"
```

---

#### Task 3.5.2: Assessment, reassessment, questionnaire, readiness

**Files:**
- Modify: `app/api/assessment/submit/route.ts`
- Modify: `app/api/assessment/reassess/route.ts`
- Modify: `app/api/questionnaire/route.ts`
- Modify: `app/api/readiness/route.ts`

- [ ] **Step 1: Each handler — inline `recordAudit` after DB success**

Template (swap the action slug per file):
```ts
import { recordAudit } from "@/lib/audit/record"

// ...after the insert/upsert succeeds:
await recordAudit({
  action: "assessment.submitted", // or "assessment.reassessment_submitted" / "questionnaire.submitted" / "readiness.submitted"
  category: "client_action",
  target: { type: "assessment", id: result.id, label: null },
  metadata: {
    // a small derived summary, NOT the full payload
    answers_count: Object.keys(parsed.answers ?? {}).length,
    type: parsed.type ?? null,
  },
  request,
})
```

For `readiness/route.ts`, use `target.type = "daily_readiness"` and include `score`, `sleep_hours`, `stress_level` in metadata.

- [ ] **Step 2: Type-check + smoke (submit one of each, verify rows)**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add app/api/assessment app/api/questionnaire app/api/readiness
git commit -m "feat(audit): assessment, questionnaire, readiness submissions"
```

---

#### Task 3.5.3: Goals, injuries, performance tests, achievements

**Files:**
- Modify: `app/api/athlete-goals/route.ts` (POST) + `[id]/route.ts` (PATCH/DELETE)
- Modify: `app/api/injuries/route.ts` (POST) + `[id]/route.ts` (PATCH/DELETE)
- Modify: `app/api/performance-tests/route.ts` (POST) + `[id]/route.ts` (DELETE)
- Modify: `app/api/client/achievements/route.ts` — `pr.claimed` when a new PR is recorded

- [ ] **Step 1: Wrap with `withAudit` where the slug is fixed**

Goals POST:
```ts
import { withAudit } from "@/lib/audit/with-audit"
export const POST = withAudit(
  { action: "goal.created", category: "client_action" },
  async (request) => { /* existing body */ },
)
```

Goals PATCH:
```ts
export const PATCH = withAudit(
  {
    action: "goal.updated",
    category: "client_action",
    target: async (_req, ctx) => {
      const { id } = await ctx.params
      return { type: "athlete_goal", id }
    },
  },
  async (request, context) => { /* existing body */ },
)
```

Goals DELETE: `action: "goal.deleted"`, same shape.

Injuries: same pattern with `injury.reported / updated / resolved`. The "resolved" case happens via PATCH when `status` flips to resolved — use inline `recordAudit` inside the PATCH handler to pick the right slug:
```ts
const slug =
  updates.status === "resolved" && existing.status !== "resolved"
    ? "injury.resolved"
    : "injury.updated"

await recordAudit({
  action: slug,
  category: "client_action",
  target: { type: "injury", id, label: existing.area },
  metadata: { changed: Object.keys(updates) },
  request,
})
```

Performance tests: POST → `performance_test.submitted`, DELETE → `performance_test.deleted`. Use `withAudit`.

Achievements POST: `pr.claimed`. Include `pr_type` (`weight | reps | volume | estimated_1rm`) and `exercise_id` in metadata.

- [ ] **Step 2: Smoke 2-3 of these, verify rows**

- [ ] **Step 3: Commit**

```bash
git add app/api/athlete-goals app/api/injuries app/api/performance-tests app/api/client/achievements
git commit -m "feat(audit): goals, injuries, performance tests, PRs"
```

---

#### Task 3.5.4: Profile, notification prefs, self-service subscription cancel

**Files:**
- Modify: `app/api/client/profile/route.ts` — `profile.updated`
- Modify: `app/api/notification-preferences/route.ts` — `notification_preferences.changed`
- Modify: `app/api/client/payments/.../cancel/route.ts` (locate the self-service cancel endpoint via `grep -l "subscription" app/api/client/payments`)

- [ ] **Step 1: Wrap profile + prefs with `withAudit`**

Profile PATCH:
```ts
export const PATCH = withAudit(
  {
    action: "profile.updated",
    category: "client_action",
    target: async () => ({ type: "user", id: "self" }), // resolved from actor in metadata
  },
  async (request) => { /* existing body */ },
)
```

Notification prefs PATCH:
```ts
export const PATCH = withAudit(
  { action: "notification_preferences.changed", category: "client_action" },
  async (request) => { /* existing body */ },
)
```

- [ ] **Step 2: Self-service subscription cancel — inline (so we can capture the stripe id)**

In the cancel handler, after Stripe cancel succeeds and the local subscription row is updated:
```ts
await recordAudit({
  action: "subscription.cancel_requested",
  category: "client_action",
  target: { type: "subscription", id: subscription.stripe_subscription_id, label: subscription.plan_name ?? null },
  metadata: { at_period_end: true, refund_requested: false },
  request,
})
```

- [ ] **Step 3: Smoke + commit**

```bash
git add app/api/client app/api/notification-preferences
git commit -m "feat(audit): profile, prefs, self-service cancel"
```

---

### Phase 3.6 — Coach <> client support flows

#### Task 3.6.1: Form reviews

**Files:**
- Modify: `app/api/client/form-reviews/route.ts` (POST → `form_review.submitted`) + `[id]/route.ts` (DELETE → `form_review.deleted`)
- Modify: `app/api/admin/form-reviews/[id]/route.ts` (PATCH where coach feedback added → `form_review.reviewed`)

- [ ] **Step 1: Wrap client POST/DELETE**

```ts
export const POST = withAudit(
  { action: "form_review.submitted", category: "support" },
  async (request) => { /* existing */ },
)
export const DELETE = withAudit(
  {
    action: "form_review.deleted",
    category: "support",
    target: async (_req, ctx) => {
      const { id } = await ctx.params
      return { type: "form_review", id }
    },
  },
  async (request, context) => { /* existing */ },
)
```

- [ ] **Step 2: Admin PATCH — inline so we only log when feedback is actually written**

```ts
if (updates.coach_feedback || updates.status === "reviewed") {
  await recordAudit({
    action: "form_review.reviewed",
    category: "support",
    target: { type: "form_review", id, label: existing.client_email ?? null },
    metadata: {
      has_feedback: !!updates.coach_feedback,
      status: updates.status ?? existing.status,
    },
    request,
  })
}
```

- [ ] **Step 3: Smoke + commit**

```bash
git add app/api/client/form-reviews app/api/admin/form-reviews
git commit -m "feat(audit): form review submit + review flow"
```

---

#### Task 3.6.2: Team videos (submissions, versions, annotations, comments)

**Files:**
- Modify: `app/api/admin/team-videos/...` (or whichever route handles each operation)

- [ ] **Step 1: Identify the four operations**

Run:
```bash
grep -lr "team_video_submission\|team_video_version\|team_video_annotation\|team_video_comment" app/api
```

For each route, decide between `withAudit` (slug fixed by route) or inline `recordAudit` (slug depends on payload).

- [ ] **Step 2: Wrap each**

Submission POST: `team_video.submitted`, target = `{ type: "team_video_submission", id, label }`.
Version POST: `team_video.version_added`, target = the submission id, metadata = `{ version_id, version_number }`.
Annotation POST: `team_video.annotated`, metadata = `{ timestamp_ms, annotation_id }`.
Comment POST: `team_video.commented`, metadata = `{ comment_id }`.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/team-videos
git commit -m "feat(audit): team video submission/annotation flow"
```

---

#### Task 3.6.3: Inbox sends

**Files:**
- Modify: the route that sends a coach reply via GHL bridge (likely `app/api/admin/inbox/.../send/route.ts`)

- [ ] **Step 1: Inline `recordAudit` after the GHL API call returns 2xx**

```ts
await recordAudit({
  action: "inbox.message_sent",
  category: "support",
  target: { type: "conversation", id: conversationId, label: contact?.email ?? contact?.phone ?? null },
  metadata: {
    channel: payload.channel ?? "unknown",
    has_attachments: (payload.attachments?.length ?? 0) > 0,
    body_length: payload.body?.length ?? 0,
  },
  request,
})
```

**Note:** never put `payload.body` itself in metadata — message contents stay in GHL, not our audit log.

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/inbox
git commit -m "feat(audit): inbox message sent"
```

---

### Phase 3.7 — Commerce (bookings + shop)

#### Task 3.7.1: Bookings

**Files:**
- Modify: every booking mutation route under `app/api/` (grep for `bookings` to enumerate)

- [ ] **Step 1: Wrap each endpoint**

POST (create) → `booking.created`, target = `{ type: "booking", id, label: <date> }`, metadata `{ session_type, scheduled_at }`.
PATCH (reschedule or status change) → inline; choose slug based on what changed:
```ts
let slug: string | null = null
if (updates.scheduled_at && updates.scheduled_at !== existing.scheduled_at) slug = "booking.rescheduled"
if (updates.status === "completed") slug = "booking.completed"
if (updates.status === "cancelled") slug = "booking.cancelled"
if (updates.status === "no_show")   slug = "booking.no_show"

if (slug) {
  await recordAudit({
    action: slug,
    category: "commerce",
    target: { type: "booking", id, label: existing.scheduled_at },
    metadata: { from_status: existing.status, to_status: updates.status ?? existing.status },
    request,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/**/bookings*
git commit -m "feat(audit): booking lifecycle"
```

---

#### Task 3.7.2: Shop — orders, downloads, leads

**Files:**
- Modify: `app/api/shop/checkout/route.ts` — `shop.order_created`
- Modify: `app/api/shop/webhooks/...` (or wherever paid/refunded is processed) — `shop.order_paid`, `shop.order_refunded`
- Modify: admin fulfillment endpoint — `shop.order_fulfilled`
- Modify: `app/api/shop/downloads/...` — `shop.download_issued`
- Modify: `app/api/shop/leads/route.ts` — `shop.lead_captured`

- [ ] **Step 1: Checkout (order created) — inline after successful order row insert**

```ts
await recordAudit({
  action: "shop.order_created",
  category: "commerce",
  target: { type: "shop_order", id: order.id, label: order.product_name ?? null },
  metadata: {
    amount_cents: order.amount_cents,
    currency: order.currency,
    variant_id: order.variant_id ?? null,
    stripe_session_id: stripeSession.id,
  },
  request,
})
```

- [ ] **Step 2: Webhook handlers — system actor (`actor: { id: null, email: 'stripe', role: 'system' }`)**

For paid:
```ts
await recordAudit({
  action: "shop.order_paid",
  category: "commerce",
  actor: { id: null, email: "stripe", role: "system" },
  target: { type: "shop_order", id: order.id, label: order.product_name ?? null },
  metadata: { stripe_event_id: event.id, amount_cents: order.amount_cents },
  request,
})
```

For refunded: same shape with `shop.order_refunded` and `metadata.refund_amount_cents`.

- [ ] **Step 3: Fulfillment + downloads + leads**

Use `withAudit` for the fixed-slug routes. Downloads record on successful link generation (not on every replay of an existing link — check by inserting on first generation only, then the route returns the existing link without re-logging).

- [ ] **Step 4: Commit**

```bash
git add app/api/shop
git commit -m "feat(audit): shop orders, downloads, leads"
```

---

### Phase 3.8 — Marketing + Compliance

#### Task 3.8.1: Newsletter, lead magnets, event signups, contact, reviews/testimonials

**Files:**
- Modify: `app/api/newsletter/route.ts` — `newsletter.subscribed`
- Modify: `app/api/newsletter/unsubscribe/route.ts` — `newsletter.unsubscribed`
- Modify: admin newsletter send route — `newsletter.sent`
- Modify: lead-magnet download route — `lead_magnet.downloaded`
- Modify: `app/api/events/[id]/signup/route.ts` (or equivalent) — `event_signup.created` + `event_signup.cancelled`
- Modify: contact / inquiry route — `contact.submitted`
- Modify: public review submit + admin review moderation — `review.submitted` / `review.moderated`
- Modify: public testimonial submit + admin moderation — `testimonial.submitted` / `testimonial.moderated`

- [ ] **Step 1: Wrap each with `withAudit` (slugs are fixed per route)**

```ts
export const POST = withAudit(
  { action: "newsletter.subscribed", category: "marketing" },
  async (request) => { /* existing body */ },
)
```

For moderation routes (admin approves/rejects), inline so we can capture the decision:
```ts
await recordAudit({
  action: "review.moderated",
  category: "marketing",
  target: { type: "review", id, label: existing.author_name ?? null },
  metadata: { decision: updates.status, reason: updates.moderation_reason ?? null },
  request,
})
```

- [ ] **Step 2: Smoke any one + commit**

```bash
git add app/api/newsletter app/api/events app/api/contact app/api/admin/reviews app/api/admin/testimonials app/api/admin/lead-magnets app/api/admin/newsletter
git commit -m "feat(audit): marketing + moderation events"
```

---

#### Task 3.8.2: Consents, marketing consent, legal docs, bulk delete

**Files:**
- Modify: `app/api/consents/waiver/route.ts` — `consent.granted`
- Modify: any other consent endpoints (terms, privacy, parental) — `consent.granted` / `consent.withdrawn`
- Modify: `app/api/account/marketing-consent/route.ts` (or wherever marketing consent is changed) — `marketing_consent.changed`
- Modify: `app/api/admin/legal/...` (publish new version) — `legal_document.published`
- Modify: `app/api/admin/reset-data/route.ts` — `data.deleted_bulk`

- [ ] **Step 1: Consents — always inline, include consent type + document version**

```ts
await recordAudit({
  action: "consent.granted",
  category: "compliance",
  target: { type: "consent", id: consent.id, label: consent.consent_type },
  metadata: {
    consent_type: consent.consent_type,
    legal_document_id: consent.legal_document_id,
    legal_document_version: consent.legal_document_version,
    ip_address_at_consent: consent.ip_address,
  },
  request,
})
```

For withdrawal:
```ts
await recordAudit({
  action: "consent.withdrawn",
  category: "compliance",
  target: { type: "consent", id, label: existing.consent_type },
  metadata: { consent_type: existing.consent_type },
  request,
})
```

- [ ] **Step 2: Legal doc publish — inline**

```ts
await recordAudit({
  action: "legal_document.published",
  category: "compliance",
  target: { type: "legal_document", id: doc.id, label: doc.document_type },
  metadata: { version: doc.version, effective_at: doc.effective_at },
  request,
})
```

- [ ] **Step 3: Bulk delete — inline with row count summary**

```ts
await recordAudit({
  action: "data.deleted_bulk",
  category: "compliance",
  target: { type: "reset_operation", id: operationId, label: scope },
  metadata: { scope, counts: deletedCounts }, // { users: 5, programs: 2, ... }
  request,
})
```

- [ ] **Step 4: Commit**

```bash
git add app/api/consents app/api/account app/api/admin/legal app/api/admin/reset-data
git commit -m "feat(audit): consents, legal docs, bulk delete"
```

---

### Phase 4 — Admin UI

A read-only viewer at `/admin/audit-logs` with filters + pagination. Server component, no hydration cost.

---

### Task 4.1: API endpoint for listing

**Files:**
- Create: `app/api/admin/audit-logs/route.ts`
- Test: `__tests__/api/admin/audit-logs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/admin/audit-logs/route"
import { insertAuditLog } from "@/lib/db/audit-logs"
import { createServiceRoleClient } from "@/lib/supabase"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "u-admin", email: "admin@test", role: "admin" },
  }),
}))

const TEST_TARGET = "00000000-0000-0000-0000-0000000ad777"

describe("GET /api/admin/audit-logs", () => {
  const supabase = createServiceRoleClient()
  beforeEach(async () => {
    await supabase.from("audit_logs").delete().eq("target_id", TEST_TARGET)
    await insertAuditLog({
      action: "user.updated",
      category: "admin_write",
      target_type: "user",
      target_id: TEST_TARGET,
    })
  })

  it("returns rows for an admin", async () => {
    const req = new Request(`https://x/api/admin/audit-logs?target_type=user&target_id=${TEST_TARGET}`)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { rows: unknown[]; total: number }
    expect(body.total).toBe(1)
  })

  it("rejects non-admin", async () => {
    const { auth } = await import("@/lib/auth")
    ;(auth as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      user: { id: "u-client", email: "c@test", role: "client" },
    })
    const req = new Request("https://x/api/admin/audit-logs")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run the test (FAIL — route doesn't exist)**

Run: `npm run test:run -- __tests__/api/admin/audit-logs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `app/api/admin/audit-logs/route.ts`**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listAuditLogs } from "@/lib/db/audit-logs"
import type { AuditCategory, AuditOutcome } from "@/lib/audit/types"

const CATEGORIES = new Set<AuditCategory>([
  "auth","admin_write","admin_read_sensitive","client_action","support",
  "commerce","billing","marketing","compliance","automation","system",
])
const OUTCOMES = new Set<AuditOutcome>(["success","failure","denied"])

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(request.url)
  const p = url.searchParams

  const category = p.get("category")
  const outcome = p.get("outcome")
  const page = Math.max(1, Number.parseInt(p.get("page") ?? "1", 10) || 1)
  const perPage = Math.min(200, Math.max(1, Number.parseInt(p.get("perPage") ?? "50", 10) || 50))

  const result = await listAuditLogs({
    category: category && CATEGORIES.has(category as AuditCategory) ? (category as AuditCategory) : undefined,
    action: p.get("action") || undefined,
    outcome: outcome && OUTCOMES.has(outcome as AuditOutcome) ? (outcome as AuditOutcome) : undefined,
    actor_id: p.get("actor_id") || undefined,
    target_type: p.get("target_type") || undefined,
    target_id: p.get("target_id") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    q: p.get("q") || undefined,
    page,
    perPage,
  })

  return NextResponse.json(result)
}
```

- [ ] **Step 4: Run the test — PASS**

Run: `npm run test:run -- __tests__/api/admin/audit-logs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/audit-logs __tests__/api/admin/audit-logs.test.ts
git commit -m "feat(audit): admin list endpoint with filters"
```

---

### Task 4.2: Admin viewer page

**Files:**
- Create: `app/(admin)/admin/audit-logs/page.tsx`
- Create: `components/admin/audit-log-table.tsx`
- Create: `components/admin/audit-log-filters.tsx`
- Create: `components/admin/audit-log-row.tsx`

- [ ] **Step 1: Write `page.tsx` (server component)**

```tsx
import { requireAdmin } from "@/lib/auth-helpers"
import { listAuditLogs } from "@/lib/db/audit-logs"
import { AuditLogFilters } from "@/components/admin/audit-log-filters"
import { AuditLogTable } from "@/components/admin/audit-log-table"
import type { AuditCategory, AuditOutcome } from "@/lib/audit/types"

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AuditLogsPage({ searchParams }: PageProps) {
  await requireAdmin()
  const sp = await searchParams
  const str = (v: string | string[] | undefined): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined
  const page = Number.parseInt(str(sp.page) ?? "1", 10) || 1
  const perPage = 50

  const { rows, total } = await listAuditLogs({
    category: str(sp.category) as AuditCategory | undefined,
    outcome: str(sp.outcome) as AuditOutcome | undefined,
    action: str(sp.action),
    actor_id: str(sp.actor_id),
    target_type: str(sp.target_type),
    target_id: str(sp.target_id),
    from: str(sp.from),
    to: str(sp.to),
    q: str(sp.q),
    page,
    perPage,
  })

  // 24h failure count for alert strip
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { total: failures24h } = await listAuditLogs({
    outcome: "failure",
    from: since24h,
    page: 1,
    perPage: 1,
  })

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-primary">Audit Logs</h1>
          <p className="text-muted-foreground text-sm">
            Append-only log of every mutation, auth event, and automation run.
          </p>
        </div>
        {failures24h > 0 && (
          <a
            href="/admin/audit-logs?outcome=failure"
            className="bg-error/10 text-error rounded-md px-3 py-1.5 text-sm font-medium"
          >
            {failures24h} failure(s) in last 24h
          </a>
        )}
      </header>

      <AuditLogFilters />
      <AuditLogTable rows={rows} total={total} page={page} perPage={perPage} />
    </div>
  )
}
```

- [ ] **Step 2: Write `audit-log-filters.tsx` (client component)**

```tsx
"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

const CATEGORIES = ["auth","admin_write","admin_read_sensitive","client_action","support","commerce","billing","marketing","compliance","automation","system"] as const
const OUTCOMES = ["success","failure","denied"] as const

export function AuditLogFilters() {
  const router = useRouter()
  const sp = useSearchParams()

  const setParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(sp.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete("page")
    router.push(`/admin/audit-logs?${params.toString()}`)
  }, [router, sp])

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
      <input
        defaultValue={sp.get("q") ?? ""}
        onBlur={(e) => setParam("q", e.currentTarget.value)}
        placeholder="Search email / target / error..."
        className="border-border rounded-md border px-3 py-2 text-sm"
      />
      <select
        defaultValue={sp.get("category") ?? ""}
        onChange={(e) => setParam("category", e.currentTarget.value)}
        className="border-border rounded-md border px-3 py-2 text-sm"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        defaultValue={sp.get("outcome") ?? ""}
        onChange={(e) => setParam("outcome", e.currentTarget.value)}
        className="border-border rounded-md border px-3 py-2 text-sm"
      >
        <option value="">All outcomes</option>
        {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <input
        type="date"
        defaultValue={sp.get("from") ?? ""}
        onChange={(e) => setParam("from", e.currentTarget.value)}
        className="border-border rounded-md border px-3 py-2 text-sm"
      />
      <input
        type="date"
        defaultValue={sp.get("to") ?? ""}
        onChange={(e) => setParam("to", e.currentTarget.value)}
        className="border-border rounded-md border px-3 py-2 text-sm"
      />
    </div>
  )
}
```

- [ ] **Step 3: Write `audit-log-row.tsx` (client component for expandable row)**

```tsx
"use client"
import { useState } from "react"
import type { AuditLogRow } from "@/lib/audit/types"

function outcomeBadgeClass(outcome: string): string {
  if (outcome === "success") return "bg-success/10 text-success"
  if (outcome === "denied")  return "bg-warning/10 text-warning"
  return "bg-error/10 text-error"
}

export function AuditLogRowView({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="hover:bg-muted/30 cursor-pointer border-b" onClick={() => setOpen((v) => !v)}>
        <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
        <td className="px-3 py-2 text-xs">
          <div className="font-medium">{row.actor_email ?? "—"}</div>
          <div className="text-muted-foreground">{row.actor_role ?? "—"}</div>
        </td>
        <td className="px-3 py-2 text-xs font-mono">{row.action}</td>
        <td className="px-3 py-2 text-xs">
          {row.target_type ? <div>{row.target_type}</div> : null}
          {row.target_label ? <div className="text-muted-foreground">{row.target_label}</div> : null}
        </td>
        <td className="px-3 py-2">
          <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${outcomeBadgeClass(row.outcome)}`}>
            {row.outcome}
          </span>
        </td>
        <td className="px-3 py-2 text-xs">{row.ip_address ?? "—"}</td>
      </tr>
      {open && (
        <tr className="bg-muted/10 border-b">
          <td colSpan={6} className="p-4">
            {row.error_message && (
              <div className="text-error mb-2 text-sm">
                <strong>{row.error_code ?? "error"}:</strong> {row.error_message}
              </div>
            )}
            <pre className="bg-surface overflow-x-auto rounded-md p-3 text-xs">
              {JSON.stringify(row.metadata, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}
```

- [ ] **Step 4: Write `audit-log-table.tsx`**

```tsx
import Link from "next/link"
import type { AuditLogRow } from "@/lib/audit/types"
import { AuditLogRowView } from "./audit-log-row"

interface Props {
  rows: AuditLogRow[]
  total: number
  page: number
  perPage: number
}

export function AuditLogTable({ rows, total, page, perPage }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  return (
    <div className="space-y-4">
      <div className="border-border overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Target</th>
              <th className="px-3 py-2 text-left">Outcome</th>
              <th className="px-3 py-2 text-left">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="text-muted-foreground px-3 py-6 text-center">No audit rows match these filters.</td></tr>
            )}
            {rows.map((r) => <AuditLogRowView key={r.id} row={r} />)}
          </tbody>
        </table>
      </div>
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{total.toLocaleString()} total</span>
        <div className="flex gap-2">
          {page > 1 && <Link href={`?page=${page - 1}`} className="hover:underline">← Prev</Link>}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages && <Link href={`?page=${page + 1}`} className="hover:underline">Next →</Link>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add sidebar link**

Find the admin sidebar component (likely `components/admin/admin-sidebar.tsx`). Add a link to `/admin/audit-logs` under the "Settings" or "System" section, near the existing `/admin/automation` link.

- [ ] **Step 6: Smoke**

```bash
npm run dev
```
Navigate to `/admin/audit-logs`. Confirm:
- Page renders without errors
- The 24h failure strip appears only when there are failures
- Filters update the URL and re-fetch
- Clicking a row expands metadata

- [ ] **Step 7: Commit**

```bash
git add app/(admin)/admin/audit-logs components/admin/audit-log-table.tsx components/admin/audit-log-filters.tsx components/admin/audit-log-row.tsx components/admin/admin-sidebar.tsx
git commit -m "feat(audit): admin audit log viewer"
```

---

### Phase 5 — Retention

Daily Firebase cron + admin toggle.

---

### Task 5.1: Retention cron (Firebase) + Next.js twin

**Files:**
- Create: `functions/src/lib/audit-logs.ts` (twin of `lib/db/audit-logs.ts` — only `pruneAuditLogs`)
- Modify: `functions/src/index.ts` — add `auditLogRetentionCron`
- Create: `app/api/admin/internal/audit-log-retention/route.ts` (POST handler the cron hits, OR run pure handler from the function — match existing pattern)

The CLAUDE.md says recurring jobs use `onSchedule` either calling `/api/admin/internal/*` or running pure handlers directly. Use the **pure handler** approach for retention since it has no external deps beyond Supabase.

- [ ] **Step 1: Write `functions/src/lib/audit-logs.ts`**

```ts
// Twin of lib/db/audit-logs.ts:pruneAuditLogs — kept in sync deliberately
// because functions/ has rootDir: "src" and can't import from lib/.
import type { SupabaseClient } from "@supabase/supabase-js"

export async function pruneAuditLogs(
  supabase: SupabaseClient,
  days: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("audit_logs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff)
  if (error) throw error
  return count ?? 0
}
```

- [ ] **Step 2: Add the cron to `functions/src/index.ts`**

Insert (alongside the other `onSchedule` exports):

```ts
import { pruneAuditLogs } from "./lib/audit-logs"
import { logCronStart, logCronEnd } from "./lib/cron-runs"

export const auditLogRetentionCron = onSchedule(
  {
    schedule: "0 3 * * *",     // 03:00 UTC daily
    timeZone: "UTC",
    region: "us-central1",
    memory: "256MiB",
  },
  async () => {
    const supabase = makeServiceClient()  // existing helper in functions/src
    // feature flag
    const { data: enabled } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "cron_audit_log_retention_enabled")
      .single()
    if (enabled?.value !== true) {
      console.log("[auditLogRetentionCron] disabled via flag, skipping")
      return
    }

    const { data: daysRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "audit_log_retention_days")
      .single()
    const days = typeof daysRow?.value === "number" ? daysRow.value : 365

    const runId = await logCronStart(supabase, "auditLogRetentionCron")
    try {
      const deleted = await pruneAuditLogs(supabase, days)
      await logCronEnd(supabase, runId, "success", { deleted, days })
      console.log(`[auditLogRetentionCron] deleted ${deleted} rows older than ${days}d`)
    } catch (err) {
      await logCronEnd(supabase, runId, "failed", { message: (err as Error).message })
      throw err
    }
  },
)
```

- [ ] **Step 3: Deploy the function**

Per project memory, multi-function deploys must use the codebase prefix:

```bash
firebase deploy --only functions:default:auditLogRetentionCron
```

Expected: function created in Firebase console; cron schedule visible.

- [ ] **Step 4: Trigger manually once + verify**

In Firebase console, manually invoke `auditLogRetentionCron`. Then:

```sql
SELECT cron_name, status, detail, finished_at
FROM cron_runs
WHERE cron_name = 'auditLogRetentionCron'
ORDER BY started_at DESC LIMIT 1;
```

Expected: `status='success'`, `detail={"deleted":...,"days":365}`.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/audit-logs.ts functions/src/index.ts
git commit -m "feat(audit): daily retention cron"
```

---

### Task 5.2: Wire retention status into automation health

The automation-health scanner already reads `cron_runs`. Add `'auditLogRetentionCron'` to its list of expected crons so a silent retention shows up in the daily watchdog.

**Files:**
- Modify: `lib/automation/automation-health-scanner.ts` (and its twin in `functions/src/lib/`)

- [ ] **Step 1: Find the `EXPECTED_CRONS` (or equivalent) array and append `'auditLogRetentionCron'`**

Run: `grep -n "automationHealthCron\|EXPECTED_CRONS\|expected_crons\|silent_crons" lib/automation/automation-health-scanner.ts`

Add `'auditLogRetentionCron'` to the expected list with an expected interval of `'daily'` (or whatever the existing structure uses — match it).

Apply the same change in the `functions/src/lib/` twin.

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add lib/automation/automation-health-scanner.ts functions/src/lib/automation-health-scanner.ts
git commit -m "feat(audit): expect retention cron in health scanner"
```

---

### Task 5.3: CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md` — add an `## Audit Logs` section to the architecture overview

- [ ] **Step 1: Append section**

After the existing "Insights Subsystem" section, add:

```markdown
## Audit Logs

Append-only trail of mutations, auth events, automation runs, and billing webhooks in `audit_logs`.

- Write path: `lib/audit/record.ts` exposes `recordAudit()` (fire-and-forget; resolves actor from `auth()` or accepts an `actor` override for system writes). Admin route handlers use `withAudit()` from `lib/audit/with-audit.ts` to auto-record success / denied / failure based on the response status.
- Action taxonomy lives in [lib/audit/actions.ts](lib/audit/actions.ts) — closed set; adding new events means adding rows there.
- Read path: admin-only `/admin/audit-logs` page (server component) with category / outcome / actor / target / date / free-text filters. API at `/api/admin/audit-logs`.
- Retention: daily `auditLogRetentionCron` (03:00 UTC) prunes rows older than `audit_log_retention_days` (default 365). Feature flag `cron_audit_log_retention_enabled` defaults TRUE because unbounded growth is a real cost concern — flip off only for investigations.
- Scrubbing: `lib/audit/scrub.ts` redacts password/token/secret/api_key at any depth and caps serialized metadata at 8KB.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(audit): describe audit log subsystem"
```

---

## Out of scope (deliberately, for v1)

- **Tamper-evident hashing.** No per-row HMAC chain; we trust service-role + RLS. Add later if SOC2 lights up.
- **Diff capture on update.** Wrapper records that an update happened but not before/after column values. For high-value targets (role changes, system settings) the inline `recordAudit` calls include `new_value` in metadata. Generic diff capture is a follow-up; revisit when a real investigation needs it.
- **Client-action logging.** Workouts logged, programs viewed by clients, etc., live in `client_engagement_snapshots` already; we don't duplicate them here.
- **Export.** No CSV export of audit logs yet — the table copy/paste covers most needs. Add when requested.
- **Per-row RLS for delegated admins.** All admin reads are equal. When `editor` role gets its own admin surfaces, decide then whether they need a scoped view.

---

## Self-Review

**Spec coverage:**
- ✅ Schema (Task 1.1) covers all spec fields; CHECK constraint includes all 11 categories.
- ✅ Action taxonomy (Task 1.2) — ~80 slugs covering auth, admin writes, client actions, support, commerce, billing, marketing, compliance, automation, system.
- ✅ Scrubbing rules (Task 1.3).
- ✅ `recordAudit()` (Task 1.5) + `withAudit()` (Task 1.6).
- ✅ Auth events (Tasks 2.1, 2.2).
- ✅ Admin writes (Tasks 3.1-3.4) — users, programs, exercises, blog, assignments, integrations, system settings, stripe webhook.
- ✅ **Client actions (Phase 3.5)** — workouts (boundary), assessments, readiness, goals, injuries, performance tests, profile, prefs, self-service cancel, PRs.
- ✅ **Support flows (Phase 3.6)** — form reviews, team videos, inbox sends.
- ✅ **Commerce (Phase 3.7)** — bookings full lifecycle, shop orders/downloads/leads, webhook bridge.
- ✅ **Marketing (Phase 3.8 part A)** — newsletter, lead magnets, event signups, contact, reviews, testimonials, moderation.
- ✅ **Compliance (Phase 3.8 part B)** — consents (granted/withdrawn with doc version), marketing consent, legal publish, bulk delete.
- ✅ Admin UI (Tasks 4.1, 4.2) — filter chips cover all 11 categories.
- ✅ Retention (Tasks 5.1, 5.2).
- ✅ Docs (Task 5.3).

**Placeholder scan:** No "TBD", "implement later", or "similar to" references. Every code block is complete enough to compile. A few Phase 3.x tasks tell the executor to `grep` for an endpoint path because route layout varies (e.g., team-videos has multiple sub-routes); each such task includes the exact grep command and the slug to apply.

**Type consistency:** `AuditCategory` (11 values), `AuditOutcome`, `AuditActorRole`, `AuditTarget`, `AuditLogRow`, `RecordAuditInput`, `WithAuditOptions` — names and shapes consistent across Tasks 1.2, 1.4, 1.5, 1.6, all 3.x, 4.1, 4.2. The category set appears in three places (SQL CHECK in Task 1.1, TS union in Task 1.2, allowlist sets in Task 4.1 GET and 4.2 filters) — all three updated together.

**Volume sanity check:** The biggest risk in expanding to client actions is row volume. By auditing **session boundaries** (`workout.completed`) and not individual sets, an active client generates ~3-5 rows per week (1 workout completed + 1 readiness + occasional goal/injury edits). 100 active clients × 5/wk × 52 = ~26k rows/year. Add ~50k admin/marketing/automation rows = ~75k/year total — well under the 1M-row index sweet spot and pruned annually by the retention cron.

**Volume mitigation if it grows further:** If `workout.completed` traffic ever swamps the table, narrow the indexes (`idx_audit_logs_category_action` already lets us cheaply exclude `client_action` from most queries) and shorten the retention window for that category specifically via a follow-up migration that adds a per-category retention map. Out of scope for v1.

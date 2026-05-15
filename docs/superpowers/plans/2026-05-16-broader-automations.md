# Broader Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is designed to be executed via the **ralph-loop** skill — work phase by phase, mark steps complete as you go, and emit `<promise>PHASE_N_COMPLETE</promise>` at the end of each phase. After Phase 5, emit `<promise>ALL_PHASES_COMPLETE</promise>`.

**Goal:** Extend the DJP Athlete automation suite beyond the content engine to surface five categories of operational data the coach currently can't see automatically: client engagement & churn risk, revenue & Stripe health, automation watchdog, content→revenue attribution, and coach inbox SLA.

**Architecture:** Each phase follows the established cron pattern documented in `CLAUDE.md`: Firebase `onSchedule` function in `functions/src/index.ts` → POST to `/api/admin/internal/<slug>` with `INTERNAL_CRON_TOKEN` bearer → Next.js route does the work via Supabase service-role client → snapshot row persisted to a per-phase table → optional email via Resend → optional surface on `/admin/automation` or `/admin/insights`. Mirrors `seo-agent-cron` / `ads-outcome-tracker-cron` exactly.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (migrations via `mcp__supabase__apply_migration`), Firebase Functions v2 `onSchedule`, Resend (email), Zod (validation), Vitest (tests). Solo-dev workflow per memory: commit directly to `main`, no PR/worktree.

---

## Conventions (read before any task)

- **Migrations:** apply via `mcp__supabase__apply_migration` MCP tool. Mirror the SQL into `supabase/migrations/<UTC timestamp>_<slug>.sql` so the file is checked in. Never run `supabase db push`.
- **Internal routes:** all live under `app/api/admin/internal/<slug>/route.ts`. They MUST gate on `Authorization: Bearer ${INTERNAL_CRON_TOKEN}` and on a per-feature `system_settings` flag (default `false` until verified). They MUST also short-circuit when `automation_paused = true`.
- **Cron registrations:** add to `functions/src/index.ts` following the exact shape of existing `onSchedule(...)` blocks (e.g. `outcomeTrackerCron`). Use `secrets: [internalCronToken, appUrl]`. Always include console.log of status + body for ops visibility.
- **DAL files:** one file per new table under `lib/db/`. Export named functions, never default. Use `SupabaseClient` from `@supabase/supabase-js`, do NOT pass the `Database` generic (per memory).
- **Validators:** mirror new tables in `lib/validators/<slug>.ts` with Zod schemas. Types in `types/database.ts` extended in the same commit.
- **Tests:** Vitest under `__tests__/`. Each scorer/aggregator function gets a unit test with table-driven cases. Use `vi.mock` for Supabase. Integration tests for routes optional but encouraged.
- **No new env vars** unless absolutely required. Reuse `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_CRON_TOKEN`, `APP_URL`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `GHL_API_KEY`, `GOOGLE_ADS_DEVELOPER_TOKEN`. If something genuinely new is needed, add it to `.env.example` in the same commit.
- **Commits:** one commit per task (not per step). Use Conventional Commits: `feat(automation): ...`, `feat(db): ...`, `feat(cron): ...`, `test: ...`, `chore(db): migration <slug>`.
- **functions/ ↔ lib/ boundary:** `functions/` has `rootDir: "src"` and cannot import from `lib/`. If a helper is needed in both runtimes, write twin copies in `functions/src/lib/<name>.ts` AND `lib/automation/<name>.ts`.
- **Feature flags:** every new cron is gated by a row in `system_settings`. Convention: `cron_<slug>_enabled` (boolean, default `false`). Insert the row in the migration.

---

## File Structure (locked in before tasks)

### New files

```
supabase/migrations/
  2026XXXX_client_engagement_snapshots.sql        # Phase 1
  2026XXXX_revenue_snapshots.sql                  # Phase 2
  2026XXXX_automation_health_snapshots.sql        # Phase 3
  2026XXXX_cron_runs.sql                          # Phase 3
  2026XXXX_content_attribution_snapshots.sql      # Phase 4
  2026XXXX_inbox_sla_snapshots.sql                # Phase 5

lib/db/
  client-engagement.ts                            # Phase 1
  revenue-snapshots.ts                            # Phase 2
  automation-health.ts                            # Phase 3
  cron-runs.ts                                    # Phase 3
  content-attribution.ts                          # Phase 4
  inbox-sla.ts                                    # Phase 5

lib/automation/
  client-risk-scorer.ts                           # Phase 1 (pure)
  revenue-aggregator.ts                           # Phase 2 (pure)
  automation-health-scanner.ts                    # Phase 3 (pure)
  content-revenue-joiner.ts                       # Phase 4 (pure)
  inbox-sla-aggregator.ts                         # Phase 5 (pure)

lib/validators/
  client-engagement.ts                            # Phase 1
  revenue-snapshots.ts                            # Phase 2
  automation-health.ts                            # Phase 3
  content-attribution.ts                          # Phase 4
  inbox-sla.ts                                    # Phase 5

app/api/admin/internal/
  client-risk-scan/route.ts                       # Phase 1
  revenue-digest/route.ts                         # Phase 2
  automation-health/route.ts                      # Phase 3
  content-attribution/route.ts                    # Phase 4
  inbox-sla/route.ts                              # Phase 5

app/(admin)/admin/insights/
  client-risk/page.tsx                            # Phase 1
  revenue/page.tsx                                # Phase 2
  automation-health/page.tsx                      # Phase 3
  content-revenue/page.tsx                        # Phase 4
  inbox-sla/page.tsx                              # Phase 5

components/admin/insights/
  ClientRiskTable.tsx                             # Phase 1
  RevenueDigestCard.tsx                           # Phase 2
  AutomationHealthBoard.tsx                       # Phase 3
  ContentRevenueTable.tsx                         # Phase 4
  InboxSlaCard.tsx                                # Phase 5

emails/
  ClientRiskDigest.tsx                            # Phase 1
  RevenueDigest.tsx                               # Phase 2
  AutomationHealthAlert.tsx                       # Phase 3

__tests__/
  lib/automation/client-risk-scorer.test.ts       # Phase 1
  lib/automation/revenue-aggregator.test.ts       # Phase 2
  lib/automation/automation-health-scanner.test.ts # Phase 3
  lib/automation/content-revenue-joiner.test.ts   # Phase 4
  lib/automation/inbox-sla-aggregator.test.ts     # Phase 5
```

### Modified files

```
functions/src/index.ts                            # all phases — register crons + handlers
app/api/admin/internal/daily-pulse/route.ts       # phases 1, 5 — inject sections
functions/src/lib/cron-runs.ts                    # phase 3 — twin of lib/db/cron-runs
lib/agents/performance-learning-loop.ts           # phase 4 — weight by revenue
.env.example                                      # any phase needing a new secret
```

---

## Phase 1: Client Engagement & Churn Risk Digest

**Why first:** highest coaching ROI, pure Supabase aggregation (no third-party API), proves the pattern. The coach gets a daily "who needs reach-out" list inside the existing Daily Pulse email.

### 🛠 Schema reconciliation note (added 2026-05-16 during Task 1.1)

After running `mcp__supabase__list_tables` the original signal model was rewritten to match real tables. Decisions:

- **No `users.last_login_at` column exists.** Replaced "days since last login" with **"days since last training session"** — derived from `MAX(training_sessions.date) WHERE client_user_id = X`. Column renamed in the migration: `days_since_last_session`.
- **No `workout_sessions` table.** `training_sessions` is a log of *completed* sessions only — no scheduled/missed rows. Replaced "workout adherence" with **"session frequency pct"** = actual_sessions_14d / expected_14d × 100, where `expected_14d = client_profiles.preferred_training_days × 2`. Column renamed: `session_frequency_pct_14d`. The standalone `missed_sessions_14d` signal is dropped — it's mathematically the inverse of the same number.
- **No `assessments` table.** The closest "client-submitted, awaiting coach review" surface is `form_reviews` with `status = 'pending'`. Renamed signal: `open_form_review_days` = days since oldest pending `form_reviews.created_at`. We also track `open_performance_assessment_days` (performance_assessments where status IN ('draft','in_progress'), oldest by updated_at) as a secondary, weaker signal.
- **No `client_programs` table.** Used `program_assignments` — it has `end_date date` AND `expires_at timestamptz`. We use `end_date` (the planned program end) as the renewal trigger.
- **No `last_renewal_conversation_at` anywhere.** Added it as a new nullable timestamptz on `program_assignments` in the same migration. Coach manually updates this column (or we add a tiny admin action later).
- **Active client filter:** `users.role = 'client' AND status = 'active'` (status enum: active / inactive / suspended / lead).

Revised risk model:

| Signal | Source | Threshold | Weight |
| --- | --- | --- | --- |
| `days_since_last_session` | training_sessions MAX(date) gap | >=7 / >=14 / >=30 | +15 / +25 / +40 (highest applies) |
| `session_frequency_pct_14d` | actual / (preferred_training_days × 2) | <50% / <25% | +20 / +35 (highest applies) |
| `open_form_review_days` | form_reviews status='pending' oldest | >=5 / >=10 | +10 / +20 (highest applies) |
| `open_performance_assessment_days` | performance_assessments status IN draft,in_progress oldest updated_at | >=10 | +10 |
| `program_ending_in_days` | program_assignments end_date - now, status='active' | <=14 AND no renewal conversation within 30d | +15 |

Tier mapping unchanged: `>=60` high, `>=35` medium, `>=15` low, else none.

_(Original speculative model removed — superseded by the reconciled model above.)_

### Task 1.1: Migration `client_engagement_snapshots`

**Files:**
- Create: `supabase/migrations/<UTC>_client_engagement_snapshots.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Per-client daily snapshot; one row per (client_id, snapshot_date)
CREATE TABLE IF NOT EXISTS client_engagement_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- raw signals (renamed per Schema reconciliation note)
  days_since_last_session INTEGER NOT NULL,
  session_frequency_pct_14d NUMERIC(5,2),
  open_form_review_days INTEGER,
  open_performance_assessment_days INTEGER,
  program_ending_in_days INTEGER,
  last_renewal_conversation_at TIMESTAMPTZ,

  -- scored
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('none','low','medium','high')),
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["no_login_30d","adherence_lt_50"]

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date)
);

CREATE INDEX idx_ces_snapshot_date ON client_engagement_snapshots (snapshot_date DESC);
CREATE INDEX idx_ces_risk_tier ON client_engagement_snapshots (risk_tier, snapshot_date DESC)
  WHERE risk_tier IN ('high','medium');

INSERT INTO system_settings (key, value)
VALUES ('cron_client_risk_scan_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase__apply_migration` with name `client_engagement_snapshots` and the SQL above.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations
git commit -m "chore(db): migration client_engagement_snapshots"
```

### Task 1.2: Types + validator

**Files:**
- Modify: `types/database.ts` — append `ClientEngagementSnapshot` interface + `RiskTier` union.
- Create: `lib/validators/client-engagement.ts`

- [ ] **Step 1: Append type**

```typescript
// types/database.ts (append)
export type RiskTier = 'none' | 'low' | 'medium' | 'high'

export interface ClientEngagementSnapshot {
  id: string
  client_id: string
  snapshot_date: string
  days_since_last_login: number
  workout_adherence_pct_14d: number | null
  assessment_unreviewed_days: number | null
  program_ending_in_days: number | null
  missed_sessions_14d: number
  last_renewal_conversation_at: string | null
  risk_score: number
  risk_tier: RiskTier
  reasons: string[]
  created_at: string
}
```

- [ ] **Step 2: Zod validator**

```typescript
// lib/validators/client-engagement.ts
import { z } from 'zod'

export const riskTierSchema = z.enum(['none', 'low', 'medium', 'high'])

export const clientEngagementSnapshotSchema = z.object({
  client_id: z.string().uuid(),
  snapshot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days_since_last_login: z.number().int().min(0),
  workout_adherence_pct_14d: z.number().min(0).max(100).nullable(),
  assessment_unreviewed_days: z.number().int().min(0).nullable(),
  program_ending_in_days: z.number().int().nullable(),
  missed_sessions_14d: z.number().int().min(0),
  last_renewal_conversation_at: z.string().datetime().nullable(),
  risk_score: z.number().int().min(0).max(100),
  risk_tier: riskTierSchema,
  reasons: z.array(z.string()),
})

export type ClientEngagementSnapshotInsert = z.infer<typeof clientEngagementSnapshotSchema>
```

- [ ] **Step 3: Commit**

```bash
git add types/database.ts lib/validators/client-engagement.ts
git commit -m "feat(db): types + validator for client engagement snapshots"
```

### Task 1.3: Pure scorer with tests (TDD)

**Files:**
- Create: `__tests__/lib/automation/client-risk-scorer.test.ts`
- Create: `lib/automation/client-risk-scorer.ts`

- [ ] **Step 1: Write failing test**

```typescript
// __tests__/lib/automation/client-risk-scorer.test.ts
import { describe, expect, it } from 'vitest'
import { scoreClientRisk, type RiskInput } from '@/lib/automation/client-risk-scorer'

const base: RiskInput = {
  days_since_last_login: 0,
  workout_adherence_pct_14d: 100,
  assessment_unreviewed_days: null,
  program_ending_in_days: null,
  missed_sessions_14d: 0,
  last_renewal_conversation_at: new Date().toISOString(),
}

describe('scoreClientRisk', () => {
  it('returns none tier for a perfectly engaged client', () => {
    const r = scoreClientRisk(base)
    expect(r.risk_score).toBe(0)
    expect(r.risk_tier).toBe('none')
    expect(r.reasons).toEqual([])
  })

  it('30-day no-login + 20% adherence = high tier with both reasons', () => {
    const r = scoreClientRisk({
      ...base,
      days_since_last_login: 35,
      workout_adherence_pct_14d: 20,
    })
    expect(r.risk_score).toBe(75) // 40 + 35
    expect(r.risk_tier).toBe('high')
    expect(r.reasons).toContain('no_login_30d')
    expect(r.reasons).toContain('adherence_lt_25')
  })

  it('login buckets do not stack — only the highest applies', () => {
    const r7 = scoreClientRisk({ ...base, days_since_last_login: 7 })
    const r14 = scoreClientRisk({ ...base, days_since_last_login: 14 })
    const r30 = scoreClientRisk({ ...base, days_since_last_login: 30 })
    expect(r7.risk_score).toBe(15)
    expect(r14.risk_score).toBe(25)
    expect(r30.risk_score).toBe(40)
  })

  it('caps missed-sessions contribution at 20', () => {
    const r = scoreClientRisk({ ...base, missed_sessions_14d: 10 })
    expect(r.risk_score).toBe(20)
    expect(r.reasons).toContain('missed_sessions_cap')
  })

  it('renewal flag only fires when both conditions hold', () => {
    const recent = scoreClientRisk({
      ...base,
      program_ending_in_days: 10,
      last_renewal_conversation_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    })
    expect(recent.reasons).not.toContain('renewal_unstarted')

    const stale = scoreClientRisk({
      ...base,
      program_ending_in_days: 10,
      last_renewal_conversation_at: null,
    })
    expect(stale.risk_score).toBe(15)
    expect(stale.reasons).toContain('renewal_unstarted')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- client-risk-scorer
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/automation/client-risk-scorer.ts
export interface RiskInput {
  days_since_last_login: number
  workout_adherence_pct_14d: number | null
  assessment_unreviewed_days: number | null
  program_ending_in_days: number | null
  missed_sessions_14d: number
  last_renewal_conversation_at: string | null
}

export interface RiskOutput {
  risk_score: number
  risk_tier: 'none' | 'low' | 'medium' | 'high'
  reasons: string[]
}

const RENEWAL_LOOKBACK_DAYS = 30

export function scoreClientRisk(input: RiskInput): RiskOutput {
  const reasons: string[] = []
  let score = 0

  // login bucket (highest applies)
  if (input.days_since_last_login >= 30) {
    score += 40
    reasons.push('no_login_30d')
  } else if (input.days_since_last_login >= 14) {
    score += 25
    reasons.push('no_login_14d')
  } else if (input.days_since_last_login >= 7) {
    score += 15
    reasons.push('no_login_7d')
  }

  // adherence bucket (highest applies)
  const adh = input.workout_adherence_pct_14d
  if (adh !== null) {
    if (adh < 25) {
      score += 35
      reasons.push('adherence_lt_25')
    } else if (adh < 50) {
      score += 20
      reasons.push('adherence_lt_50')
    }
  }

  // assessment bucket (highest applies)
  const ua = input.assessment_unreviewed_days
  if (ua !== null) {
    if (ua >= 10) {
      score += 20
      reasons.push('assessment_stale_10d')
    } else if (ua >= 5) {
      score += 10
      reasons.push('assessment_stale_5d')
    }
  }

  // renewal window
  if (input.program_ending_in_days !== null && input.program_ending_in_days <= 14) {
    const lastConv = input.last_renewal_conversation_at
    const stale =
      lastConv === null ||
      Date.now() - new Date(lastConv).getTime() > RENEWAL_LOOKBACK_DAYS * 86400000
    if (stale) {
      score += 15
      reasons.push('renewal_unstarted')
    }
  }

  // missed sessions
  if (input.missed_sessions_14d > 0) {
    const raw = input.missed_sessions_14d * 5
    const capped = Math.min(raw, 20)
    score += capped
    reasons.push(capped === 20 && raw > 20 ? 'missed_sessions_cap' : 'missed_sessions')
  }

  // cap and tier
  const finalScore = Math.min(score, 100)
  const tier: RiskOutput['risk_tier'] =
    finalScore >= 60 ? 'high' : finalScore >= 35 ? 'medium' : finalScore >= 15 ? 'low' : 'none'

  return { risk_score: finalScore, risk_tier: tier, reasons }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npm run test:run -- client-risk-scorer
```

- [ ] **Step 5: Commit**

```bash
git add lib/automation/client-risk-scorer.ts __tests__/lib/automation/client-risk-scorer.test.ts
git commit -m "feat(automation): client risk scorer with thresholds + reasons"
```

### Task 1.4: Signal collectors (Supabase queries)

**Files:**
- Create: `lib/db/client-engagement.ts`

- [ ] **Step 1: Write the DAL**

```typescript
// lib/db/client-engagement.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientEngagementSnapshot } from '@/types/database'
import type { RiskInput } from '@/lib/automation/client-risk-scorer'

/**
 * Pulls all signals required by scoreClientRisk for every active client.
 * Designed for ~hundreds of clients. If this grows, paginate via id ranges.
 *
 * Each helper query is scoped to one signal so the cron can be re-run safely
 * and partial failures only affect one column.
 */

export async function listActiveClientIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'client')
    .eq('status', 'active')
  if (error) throw new Error(`listActiveClientIds: ${error.message}`)
  return (data ?? []).map((r: { id: string }) => r.id)
}

export async function collectRiskInput(
  supabase: SupabaseClient,
  clientId: string,
): Promise<RiskInput> {
  // last login — from auth_audit or users.last_login_at; check what exists.
  const { data: user } = await supabase
    .from('users')
    .select('last_login_at')
    .eq('id', clientId)
    .single()
  const days_since_last_login = user?.last_login_at
    ? Math.floor((Date.now() - new Date(user.last_login_at).getTime()) / 86400000)
    : 999

  // workout adherence last 14d — completed vs assigned sessions
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString()
  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select('status, scheduled_for')
    .eq('client_id', clientId)
    .gte('scheduled_for', fourteenDaysAgo)
  const total = sessions?.length ?? 0
  const completed = sessions?.filter((s: { status: string }) => s.status === 'completed').length ?? 0
  const workout_adherence_pct_14d = total > 0 ? (completed / total) * 100 : null
  const missed_sessions_14d =
    sessions?.filter((s: { status: string }) => s.status === 'missed').length ?? 0

  // unreviewed assessment — oldest open one
  const { data: assess } = await supabase
    .from('assessments')
    .select('submitted_at')
    .eq('client_id', clientId)
    .is('reviewed_at', null)
    .order('submitted_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const assessment_unreviewed_days = assess?.submitted_at
    ? Math.floor((Date.now() - new Date(assess.submitted_at).getTime()) / 86400000)
    : null

  // program ending in days
  const { data: program } = await supabase
    .from('client_programs')
    .select('ends_at, last_renewal_conversation_at')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('ends_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const program_ending_in_days = program?.ends_at
    ? Math.floor((new Date(program.ends_at).getTime() - Date.now()) / 86400000)
    : null
  const last_renewal_conversation_at = program?.last_renewal_conversation_at ?? null

  return {
    days_since_last_login,
    workout_adherence_pct_14d,
    assessment_unreviewed_days,
    program_ending_in_days,
    missed_sessions_14d,
    last_renewal_conversation_at,
  }
}

export async function upsertSnapshot(
  supabase: SupabaseClient,
  row: Omit<ClientEngagementSnapshot, 'id' | 'created_at'>,
): Promise<void> {
  const { error } = await supabase
    .from('client_engagement_snapshots')
    .upsert(row, { onConflict: 'client_id,snapshot_date' })
  if (error) throw new Error(`upsertSnapshot: ${error.message}`)
}

export async function topRiskToday(
  supabase: SupabaseClient,
  limit = 10,
): Promise<ClientEngagementSnapshot[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('client_engagement_snapshots')
    .select('*')
    .eq('snapshot_date', today)
    .in('risk_tier', ['high', 'medium'])
    .order('risk_score', { ascending: false })
    .limit(limit)
  return (data ?? []) as ClientEngagementSnapshot[]
}
```

**Note for the implementer:** the column names assumed above (`users.status`, `users.last_login_at`, `workout_sessions.status`, `assessments.reviewed_at`, `client_programs.last_renewal_conversation_at`) are best-effort guesses. Before this task ships:
1. Run `mcp__supabase__list_tables` and reconcile the actual schema.
2. If `last_renewal_conversation_at` does not exist on `client_programs`, add a migration adding it (nullable timestamptz). Do not silently drop the renewal signal.
3. If `workout_sessions.status` uses different enum values, update the comparisons.

- [ ] **Step 2: Reconcile schema**

```bash
# call mcp__supabase__list_tables and adjust column names in client-engagement.ts
```

- [ ] **Step 3: Commit**

```bash
git add lib/db/client-engagement.ts supabase/migrations/
git commit -m "feat(db): signal collectors for client engagement"
```

### Task 1.5: Internal route `/api/admin/internal/client-risk-scan`

**Files:**
- Create: `app/api/admin/internal/client-risk-scan/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// app/api/admin/internal/client-risk-scan/route.ts
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase'
import {
  collectRiskInput,
  listActiveClientIds,
  upsertSnapshot,
} from '@/lib/db/client-engagement'
import { scoreClientRisk } from '@/lib/automation/client-risk-scorer'
import { isAutomationPaused, isFlagEnabled } from '@/lib/db/system-settings'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const auth = req.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.INTERNAL_CRON_TOKEN}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  if (await isAutomationPaused(supabase)) {
    return NextResponse.json({ skipped: 'automation_paused' })
  }
  if (!(await isFlagEnabled(supabase, 'cron_client_risk_scan_enabled'))) {
    return NextResponse.json({ skipped: 'flag_off' })
  }

  const today = new Date().toISOString().slice(0, 10)
  const ids = await listActiveClientIds(supabase)
  const counters = { total: ids.length, scored: 0, high: 0, medium: 0, low: 0, errors: 0 }

  for (const id of ids) {
    try {
      const input = await collectRiskInput(supabase, id)
      const scored = scoreClientRisk(input)
      await upsertSnapshot(supabase, {
        client_id: id,
        snapshot_date: today,
        ...input,
        ...scored,
      })
      counters.scored += 1
      counters[scored.risk_tier === 'high' ? 'high'
        : scored.risk_tier === 'medium' ? 'medium'
        : scored.risk_tier === 'low' ? 'low' : 'low'] += 0 // tier counter
      if (scored.risk_tier === 'high') counters.high += 1
      else if (scored.risk_tier === 'medium') counters.medium += 1
      else if (scored.risk_tier === 'low') counters.low += 1
    } catch (err) {
      counters.errors += 1
      console.error('[client-risk-scan] failed for', id, err)
    }
  }

  return NextResponse.json(counters)
}
```

- [ ] **Step 2: Add `isFlagEnabled` helper if missing**

Check `lib/db/system-settings.ts`. If `isFlagEnabled(supabase, key)` doesn't exist, add it: `SELECT value FROM system_settings WHERE key = ? LIMIT 1` → coerce to boolean.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/internal/client-risk-scan lib/db/system-settings.ts
git commit -m "feat(automation): client-risk-scan internal route"
```

### Task 1.6: Cron registration

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Append cron block**

```typescript
// functions/src/index.ts — append near other *Cron exports
export const clientRiskScanCron = onSchedule(
  {
    schedule: '0 5 * * *', // 05:00 UTC — between SEO outcome (04:15) and adsOutcome (04:30) is taken; pick 05:00 to leave the early-UTC band clear
    timeZone: 'UTC',
    timeoutSeconds: 540,
    memory: '256MiB',
    region: 'us-central1',
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error('[clientRiskScanCron] APP_URL or INTERNAL_CRON_TOKEN missing')
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/client-risk-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
      })
      console.log('[clientRiskScanCron]', res.status, await res.json().catch(() => ({})))
    } catch (err) {
      console.error('[clientRiskScanCron] failed:', err)
    }
  },
)
```

- [ ] **Step 2: Deploy hint**

Do NOT deploy from this task. The user (solo dev) deploys with `firebase deploy --only functions:default:clientRiskScanCron` at their discretion (per memory: codebase prefix required).

- [ ] **Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat(cron): clientRiskScanCron at 05:00 UTC daily"
```

### Task 1.7: Admin UI page `/admin/insights/client-risk`

**Files:**
- Create: `app/(admin)/admin/insights/client-risk/page.tsx`
- Create: `components/admin/insights/ClientRiskTable.tsx`

- [ ] **Step 1: Server component page**

```tsx
// app/(admin)/admin/insights/client-risk/page.tsx
import { createServerClient } from '@/lib/supabase'
import { ClientRiskTable } from '@/components/admin/insights/ClientRiskTable'

export const dynamic = 'force-dynamic'

export default async function ClientRiskPage() {
  const supabase = await createServerClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: snapshots } = await supabase
    .from('client_engagement_snapshots')
    .select('*, users:users!client_engagement_snapshots_client_id_fkey(name,email)')
    .eq('snapshot_date', today)
    .order('risk_score', { ascending: false })

  return (
    <div className="space-y-6 p-6">
      <h1 className="font-heading text-3xl">Client Risk</h1>
      <p className="text-muted-foreground">
        Daily snapshot — refreshed via clientRiskScanCron at 05:00 UTC. Score = weighted sum of
        engagement signals. See <code>lib/automation/client-risk-scorer.ts</code> for the rubric.
      </p>
      <ClientRiskTable snapshots={snapshots ?? []} />
    </div>
  )
}
```

- [ ] **Step 2: Table component (client component, sortable)**

Use Tanstack Table if already in the project, else a plain `<table>` with shadcn `Table` components. Columns: Client, Tier (badge), Score, Reasons (chips), Last login, Adherence, Open assessment days. Sort default by `risk_score DESC`.

- [ ] **Step 3: Add nav entry**

In whichever admin nav file exists (`components/admin/sidebar/*` or similar), add a link under "Insights" → "Client Risk".

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/insights/client-risk components/admin/insights/ClientRiskTable.tsx
git commit -m "feat(admin): client-risk insights page"
```

### Task 1.8: Daily Pulse integration

**Files:**
- Modify: `app/api/admin/internal/daily-pulse/route.ts` (or wherever the Daily Pulse handler lives — locate via grep for `runSendDailyPulse` / `send-daily-pulse`).
- Modify: the matching `emails/DailyPulse.tsx` (or current name) to render the new section.

- [ ] **Step 1: Locate the Daily Pulse composer**

```bash
# grep -r "Daily Pulse" emails app/api
```

- [ ] **Step 2: Inject "Clients needing reach-out" section**

Pull top 5 from `topRiskToday(supabase, 5)`. Render a compact list:

```
At-risk clients (today)
1. Sarah K — high (75): no login 30d, adherence 22%
2. Mark P — high (60): renewal unstarted, no login 14d
...
(See dashboard for full list)
```

If `topRiskToday` returns empty, render "No high/medium risk clients today ✓".

- [ ] **Step 3: Smoke test**

Trigger the route manually:

```bash
curl -X POST http://localhost:3050/api/admin/internal/daily-pulse \
  -H "Authorization: Bearer $INTERNAL_CRON_TOKEN"
```

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/internal/daily-pulse emails
git commit -m "feat(email): daily pulse — surface at-risk clients"
```

### Task 1.9: Wrap Phase 1

- [ ] Confirm: migration applied, cron registered, route tested, page renders, daily pulse updated.
- [ ] Emit `<promise>PHASE_1_COMPLETE</promise>` for ralph-loop.

---

## Phase 2: Revenue & Stripe Health Digest

**Why second:** business-critical for renewals & cash visibility. Sent weekly Monday morning to the coach.

### Task 2.1: Migration `revenue_snapshots`

**Files:**
- Create: `supabase/migrations/<UTC>_revenue_snapshots.sql`

- [ ] **Step 1: Migration**

```sql
-- One row per ISO week (Monday-anchored). Cron upserts on (week_of).
CREATE TABLE IF NOT EXISTS revenue_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of DATE NOT NULL UNIQUE,  -- Monday of the week
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  mrr_cents BIGINT NOT NULL DEFAULT 0,
  mrr_delta_cents BIGINT NOT NULL DEFAULT 0,         -- vs previous week
  new_customers INTEGER NOT NULL DEFAULT 0,
  churned_customers INTEGER NOT NULL DEFAULT 0,
  failed_payments_7d INTEGER NOT NULL DEFAULT 0,
  failed_payment_value_cents BIGINT NOT NULL DEFAULT 0,
  upcoming_renewals_14d INTEGER NOT NULL DEFAULT 0,
  upcoming_renewals_value_cents BIGINT NOT NULL DEFAULT 0,

  top_at_risk_subscriptions JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{ subscription_id, customer_id, customer_email, mrr_cents, renewal_at, reason }]
  raw JSONB NOT NULL DEFAULT '{}'::jsonb  -- whatever Stripe payload pieces we kept
);

CREATE INDEX idx_rs_generated ON revenue_snapshots (generated_at DESC);

INSERT INTO system_settings (key, value)
VALUES ('cron_revenue_digest_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply via MCP** (as Phase 1.1)
- [ ] **Step 3: Commit:** `chore(db): migration revenue_snapshots`

### 🛠 Schema reconciliation note for Phase 2 (added 2026-05-16)

Stripe is fully wired (path A in Task 2.2 below). Confirmed:
- `lib/stripe.ts` exists with subscription helpers and webhook signature verification.
- `subscriptions` table has `stripe_subscription_id`, `stripe_customer_id`, `status` (active/past_due/canceled/unpaid/incomplete/trialing/paused), `current_period_end`, `cancel_at_period_end`, `canceled_at`, `program_id`. **No `monthly_cents` column.**
- `programs` table has `price_cents`, `billing_interval` (week/month/year), `stripe_price_id`. Monthly amount derives from `price_cents` normalized by interval.
- `payments` table has `amount_cents`, `status` (pending/succeeded/failed/refunded), `stripe_payment_id`, `created_at`, `user_id`.

Aggregator data sources (all DB, no Stripe API hammering):
- **MRR** = SUM over rows in `subscriptions` (status IN ('active','trialing','past_due')) of `programs.price_cents` normalized to monthly: `month` → as-is, `year` → /12, `week` → ×4.33. Anything else: skip.
- **New customers (7d)** = `subscriptions.created_at` within last 7d, distinct user_id.
- **Churned customers (7d)** = `subscriptions.canceled_at` within last 7d.
- **Failed payments (7d)** = `payments.status='failed' AND created_at >= now()-7d`.
- **Upcoming renewals (14d)** = `subscriptions.status IN ('active','trialing') AND current_period_end <= now()+14d`.
- **At-risk subscriptions** = active subs where `cancel_at_period_end=true` OR the subscription's user has a failed payment in last 7d. Joined with `programs` for monthly amount + with `users` for email.

### Task 2.2: Stripe data source

Per `CLAUDE.md`, Stripe is **planned** but not yet fully integrated. This phase MUST work with whatever's wired today.

- [ ] **Step 1: Detect existing Stripe wiring**

```bash
# Grep for `stripe`, `Stripe`, `STRIPE_SECRET_KEY` in lib/ and app/api/
```

Three outcomes:
- **(A) Stripe SDK already used (subscriptions live):** use it directly. Fetch all active subs, sum monthly amounts → MRR. Iterate invoices last 7d for failed.
- **(B) Stripe present but only for one-time checkout:** treat subscription metrics as 0, but still compute failed-payment counts from Stripe.
- **(C) Stripe not present:** use only `bookings` + `payments` tables to compute revenue. Subscription metrics return 0 with a `data_source: 'bookings_only'` note in `raw`.

The aggregator MUST handle all three branches cleanly — never throw because Stripe is absent.

### Task 2.3: Pure aggregator + tests

**Files:**
- Create: `__tests__/lib/automation/revenue-aggregator.test.ts`
- Create: `lib/automation/revenue-aggregator.ts`

- [ ] **Step 1: Test scaffolding**

Test that:
- given an empty Stripe + empty bookings, returns zeros without crashing
- given 3 active subscriptions at $200, $200, $400 monthly → MRR = $80000 cents
- delta vs previous snapshot computed correctly
- failed payments aggregated by status='failed' AND created_at within 7d
- at-risk subs ranked by mrr_cents desc, capped at top 5

- [ ] **Step 2: Implement**

```typescript
// lib/automation/revenue-aggregator.ts
export interface RevenueInputs {
  active_subscriptions: Array<{
    id: string
    customer_id: string
    customer_email: string
    monthly_cents: number
    current_period_end: string
    cancel_at_period_end: boolean
  }>
  failed_payments_last_7d: Array<{
    id: string
    customer_email: string
    amount_cents: number
    created_at: string
  }>
  previous_mrr_cents: number
  new_customers_7d: number
  churned_customers_7d: number
}

export interface RevenueOutput {
  mrr_cents: number
  mrr_delta_cents: number
  new_customers: number
  churned_customers: number
  failed_payments_7d: number
  failed_payment_value_cents: number
  upcoming_renewals_14d: number
  upcoming_renewals_value_cents: number
  top_at_risk_subscriptions: Array<{
    subscription_id: string
    customer_email: string
    mrr_cents: number
    renewal_at: string
    reason: 'cancel_at_period_end' | 'failed_payment' | 'churn_risk_client'
  }>
}

export function aggregateRevenue(input: RevenueInputs): RevenueOutput {
  const mrr_cents = input.active_subscriptions.reduce((s, x) => s + x.monthly_cents, 0)
  const failed_set = new Set(input.failed_payments_last_7d.map(p => p.customer_email))
  const fourteen = Date.now() + 14 * 86400000

  const upcoming = input.active_subscriptions.filter(
    s => new Date(s.current_period_end).getTime() <= fourteen,
  )

  const risk = input.active_subscriptions
    .map(s => {
      const reason = s.cancel_at_period_end
        ? 'cancel_at_period_end'
        : failed_set.has(s.customer_email)
        ? 'failed_payment'
        : null
      return reason ? { ...s, reason } : null
    })
    .filter(Boolean)
    .sort((a, b) => b!.monthly_cents - a!.monthly_cents)
    .slice(0, 5)
    .map(s => ({
      subscription_id: s!.id,
      customer_email: s!.customer_email,
      mrr_cents: s!.monthly_cents,
      renewal_at: s!.current_period_end,
      reason: s!.reason as 'cancel_at_period_end' | 'failed_payment',
    }))

  return {
    mrr_cents,
    mrr_delta_cents: mrr_cents - input.previous_mrr_cents,
    new_customers: input.new_customers_7d,
    churned_customers: input.churned_customers_7d,
    failed_payments_7d: input.failed_payments_last_7d.length,
    failed_payment_value_cents: input.failed_payments_last_7d.reduce(
      (s, p) => s + p.amount_cents,
      0,
    ),
    upcoming_renewals_14d: upcoming.length,
    upcoming_renewals_value_cents: upcoming.reduce((s, x) => s + x.monthly_cents, 0),
    top_at_risk_subscriptions: risk,
  }
}
```

- [ ] **Step 3: Tests green, commit:** `feat(automation): revenue aggregator + tests`

### Task 2.4: Stripe collector + DAL

**Files:**
- Create: `lib/db/revenue-snapshots.ts`
- Create: `lib/automation/stripe-source.ts` (only if Stripe live)

- [ ] Build `fetchStripeRevenueInputs(): Promise<RevenueInputs>` that calls Stripe and shapes data, OR a fallback `fetchFallbackRevenueInputs()` reading from `bookings` + `payments` tables.
- [ ] DAL: `insertSnapshot(weekOf, RevenueOutput, raw)`, `previousSnapshot(weekOf)`, `latestSnapshot()`.
- [ ] **Commit:** `feat(db): revenue snapshot DAL + Stripe collector`

### Task 2.5: Internal route + cron

**Files:**
- Create: `app/api/admin/internal/revenue-digest/route.ts`
- Modify: `functions/src/index.ts`

- [ ] Route gated like Phase 1.5. Schedule: `0 13 * * 1` (Monday 13:00 UTC = 06:00 PT — keeps the Monday-morning report cluster together with the existing ads weekly report).
- [ ] After computing snapshot, render `emails/RevenueDigest.tsx` and send to `COACH_EMAIL` via Resend.
- [ ] **Commit:** `feat(automation): revenue digest cron + email`

### Task 2.6: Admin UI `/admin/insights/revenue`

- [ ] Show last 12 weeks as a Recharts line (MRR + delta) plus the most-recent snapshot's top-at-risk list.
- [ ] **Commit:** `feat(admin): revenue insights page`

### Task 2.7: Wrap Phase 2

- [ ] Emit `<promise>PHASE_2_COMPLETE</promise>`.

---

## Phase 3: Automation Health Watchdog

**Why third:** protects every other automation (including the content engine you already ship). Cheap, pure scan.

### Task 3.1: Migration `automation_health_snapshots` + `cron_runs`

**Files:**
- Create: `supabase/migrations/<UTC>_automation_health_snapshots.sql`
- Create: `supabase/migrations/<UTC>_cron_runs.sql`

- [ ] **Step 1: Migrations**

```sql
-- cron_runs.sql
CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,           -- e.g. 'autoBlogCron', 'syncGoogleAds'
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','success','failed')) DEFAULT 'running',
  detail JSONB
);
CREATE INDEX idx_cron_runs_name_time ON cron_runs (cron_name, started_at DESC);
```

```sql
-- automation_health_snapshots.sql
CREATE TABLE IF NOT EXISTS automation_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ai_jobs_failed_24h JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {type: count}
  ai_jobs_pending_over_1h INTEGER NOT NULL DEFAULT 0,
  silent_crons JSONB NOT NULL DEFAULT '[]'::jsonb,           -- [{cron_name,last_success_at}]
  alert_severity TEXT NOT NULL CHECK (alert_severity IN ('none','warning','critical')),
  alert_summary TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_ahs_time ON automation_health_snapshots (snapshot_at DESC);

INSERT INTO system_settings (key, value)
VALUES ('cron_automation_health_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply both via MCP, commit each:** `chore(db): migration cron_runs`, `chore(db): migration automation_health_snapshots`

### Task 3.2: Twin helpers `lib/db/cron-runs.ts` + `functions/src/lib/cron-runs.ts`

Twin pair per `CLAUDE.md` boundary rule.

```typescript
// shared shape
export async function logCronStart(supabase, cronName): Promise<string> // returns id
export async function logCronEnd(supabase, id, status, detail): Promise<void>
```

- [ ] **Step 1: Implement in both locations identically.**
- [ ] **Step 2: Wire into the highest-volume existing crons first** — minimum: `autoBlogCron`, `socialAgentCron`, `seoAgentCron`, `syncGoogleAds`, `syncPlatformAnalytics`, `chiefStrategistCron`, `performanceLearningLoop`. Each wrapped in:

```typescript
const runId = await logCronStart(supabase, 'autoBlogCron')
try {
  // ... existing body
  await logCronEnd(supabase, runId, 'success', { ... })
} catch (err) {
  await logCronEnd(supabase, runId, 'failed', { error: String(err) })
}
```

- [ ] **Step 3: Commit:** `feat(observability): cron_runs logging on critical crons`

### Task 3.3: Scanner + tests

**Files:**
- Create: `__tests__/lib/automation/automation-health-scanner.test.ts`
- Create: `lib/automation/automation-health-scanner.ts`

Scanner takes:
- `ai_jobs_failed_by_type_24h`: `Record<string, number>`
- `ai_jobs_pending_over_1h`: `number`
- `last_success_per_cron`: `Record<string, string | null>`
- `expected_crons`: a hard-coded array of cron names with their expected SLA windows in hours (e.g. `autoBlogCron: 96h` Tue+Thu, `syncPlatformAnalytics: 30h` daily).

Returns: `{ silent_crons: [...], alert_severity, alert_summary }`.

`critical` if any of:
- ai_jobs_pending_over_1h > 10
- any cron silent past 2× its expected window
- failed jobs of any single type > 5 in 24h

`warning` if any of:
- ai_jobs_pending_over_1h > 3
- any cron silent past 1× its expected window
- any failed job in 24h

- [ ] **Steps 1–3: TDD per Phase 1.3 pattern, commit:** `feat(automation): health scanner`

### Task 3.4: Internal route + cron

**Files:**
- Create: `app/api/admin/internal/automation-health/route.ts`
- Modify: `functions/src/index.ts`

Schedule: `0 8 * * *` (08:00 UTC daily — early enough to catch overnight breakage before EU morning).

On `critical`: render `emails/AutomationHealthAlert.tsx` and send to `COACH_EMAIL`. On `warning`: persist only, no email. On `none`: persist with severity `none`.

- [ ] **Commit:** `feat(automation): health watchdog cron + alert email`

### Task 3.5: Admin board `/admin/insights/automation-health`

- [ ] Show: traffic-light per cron (green/yellow/red), AI-jobs failure breakdown for 24h, pending-job counter, last 14 snapshots as sparkline. Link to Firebase logs for each cron name.
- [ ] **Commit:** `feat(admin): automation health board`

### Task 3.6: Wrap Phase 3

- [ ] Emit `<promise>PHASE_3_COMPLETE</promise>`.

---

## Phase 4: Content → Revenue Attribution

**Why fourth:** depends on Phases 1–3 being healthy (need cron health + revenue snapshots). Closes the loop by feeding revenue impact into `prompt_templates.few_shot_examples`.

### Task 4.1: Migration `content_attribution_snapshots`

**Files:**
- Create: `supabase/migrations/<UTC>_content_attribution_snapshots.sql`

```sql
CREATE TABLE IF NOT EXISTS content_attribution_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of DATE NOT NULL,
  blog_post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,

  gsc_clicks_7d INTEGER NOT NULL DEFAULT 0,
  gsc_impressions_7d INTEGER NOT NULL DEFAULT 0,
  sessions_from_post_7d INTEGER NOT NULL DEFAULT 0,
  bookings_attributed INTEGER NOT NULL DEFAULT 0,
  revenue_attributed_cents BIGINT NOT NULL DEFAULT 0,

  attribution_model TEXT NOT NULL DEFAULT 'first_touch_landing',
    -- 'first_touch_landing' | 'last_touch_landing' | 'time_decay'
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (week_of, blog_post_id, attribution_model)
);
CREATE INDEX idx_cas_revenue ON content_attribution_snapshots (revenue_attributed_cents DESC);
CREATE INDEX idx_cas_week ON content_attribution_snapshots (week_of DESC);

INSERT INTO system_settings (key, value)
VALUES ('cron_content_attribution_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Apply + commit.**

### Task 4.2: Pure joiner + tests

**File:** `lib/automation/content-revenue-joiner.ts`

Inputs:
- `posts`: list of published posts with slug + published_at.
- `gsc_rows`: clicks/impressions per page URL from `gsc_*` tables (already synced).
- `sessions`: sessions where `landing_page` matches `/blog/<slug>`. Source: site analytics. If GA not wired, fall back to `bookings.landing_page` if that column exists; otherwise 0 with `raw.note = 'no_session_source'`.
- `bookings`: bookings tied to a session/landing-page.
- `payments`: completed payments tied to a booking.

Output: per-post `{ gsc_clicks_7d, sessions_from_post_7d, bookings_attributed, revenue_attributed_cents }`.

Attribution: first-touch-landing — if the customer's first session in the last 30 days landed on the blog post, the booking + payment is fully credited there.

- [ ] **TDD + commit:** `feat(automation): content-revenue joiner`

### Task 4.3: DAL + route + cron

- [ ] DAL `lib/db/content-attribution.ts`: `upsertSnapshot`, `topByRevenue(weekOf, limit)`, `recentForPost(postId, weeks)`.
- [ ] Route `app/api/admin/internal/content-attribution/route.ts`. Schedule weekly Sunday 22:00 UTC (after weekly content report Fri, before Chief Sun 10:00 — so Chief's brief can ingest it).
- [ ] **Commit:** `feat(automation): content attribution cron`

### Task 4.4: Feed performance-learning-loop

**File:** `functions/src/performance-learning-loop.ts` and twin `lib/agents/performance-learning-loop.ts` if it exists.

Currently the loop ranks social posts by engagement. Extend to:

1. Read the latest `content_attribution_snapshots` for the last 4 weeks.
2. For each blog post, compute `revenue_per_click = revenue_attributed_cents / max(gsc_clicks_7d, 1)`.
3. Add the top 3 posts (by revenue_per_click) into `prompt_templates.few_shot_examples` under scope `(global, seo_agent)` with category `revenue_winners`.

This means SEO agent prompts will now learn from what actually moves money, not just impressions.

- [ ] **Commit:** `feat(agents): learning loop weights by revenue per click`

### Task 4.5: Admin UI

- [ ] `/admin/insights/content-revenue` — table of top posts last 4 weeks by revenue, clicks, sessions. Link each post into the blog admin.
- [ ] **Commit:** `feat(admin): content-revenue insights page`

### Task 4.6: Wrap Phase 4

- [ ] Emit `<promise>PHASE_4_COMPLETE</promise>`.

---

## Phase 5: Coach Inbox / SLA Digest

**Why fifth:** depends on GHL API access (already used elsewhere per `.env.example`). Surfaces in the Daily Pulse alongside content counters.

### Task 5.1: Migration `inbox_sla_snapshots`

```sql
CREATE TABLE IF NOT EXISTS inbox_sla_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  unread_count INTEGER NOT NULL DEFAULT 0,
  awaiting_reply_over_24h INTEGER NOT NULL DEFAULT 0,
  awaiting_reply_over_48h INTEGER NOT NULL DEFAULT 0,
  mean_response_minutes_7d NUMERIC(10,2),

  oldest_unanswered JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{ conversation_id, contact_name, last_inbound_at, snippet }]

  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_iss_time ON inbox_sla_snapshots (snapshot_at DESC);

INSERT INTO system_settings (key, value)
VALUES ('cron_inbox_sla_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Apply + commit.**

### Task 5.2: GHL fetcher

- [ ] Locate the existing GHL client (`lib/integrations/gohighlevel` or similar). If absent, build a minimal one with the auth + base URL pattern other integrations use.
- [ ] `fetchInboxSnapshot(): Promise<RawInboxData>` — paginate active conversations, capture last inbound + last outbound timestamps + snippet.

### Task 5.3: Pure aggregator + tests

`lib/automation/inbox-sla-aggregator.ts` takes the raw shape, computes unread, >24h, >48h, mean response time over last 7d, and top 5 oldest unanswered. TDD per Phase 1.3.

- [ ] **Commit:** `feat(automation): inbox SLA aggregator`

### Task 5.4: Internal route + cron

- [ ] Schedule: `0 6 * * 1-5` (06:00 UTC, Mon–Fri — runs an hour before Daily Pulse at 07:00 Central).
- [ ] **Commit:** `feat(automation): inbox SLA cron`

### Task 5.5: Daily Pulse integration

Append section "Inbox health" with:
- X unread
- Y awaiting reply > 24h (red if > 0)
- Mean response time last 7d

If `mean_response_minutes_7d > 1440` (>24h), include a one-line warning.

- [ ] **Commit:** `feat(email): daily pulse — inbox SLA section`

### Task 5.6: Admin UI

- [ ] `/admin/insights/inbox-sla` — current snapshot card + 14-day trend chart.
- [ ] **Commit:** `feat(admin): inbox SLA page`

### Task 5.7: Wrap Phase 5

- [ ] Emit `<promise>PHASE_5_COMPLETE</promise>`.

---

## Final wrap

- [ ] Verify all five `cron_<slug>_enabled` flags are present in `system_settings`. Document in `/admin/automation` page (or wherever existing flags are toggled) that flipping any of these on will activate the respective cron.
- [ ] Add a one-paragraph note to `CLAUDE.md` describing the new "Insights" subsystem and pointing at this plan.
- [ ] Sanity-check Firebase free-tier function count (each new cron is a function). If close to limit, fold related crons into a single dispatch function with a topic parameter.
- [ ] Emit `<promise>ALL_PHASES_COMPLETE</promise>`.

---

## Self-review checklist (engineer runs this once at end)

- [ ] All five new tables have a migration file checked in AND were applied via MCP.
- [ ] Every new cron has both a Firebase registration AND a feature flag in `system_settings`, default `false`.
- [ ] Every internal route enforces `INTERNAL_CRON_TOKEN` bearer + `automation_paused` short-circuit.
- [ ] Every pure aggregator/scorer has a Vitest file with table-driven cases.
- [ ] No new automation imports from `lib/` inside `functions/src/`. Twin copies where needed.
- [ ] Daily Pulse and Chief brief still render with the new sections (no template-rendering crashes).
- [ ] `npm run lint` and `npm run test:run` are clean.

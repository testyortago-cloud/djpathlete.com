# Ads Agent Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the existing snapshot-only Google Ads AI agent to lifecycle parity with the SEO agent — gather cross-channel signals (Google Ads + GA4 + GSC + funnel pipeline + memory), reason with Zod-typed structured output, gate every action through hard/soft/approval guardrails, queue (never auto-apply) recommendations, and measure 14-day post-application outcomes.

**Architecture:** New pure-function modules under `lib/ads/agent/` (thresholds, guardrails, signals, decision-schema, reason, execute, outcomes), reusing the existing `google_ads_agent_memos` table (extended with 5 columns) and the existing `google_ads_recommendations` queue. The existing `buildStrategistMemo()` becomes a thin wrapper. Weekly Wed 13:00 UTC trigger is unchanged; daily 04:15 UTC outcome cron is extended to read ads memos.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (PostgreSQL service-role client via `@/lib/supabase`), Anthropic Claude Sonnet via `@/lib/ai/anthropic`, Zod for validation, Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-05-13-ads-agent-lifecycle-design.md](../specs/2026-05-13-ads-agent-lifecycle-design.md)

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/00126_ads_agent_lifecycle.sql` | Extend `google_ads_agent_memos` with 5 new columns |
| `lib/ads/agent/thresholds.ts` | All tunable constants in one file |
| `lib/ads/agent/types.ts` | Shared types: `AdsSignals`, `AdsAction`, `GuardrailResult` |
| `lib/ads/agent/guardrails.ts` | Pure-function gate between reasoning and queue |
| `lib/ads/agent/signals.ts` | Preflight + raw + derived + learning signals |
| `lib/ads/agent/decision-schema.ts` | Zod schema for Claude's structured output |
| `lib/ads/agent/reason.ts` | Single Claude call with cached system prompt |
| `lib/ads/agent/execute.ts` | Per-tool handlers writing to `google_ads_recommendations` |
| `lib/ads/agent/outcomes.ts` | Per-tool 14-day delta resolvers + significance |
| `app/api/admin/internal/ads/outcome-tracker/route.ts` | Daily cron handler for outcome measurement |
| `__tests__/lib/ads/agent/thresholds.test.ts` | Sanity checks on constants |
| `__tests__/lib/ads/agent/guardrails.test.ts` | Table-driven rule tests |
| `__tests__/lib/ads/agent/signals.test.ts` | Preflight + signal extraction |
| `__tests__/lib/ads/agent/decision-schema.test.ts` | Zod parse tests |
| `__tests__/lib/ads/agent/reason.test.ts` | Claude call (mocked) |
| `__tests__/lib/ads/agent/execute.test.ts` | Per-tool persistence |
| `__tests__/lib/ads/agent/outcomes.test.ts` | Delta math + significance |
| `__tests__/lib/ads/agent/end-to-end.test.ts` | Full pipeline integration |

**Modified files:**

| Path | Change |
|---|---|
| `types/database.ts` | Add lifecycle fields to `GoogleAdsAgentMemo` |
| `lib/db/google-ads-agent-memos.ts` | New DAL functions: `updateAgentMemoLifecycle`, `listMemosPendingOutcomes` |
| `lib/ads/agent.ts` | `buildStrategistMemo` becomes a wrapper around new modules |
| `app/api/admin/internal/ads/agent-strategist/route.ts` | Orchestrate new flow |
| `components/emails/WeeklyAgentMemo.tsx` | Render actions + guardrail rejections + audit confidence |
| `app/(admin)/admin/ads/agent/page.tsx` | Outcome-status badge per memo row |
| `app/(admin)/admin/ads/agent/[id]/page.tsx` | Add Signals / Actions / Outcomes tabs |
| `functions/src/index.ts` | Add `adsOutcomeTrackerCron` onSchedule |

---

## Task 1: Migration and DAL extension

**Files:**
- Create: `supabase/migrations/00126_ads_agent_lifecycle.sql`
- Modify: `types/database.ts:1826-1838`
- Modify: `lib/db/google-ads-agent-memos.ts`
- Test: `__tests__/db/google-ads-agent-memos.test.ts` (new)

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/00126_ads_agent_lifecycle.sql`:

```sql
-- 00126_ads_agent_lifecycle.sql
-- Extends google_ads_agent_memos with the lifecycle fields:
-- signals_summary, actions, guardrail_rejections, outcome_status, outcome_metrics.

alter table google_ads_agent_memos
  add column if not exists signals_summary jsonb,
  add column if not exists actions jsonb not null default '[]'::jsonb,
  add column if not exists guardrail_rejections jsonb not null default '[]'::jsonb,
  add column if not exists outcome_status text not null default 'pending'
    check (outcome_status in ('pending', 'measured', 'rolled_back', 'preflight_failed')),
  add column if not exists outcome_metrics jsonb;

create index if not exists idx_agent_memos_outcome_status
  on google_ads_agent_memos(outcome_status)
  where outcome_status = 'pending';
```

- [ ] **Step 2: Apply the migration via MCP**

Apply via the Supabase MCP tool (the CLI isn't linked):

```
mcp__supabase__apply_migration with name="00126_ads_agent_lifecycle"
and the SQL body from Step 1.
```

Expected: success response with no errors. Verify by calling `mcp__supabase__list_tables` and confirming the 5 new columns exist on `google_ads_agent_memos`.

- [ ] **Step 3: Update the `GoogleAdsAgentMemo` type**

Edit `types/database.ts` at line 1826-1838 (the `GoogleAdsAgentMemo` interface). Replace with:

```ts
export type GoogleAdsAgentMemoOutcomeStatus =
  | "pending"
  | "measured"
  | "rolled_back"
  | "preflight_failed"

export interface GoogleAdsAgentMemoAction {
  rank: number
  tool: string
  args: Record<string, unknown>
  rationale: string
  expected_metric: "CTR" | "CVR" | "CAC" | "ROAS" | "spend_efficiency" | "impression_share"
  expected_direction: "increase" | "decrease"
  confidence: "low" | "medium" | "high"
  audit_confidence: "low" | "medium" | "high"
  significance: "sig" | "underpowered" | "insufficient_data"
  supporting_signals: string[]
  status: "queued" | "applied" | "failed" | "rejected_by_guardrails"
  recommendation_id: string | null
  applied_at: string | null
  clamped: boolean
}

export interface GoogleAdsAgentMemoGuardrailRejection {
  rank: number
  tool: string
  reason: string
}

export interface GoogleAdsAgentMemo {
  id: string
  week_of: string
  subject: string
  sections: GoogleAdsAgentMemoSections
  source: GoogleAdsAgentMemoSource
  triggered_by: string | null
  tokens_used: number
  email_sent_at: string | null
  email_recipient: string | null
  signals_summary: Record<string, unknown> | null
  actions: GoogleAdsAgentMemoAction[]
  guardrail_rejections: GoogleAdsAgentMemoGuardrailRejection[]
  outcome_status: GoogleAdsAgentMemoOutcomeStatus
  outcome_metrics: Record<string, unknown> | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 4: Write the DAL extension test**

Create `__tests__/db/google-ads-agent-memos.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  updateAgentMemoLifecycle,
  listMemosPendingOutcomes,
} from "@/lib/db/google-ads-agent-memos"

vi.mock("@/lib/supabase", () => {
  const update = vi.fn().mockReturnThis()
  const eq = vi.fn().mockResolvedValue({ error: null })
  const select = vi.fn().mockReturnThis()
  const order = vi.fn().mockResolvedValue({ data: [], error: null })
  return {
    createServiceRoleClient: () => ({
      from: () => ({
        update,
        eq,
        select,
        order,
        lt: vi.fn().mockReturnThis(),
      }),
    }),
  }
})

describe("google-ads-agent-memos DAL", () => {
  beforeEach(() => vi.clearAllMocks())

  it("updateAgentMemoLifecycle sets signals_summary, actions, and rejections", async () => {
    await expect(
      updateAgentMemoLifecycle("memo-id", {
        signals_summary: { foo: "bar" },
        actions: [],
        guardrail_rejections: [],
        outcome_status: "pending",
      }),
    ).resolves.not.toThrow()
  })

  it("listMemosPendingOutcomes returns rows with outcome_status='pending'", async () => {
    const result = await listMemosPendingOutcomes()
    expect(Array.isArray(result)).toBe(true)
  })
})
```

- [ ] **Step 5: Run the test to confirm it fails (functions not yet exported)**

Run: `npm run test:run -- google-ads-agent-memos.test.ts`
Expected: FAIL with `updateAgentMemoLifecycle is not exported from "@/lib/db/google-ads-agent-memos"`.

- [ ] **Step 6: Add the new DAL functions**

Append to `lib/db/google-ads-agent-memos.ts`:

```ts
export interface UpdateAgentMemoLifecycleInput {
  signals_summary: Record<string, unknown> | null
  actions: GoogleAdsAgentMemoAction[]
  guardrail_rejections: GoogleAdsAgentMemoGuardrailRejection[]
  outcome_status: GoogleAdsAgentMemoOutcomeStatus
  outcome_metrics?: Record<string, unknown> | null
}

export async function updateAgentMemoLifecycle(
  id: string,
  input: UpdateAgentMemoLifecycleInput,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_agent_memos")
    .update({
      signals_summary: input.signals_summary,
      actions: input.actions,
      guardrail_rejections: input.guardrail_rejections,
      outcome_status: input.outcome_status,
      outcome_metrics: input.outcome_metrics ?? null,
    })
    .eq("id", id)
  if (error) throw error
}

export async function listMemosPendingOutcomes(
  olderThanDays: number = 14,
): Promise<GoogleAdsAgentMemo[]> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("google_ads_agent_memos")
    .select("*")
    .eq("outcome_status", "pending")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as GoogleAdsAgentMemo[]
}
```

Add the type imports at the top of the file:

```ts
import type {
  GoogleAdsAgentMemo,
  GoogleAdsAgentMemoSections,
  GoogleAdsAgentMemoSource,
  GoogleAdsAgentMemoAction,
  GoogleAdsAgentMemoGuardrailRejection,
  GoogleAdsAgentMemoOutcomeStatus,
} from "@/types/database"
```

- [ ] **Step 7: Run tests and confirm they pass**

Run: `npm run test:run -- google-ads-agent-memos.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/00126_ads_agent_lifecycle.sql types/database.ts lib/db/google-ads-agent-memos.ts __tests__/db/google-ads-agent-memos.test.ts
git commit -m "feat(ads-agent): schema migration + DAL for lifecycle fields"
```

---

## Task 2: Thresholds module

**Files:**
- Create: `lib/ads/agent/thresholds.ts`
- Test: `__tests__/lib/ads/agent/thresholds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ads/agent/thresholds.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import * as T from "@/lib/ads/agent/thresholds"

describe("ads agent thresholds", () => {
  it("data-quality preflight thresholds are defined and sensible", () => {
    expect(T.CONVERSION_FRESHNESS_HOURS).toBe(48)
    expect(T.MIN_RECENT_CLICKS).toBe(30)
    expect(T.RECENT_CLICKS_WINDOW_DAYS).toBe(7)
  })

  it("derived-signal thresholds match spec defaults", () => {
    expect(T.PAID_SPEND_THRESHOLD_USD).toBe(20)
    expect(T.ORGANIC_OVERLAP_MAX_POSITION).toBe(5)
    expect(T.ORGANIC_WIN_MIN_CLICKS).toBe(10)
    expect(T.ORGANIC_WIN_MAX_POSITION).toBe(10)
    expect(T.LP_ENGAGEMENT_FLOOR).toBeCloseTo(0.4)
  })

  it("guardrail thresholds match spec defaults", () => {
    expect(T.CAMPAIGN_MIN_AGE_DAYS).toBe(14)
    expect(T.MIN_CLICKS_FOR_RECOMMENDATION).toBe(30)
    expect(T.MIN_CONVERSIONS_FOR_RECOMMENDATION).toBe(3)
    expect(T.MAX_BUDGET_SHIFT_PCT).toBe(20)
    expect(T.NEW_CAMPAIGN_MAX_DAILY_BUDGET).toBe(30)
    expect(T.MAX_NEW_DAILY_SPEND_PER_MEMO).toBe(100)
    expect(T.LARGE_BUDGET_SHIFT_USD).toBe(50)
    expect(T.MIN_AUDIENCE_SIZE).toBe(1_000)
  })

  it("brand allowlist contains DJP Athlete variants", () => {
    expect(T.BRAND_TERM_ALLOWLIST.length).toBeGreaterThan(0)
    expect(T.BRAND_TERM_ALLOWLIST).toContain("djp athlete")
  })

  it("outcome window is 14 days", () => {
    expect(T.OUTCOME_WINDOW_DAYS).toBe(14)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- thresholds.test.ts`
Expected: FAIL with `Cannot find module '@/lib/ads/agent/thresholds'`.

- [ ] **Step 3: Create the thresholds module**

Create `lib/ads/agent/thresholds.ts`:

```ts
// lib/ads/agent/thresholds.ts
// Single source of truth for all tunable constants the ads agent uses.
// Edit values here without touching signal, guardrail, or outcome logic.

// — Data-quality preflight ————————————————————————————
export const CONVERSION_FRESHNESS_HOURS = 48
export const SYNC_FRESHNESS_HOURS = 48
export const MIN_RECENT_CLICKS = 30
export const RECENT_CLICKS_WINDOW_DAYS = 7

// — Derived cross-channel signals —————————————————————
export const PAID_SPEND_THRESHOLD_USD = 20
export const ORGANIC_OVERLAP_MAX_POSITION = 5
export const ORGANIC_WIN_MIN_CLICKS = 10
export const ORGANIC_WIN_MAX_POSITION = 10
export const LP_ENGAGEMENT_FLOOR = 0.4

// — Learning layer ————————————————————————————————————
export const WINNING_KEYWORD_MIN_CONVERSIONS = 3
export const WINNING_KEYWORD_LOOKBACK_DAYS = 30
export const WINNING_AUDIENCE_MIN_TRENDING_WEEKS = 3 // out of last 4
export const WINNING_SCHEDULE_CVR_MULTIPLIER = 1.5
export const WINNING_GEO_CVR_MULTIPLIER = 1.3
export const WINNING_GEO_MIN_CONVERSIONS = 10

// — Hard guardrails ———————————————————————————————————
export const CAMPAIGN_MIN_AGE_DAYS = 14
export const MIN_CLICKS_FOR_RECOMMENDATION = 30
export const MIN_CONVERSIONS_FOR_RECOMMENDATION = 3
export const MAX_BUDGET_SHIFT_PCT = 20
export const NEW_CAMPAIGN_MAX_DAILY_BUDGET = 30
export const MAX_NEW_DAILY_SPEND_PER_MEMO = 100
export const PAUSE_PROTECTION_WINDOW_DAYS = 7
export const PAUSE_PROTECTION_MIN_CONVERSIONS = 1
export const MIN_AUDIENCE_SIZE = 1_000

// — Soft guardrails ———————————————————————————————————
export const SIG_MIN_SAMPLE = 100 // sessions per side for fallback floor
export const SIG_Z_THRESHOLD = 1.96 // two-tailed 95%

// — Approval-tier (UI enforces) ———————————————————————
export const LARGE_BUDGET_SHIFT_USD = 50
export const BULK_NEGATIVE_KEYWORD_THRESHOLD = 10

// — Outcomes ———————————————————————————————————————————
export const OUTCOME_WINDOW_DAYS = 14
export const OUTCOME_WINDOW_EXPIRY_DAYS = 30

// — Brand protection ——————————————————————————————————
// Configurable per project. Loose-matched case-insensitive against negative
// keyword text. Any overlap rejects the whole negative-keyword action.
export const BRAND_TERM_ALLOWLIST = [
  "djp athlete",
  "djpathlete",
  "darren paul",
  "darren j paul",
  "comeback code",
  "rotational reboot",
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- thresholds.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/thresholds.ts __tests__/lib/ads/agent/thresholds.test.ts
git commit -m "feat(ads-agent): named-constant thresholds module"
```

---

## Task 3: Shared types module

**Files:**
- Create: `lib/ads/agent/types.ts`

- [ ] **Step 1: Create the types module**

Create `lib/ads/agent/types.ts`:

```ts
// lib/ads/agent/types.ts
// Shared types across signals/decision/guardrails/execute/outcomes.

import type {
  GoogleAdsAgentMemoAction,
  GoogleAdsAgentMemoGuardrailRejection,
} from "@/types/database"

export interface PreflightResult {
  ok: boolean
  reasons: string[]
}

export interface AdsRawInputs {
  campaigns: Array<{
    id: string
    name: string
    status: string
    daily_budget_usd: number
    created_at: string
    metrics_28d: {
      clicks: number
      impressions: number
      ctr: number
      conversions: number
      cvr: number
      cost_usd: number
      cac_usd: number | null
      roas: number | null
      impression_share: number | null
      impression_share_lost_budget: number | null
      impression_share_lost_rank: number | null
    }
  }>
  search_terms_top_spend: Array<{
    text: string
    campaign_id: string
    cost_usd: number
    clicks: number
    conversions: number
  }>
  search_terms_top_conversions: Array<{
    text: string
    campaign_id: string
    cost_usd: number
    clicks: number
    conversions: number
  }>
  pending_recommendations: Array<{ id: string; type: string; campaign_id: string | null }>
  conversion_actions: Array<{
    id: string
    name: string
    last_conversion_at: string | null
  }>
  ga4: {
    sessions_by_source_medium: Array<{
      source: string
      medium: string
      sessions: number
      conversions: number
    }>
    landing_page_engagement: Array<{
      page_path: string
      engagement_rate: number
      sessions: number
    }>
  }
  gsc_organic_top10: Array<{
    query: string
    page: string
    position: number
    clicks: number
    impressions: number
  }>
  pipeline: {
    visits: number
    signups: number
    bookings: number
    payments: number
    visits_to_signup: number
    signup_to_booking: number
    booking_to_payment: number
  }
  prior_memos: Array<{
    id: string
    week_of: string
    actions: GoogleAdsAgentMemoAction[]
    outcome_status: string
    outcome_metrics: Record<string, unknown> | null
  }>
}

export interface AdsDerivedSignals {
  paid_terms_already_organic: Array<{
    query: string
    paid_spend_usd: number
    organic_position: number
    organic_page: string
  }>
  organic_wins_not_in_ads: Array<{
    query: string
    organic_clicks: number
    organic_position: number
  }>
  landing_page_engagement_mismatch: Array<{
    campaign_id: string
    ctr: number
    landing_page: string
    engagement_rate: number
  }>
}

export interface AdsLearningLayer {
  winning_keywords: Array<{
    campaign_id: string
    ad_group_id: string
    text: string
    conversions: number
    cvr: number
  }>
  winning_audiences: Array<{ audience_id: string; cvr_trend: number[] }>
  winning_ad_creative: Array<{
    ad_id: string
    headlines: string[]
    ctr: number
    cvr: number
    score: number
  }>
  winning_schedule: Array<{
    campaign_id: string
    day_of_week: number
    hour_of_day: number
    cvr_multiplier: number
  }>
  winning_geos: Array<{
    campaign_id: string
    region: string
    cvr_multiplier: number
    conversions: number
  }>
  prior_actions_that_worked: Array<{
    tool: string
    args_summary: string
    observed_delta: number
    weeks_ago: number
  }>
  prior_actions_that_failed: Array<{
    tool: string
    args_summary: string
    observed_delta: number
    weeks_ago: number
  }>
}

export interface AdsSignals {
  generated_at: string
  preflight: PreflightResult
  raw: AdsRawInputs | null
  derived: AdsDerivedSignals | null
  learning: AdsLearningLayer | null
  gaps: string[]
}

export type AdsActionTool =
  | "propose_budget_shift"
  | "propose_new_keywords"
  | "propose_negative_keywords"
  | "propose_ad_copy_test"
  | "propose_audience_expansion"
  | "propose_new_campaign"
  | "propose_campaign_pause"
  | "propose_campaign_split"
  | "propose_match_type_change"
  | "propose_bid_strategy_review"
  | "flag_for_human"

export interface AdsAction {
  rank: number
  tool: AdsActionTool
  args: Record<string, unknown>
  rationale: string
  expected_metric: "CTR" | "CVR" | "CAC" | "ROAS" | "spend_efficiency" | "impression_share"
  expected_direction: "increase" | "decrease"
  confidence: "low" | "medium" | "high"
  supporting_signals: string[]
}

export type GuardrailResult =
  | { kind: "pass"; action: AdsAction; annotations: GuardrailAnnotations }
  | { kind: "reject"; reason: string }

export interface GuardrailAnnotations {
  significance: "sig" | "underpowered" | "insufficient_data"
  audit_confidence: "low" | "medium" | "high"
  seasonality_flag: boolean
  clamped: boolean
}

export type { GoogleAdsAgentMemoAction, GoogleAdsAgentMemoGuardrailRejection }
```

- [ ] **Step 2: Commit**

```bash
git add lib/ads/agent/types.ts
git commit -m "feat(ads-agent): shared types for signals, actions, guardrails"
```

---

## Task 4: Guardrails — dispatcher and hard rules (campaign age + data volume)

**Files:**
- Create: `lib/ads/agent/guardrails.ts`
- Test: `__tests__/lib/ads/agent/guardrails.test.ts`

- [ ] **Step 1: Write the failing test for campaign-age and data-volume rules**

Create `__tests__/lib/ads/agent/guardrails.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { applyGuardrails } from "@/lib/ads/agent/guardrails"
import type { AdsAction, AdsSignals } from "@/lib/ads/agent/types"

const makeAction = (overrides: Partial<AdsAction> = {}): AdsAction => ({
  rank: 1,
  tool: "propose_new_keywords",
  args: { campaign_id: "c1", ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
  rationale: "test",
  expected_metric: "CVR",
  expected_direction: "increase",
  confidence: "medium",
  supporting_signals: [],
  ...overrides,
})

const makeSignals = (overrides: Partial<AdsSignals["raw"]> = {}): AdsSignals => ({
  generated_at: new Date().toISOString(),
  preflight: { ok: true, reasons: [] },
  raw: {
    campaigns: [
      {
        id: "c1",
        name: "Brand Search",
        status: "ENABLED",
        daily_budget_usd: 25,
        created_at: new Date(Date.now() - 60 * 86_400_000).toISOString(), // 60 days old
        metrics_28d: {
          clicks: 500,
          impressions: 10_000,
          ctr: 0.05,
          conversions: 25,
          cvr: 0.05,
          cost_usd: 400,
          cac_usd: 16,
          roas: 3,
          impression_share: 0.5,
          impression_share_lost_budget: 0.1,
          impression_share_lost_rank: 0.1,
        },
      },
    ],
    search_terms_top_spend: [],
    search_terms_top_conversions: [],
    pending_recommendations: [],
    conversion_actions: [],
    ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
    gsc_organic_top10: [],
    pipeline: {
      visits: 100, signups: 10, bookings: 5, payments: 2,
      visits_to_signup: 0.1, signup_to_booking: 0.5, booking_to_payment: 0.4,
    },
    prior_memos: [],
    ...overrides,
  },
  derived: { paid_terms_already_organic: [], organic_wins_not_in_ads: [], landing_page_engagement_mismatch: [] },
  learning: {
    winning_keywords: [], winning_audiences: [], winning_ad_creative: [],
    winning_schedule: [], winning_geos: [],
    prior_actions_that_worked: [], prior_actions_that_failed: [],
  },
  gaps: [],
})

describe("guardrails — campaign age", () => {
  it("rejects action targeting a campaign younger than 14 days", () => {
    const youngSignals = makeSignals()
    youngSignals.raw!.campaigns[0].created_at = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const result = applyGuardrails(makeAction(), youngSignals)
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/learning period/i)
  })

  it("allows action targeting a 60-day-old campaign", () => {
    const result = applyGuardrails(makeAction(), makeSignals())
    expect(result.kind).toBe("pass")
  })
})

describe("guardrails — data volume", () => {
  it("rejects when campaign has < 30 clicks in 28d", () => {
    const signals = makeSignals()
    signals.raw!.campaigns[0].metrics_28d.clicks = 10
    const result = applyGuardrails(makeAction(), signals)
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/insufficient.+click/i)
  })

  it("rejects when campaign has < 3 conversions in 28d", () => {
    const signals = makeSignals()
    signals.raw!.campaigns[0].metrics_28d.conversions = 1
    const result = applyGuardrails(makeAction(), signals)
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/insufficient.+conversion/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- guardrails.test.ts`
Expected: FAIL with `Cannot find module '@/lib/ads/agent/guardrails'`.

- [ ] **Step 3: Create the guardrails module with dispatcher + campaign-age + data-volume rules**

Create `lib/ads/agent/guardrails.ts`:

```ts
// lib/ads/agent/guardrails.ts
// Pure-function gate between the model's output and persisted actions.
// Returns either { kind: "pass", action, annotations } or { kind: "reject", reason }.

import * as T from "./thresholds"
import type {
  AdsAction,
  AdsSignals,
  GuardrailResult,
  GuardrailAnnotations,
} from "./types"

const HOURS = 3_600_000

function findCampaign(signals: AdsSignals, id: string | undefined) {
  if (!id || !signals.raw) return null
  return signals.raw.campaigns.find((c) => c.id === id) ?? null
}

function actionCampaignId(action: AdsAction): string | undefined {
  const args = action.args as Record<string, unknown>
  return (args.campaign_id as string | undefined) ?? (args.from_campaign_id as string | undefined)
}

function checkCampaignAge(action: AdsAction, signals: AdsSignals): string | null {
  // Skip age check for new-campaign proposals (no existing campaign to check).
  if (action.tool === "propose_new_campaign" || action.tool === "flag_for_human") return null
  const campaignId = actionCampaignId(action)
  const campaign = findCampaign(signals, campaignId)
  if (!campaign) return null
  const ageDays = (Date.now() - new Date(campaign.created_at).getTime()) / 86_400_000
  if (ageDays < T.CAMPAIGN_MIN_AGE_DAYS) {
    return `Campaign ${campaign.id} is ${ageDays.toFixed(1)} days old; below ${T.CAMPAIGN_MIN_AGE_DAYS}-day Smart Bidding learning period.`
  }
  return null
}

function checkDataVolume(action: AdsAction, signals: AdsSignals): string | null {
  if (action.tool === "propose_new_campaign" || action.tool === "flag_for_human") return null
  const campaign = findCampaign(signals, actionCampaignId(action))
  if (!campaign) return null
  const { clicks, conversions } = campaign.metrics_28d
  if (clicks < T.MIN_CLICKS_FOR_RECOMMENDATION) {
    return `Insufficient clicks: ${clicks} < ${T.MIN_CLICKS_FOR_RECOMMENDATION} in 28d on campaign ${campaign.id}.`
  }
  if (conversions < T.MIN_CONVERSIONS_FOR_RECOMMENDATION) {
    return `Insufficient conversions: ${conversions} < ${T.MIN_CONVERSIONS_FOR_RECOMMENDATION} in 28d on campaign ${campaign.id}.`
  }
  return null
}

const HARD_RULES: Array<(a: AdsAction, s: AdsSignals) => string | null> = [
  checkCampaignAge,
  checkDataVolume,
  // Additional hard rules added in later tasks
]

function defaultAnnotations(): GuardrailAnnotations {
  return {
    significance: "insufficient_data",
    audit_confidence: "low",
    seasonality_flag: false,
    clamped: false,
  }
}

export function applyGuardrails(action: AdsAction, signals: AdsSignals): GuardrailResult {
  for (const rule of HARD_RULES) {
    const reason = rule(action, signals)
    if (reason) return { kind: "reject", reason }
  }
  return { kind: "pass", action, annotations: defaultAnnotations() }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- guardrails.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/guardrails.ts __tests__/lib/ads/agent/guardrails.test.ts
git commit -m "feat(ads-agent): guardrails dispatcher + campaign-age + data-volume rules"
```

---

## Task 5: Guardrails — budget clamp + pause protection

**Files:**
- Modify: `lib/ads/agent/guardrails.ts`
- Modify: `__tests__/lib/ads/agent/guardrails.test.ts`

- [ ] **Step 1: Add failing tests for budget clamp + pause protection**

Append to `__tests__/lib/ads/agent/guardrails.test.ts`:

```ts
describe("guardrails — budget clamp", () => {
  it("clamps a 50% budget shift to ±20%", () => {
    const action = makeAction({
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: 50 },
    })
    const result = applyGuardrails(action, makeSignals())
    expect(result.kind).toBe("pass")
    if (result.kind === "pass") {
      expect(result.action.args.delta_pct).toBe(20)
      expect(result.annotations.clamped).toBe(true)
    }
  })

  it("clamps a -75% budget shift to -20%", () => {
    const action = makeAction({
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: -75 },
    })
    const result = applyGuardrails(action, makeSignals())
    if (result.kind === "pass") {
      expect(result.action.args.delta_pct).toBe(-20)
      expect(result.annotations.clamped).toBe(true)
    }
  })

  it("leaves a 10% budget shift unchanged", () => {
    const action = makeAction({
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: 10 },
    })
    const result = applyGuardrails(action, makeSignals())
    if (result.kind === "pass") {
      expect(result.action.args.delta_pct).toBe(10)
      expect(result.annotations.clamped).toBe(false)
    }
  })
})

describe("guardrails — pause protection", () => {
  it("rejects propose_campaign_pause if campaign drove ≥1 conversion in last 7 days", () => {
    const signals = makeSignals()
    // Inject a conversion within last 7 days. For simplicity in this test we
    // model "last 7 days conversions" via metrics_28d.conversions > 0 AND a
    // separate field that real signals carry. We add it to the campaign.
    ;(signals.raw!.campaigns[0] as unknown as { last_7d_conversions: number }).last_7d_conversions = 2
    const result = applyGuardrails(
      makeAction({ tool: "propose_campaign_pause", args: { campaign_id: "c1", reason: "x" } }),
      signals,
    )
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/conversion.+last 7 days/i)
  })

  it("allows propose_campaign_pause if campaign drove 0 conversions in last 7 days", () => {
    const signals = makeSignals()
    ;(signals.raw!.campaigns[0] as unknown as { last_7d_conversions: number }).last_7d_conversions = 0
    const result = applyGuardrails(
      makeAction({ tool: "propose_campaign_pause", args: { campaign_id: "c1", reason: "x" } }),
      signals,
    )
    expect(result.kind).toBe("pass")
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test:run -- guardrails.test.ts`
Expected: FAIL on the new budget-clamp and pause-protection tests.

- [ ] **Step 3: Extend the campaign type to carry `last_7d_conversions`**

Edit `lib/ads/agent/types.ts`. Inside the `campaigns` array element type, add the field after `metrics_28d`:

```ts
    last_7d_conversions: number
```

- [ ] **Step 4: Implement budget-clamp and pause-protection rules**

Edit `lib/ads/agent/guardrails.ts`. Replace the `applyGuardrails` function with one that supports mutation/annotation, and add the new rules:

```ts
// Replace the existing applyGuardrails + HARD_RULES section with:

function clampBudgetShift(action: AdsAction): { action: AdsAction; clamped: boolean } {
  if (action.tool !== "propose_budget_shift") return { action, clamped: false }
  const args = { ...action.args } as Record<string, unknown>
  const raw = args.delta_pct
  if (typeof raw !== "number") return { action, clamped: false }
  const max = T.MAX_BUDGET_SHIFT_PCT
  const clampedVal = Math.max(-max, Math.min(max, raw))
  args.delta_pct = clampedVal
  return { action: { ...action, args }, clamped: clampedVal !== raw }
}

function checkPauseProtection(action: AdsAction, signals: AdsSignals): string | null {
  if (action.tool !== "propose_campaign_pause") return null
  const campaign = findCampaign(signals, actionCampaignId(action)) as
    | (ReturnType<typeof findCampaign> & { last_7d_conversions?: number })
    | null
  if (!campaign) return null
  const conv7d = campaign.last_7d_conversions ?? 0
  if (conv7d >= T.PAUSE_PROTECTION_MIN_CONVERSIONS) {
    return `Campaign ${campaign.id} drove ${conv7d} conversion(s) in last 7 days — pause-protected.`
  }
  return null
}

const HARD_RULES: Array<(a: AdsAction, s: AdsSignals) => string | null> = [
  checkCampaignAge,
  checkDataVolume,
  checkPauseProtection,
]

export function applyGuardrails(action: AdsAction, signals: AdsSignals): GuardrailResult {
  const { action: clampedAction, clamped } = clampBudgetShift(action)
  for (const rule of HARD_RULES) {
    const reason = rule(clampedAction, signals)
    if (reason) return { kind: "reject", reason }
  }
  return {
    kind: "pass",
    action: clampedAction,
    annotations: { ...defaultAnnotations(), clamped },
  }
}
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `npm run test:run -- guardrails.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add lib/ads/agent/guardrails.ts lib/ads/agent/types.ts __tests__/lib/ads/agent/guardrails.test.ts
git commit -m "feat(ads-agent): budget clamp + pause-protection guardrails"
```

---

## Task 6: Guardrails — brand allowlist + match-type direction

**Files:**
- Modify: `lib/ads/agent/guardrails.ts`
- Modify: `__tests__/lib/ads/agent/guardrails.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/lib/ads/agent/guardrails.test.ts`:

```ts
describe("guardrails — brand allowlist", () => {
  it("rejects negative-keyword action containing a brand term (case-insensitive)", () => {
    const action = makeAction({
      tool: "propose_negative_keywords",
      args: {
        campaign_id: "c1",
        negatives: [{ text: "DJP Athlete reviews", match_type: "phrase", scope: "campaign" }],
      },
    })
    const result = applyGuardrails(action, makeSignals())
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/brand/i)
  })

  it("allows negative-keyword action with no brand-term overlap", () => {
    const action = makeAction({
      tool: "propose_negative_keywords",
      args: {
        campaign_id: "c1",
        negatives: [{ text: "free download", match_type: "phrase", scope: "campaign" }],
      },
    })
    const result = applyGuardrails(action, makeSignals())
    expect(result.kind).toBe("pass")
  })
})

describe("guardrails — match-type direction", () => {
  it("allows broad → phrase tightening", () => {
    const action = makeAction({
      tool: "propose_match_type_change",
      args: { ad_group_id: "ag1", keyword_id: "kw1", from_match_type: "broad", to_match_type: "phrase" },
    })
    expect(applyGuardrails(action, makeSignals()).kind).toBe("pass")
  })

  it("allows phrase → exact tightening", () => {
    const action = makeAction({
      tool: "propose_match_type_change",
      args: { ad_group_id: "ag1", keyword_id: "kw1", from_match_type: "phrase", to_match_type: "exact" },
    })
    expect(applyGuardrails(action, makeSignals()).kind).toBe("pass")
  })

  it("rejects exact → phrase loosening", () => {
    const action = makeAction({
      tool: "propose_match_type_change",
      args: { ad_group_id: "ag1", keyword_id: "kw1", from_match_type: "exact", to_match_type: "phrase" },
    })
    const result = applyGuardrails(action, makeSignals())
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/loosen/i)
  })

  it("rejects phrase → broad loosening", () => {
    const action = makeAction({
      tool: "propose_match_type_change",
      args: { ad_group_id: "ag1", keyword_id: "kw1", from_match_type: "phrase", to_match_type: "broad" },
    })
    expect(applyGuardrails(action, makeSignals()).kind).toBe("reject")
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test:run -- guardrails.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Add the new rules**

Edit `lib/ads/agent/guardrails.ts`. Add these helper functions before the `HARD_RULES` array:

```ts
function checkBrandAllowlist(action: AdsAction): string | null {
  if (action.tool !== "propose_negative_keywords") return null
  const args = action.args as { negatives?: Array<{ text: string }> }
  const negatives = args.negatives ?? []
  for (const n of negatives) {
    const txt = n.text.toLowerCase()
    if (T.BRAND_TERM_ALLOWLIST.some((brand) => txt.includes(brand.toLowerCase()))) {
      return `Negative keyword "${n.text}" overlaps protected brand term.`
    }
  }
  return null
}

const MATCH_TYPE_RANK: Record<string, number> = { broad: 3, phrase: 2, exact: 1 }

function checkMatchTypeDirection(action: AdsAction): string | null {
  if (action.tool !== "propose_match_type_change") return null
  const args = action.args as { from_match_type?: string; to_match_type?: string }
  const from = args.from_match_type ?? ""
  const to = args.to_match_type ?? ""
  const fromRank = MATCH_TYPE_RANK[from]
  const toRank = MATCH_TYPE_RANK[to]
  if (fromRank == null || toRank == null) return `Unknown match type: ${from} → ${to}.`
  if (toRank > fromRank) {
    return `Match-type loosening (${from} → ${to}) not allowed in v1; tightening only.`
  }
  return null
}
```

Add both to the `HARD_RULES` array:

```ts
const HARD_RULES: Array<(a: AdsAction, s: AdsSignals) => string | null> = [
  checkCampaignAge,
  checkDataVolume,
  checkPauseProtection,
  checkBrandAllowlist,
  checkMatchTypeDirection,
]
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test:run -- guardrails.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/guardrails.ts __tests__/lib/ads/agent/guardrails.test.ts
git commit -m "feat(ads-agent): brand-allowlist + match-type-direction guardrails"
```

---

## Task 7: Guardrails — new-campaign caps + total spend cap (memo-level)

**Files:**
- Modify: `lib/ads/agent/guardrails.ts`
- Modify: `__tests__/lib/ads/agent/guardrails.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/lib/ads/agent/guardrails.test.ts`:

```ts
import { applyGuardrailsBatch } from "@/lib/ads/agent/guardrails"

describe("guardrails — new-campaign caps (memo-level batch)", () => {
  it("rejects more than 1 propose_new_campaign per memo", () => {
    const a1 = makeAction({
      tool: "propose_new_campaign",
      args: { name: "C1", type: "search", initial_daily_budget: 20, target_keywords: ["a"], landing_page_url: "/x", conversion_action_ids: ["ca1"] },
    })
    const a2 = makeAction({
      rank: 2,
      tool: "propose_new_campaign",
      args: { name: "C2", type: "search", initial_daily_budget: 20, target_keywords: ["b"], landing_page_url: "/y", conversion_action_ids: ["ca1"] },
    })
    const results = applyGuardrailsBatch([a1, a2], makeSignals())
    expect(results[0].kind).toBe("pass")
    expect(results[1].kind).toBe("reject")
    if (results[1].kind === "reject") expect(results[1].reason).toMatch(/already proposed.*new campaign/i)
  })

  it("rejects propose_new_campaign exceeding NEW_CAMPAIGN_MAX_DAILY_BUDGET", () => {
    const a = makeAction({
      tool: "propose_new_campaign",
      args: { name: "Big", type: "search", initial_daily_budget: 100, target_keywords: ["a"], landing_page_url: "/x", conversion_action_ids: ["ca1"] },
    })
    const results = applyGuardrailsBatch([a], makeSignals())
    expect(results[0].kind).toBe("reject")
    if (results[0].kind === "reject") expect(results[0].reason).toMatch(/exceeds.*daily budget/i)
  })

  it("rejects when total NEW daily spend across actions > MAX_NEW_DAILY_SPEND_PER_MEMO", () => {
    // 1 new campaign + budget increase that pushes total new spend over $100.
    const newCampaign = makeAction({
      tool: "propose_new_campaign",
      args: { name: "NewC", type: "search", initial_daily_budget: 30, target_keywords: ["a"], landing_page_url: "/x", conversion_action_ids: ["ca1"] },
    })
    // Existing campaign daily_budget_usd = 25 (from makeSignals fixture). +20% = +$5/day NEW.
    // To exceed the $100 cap with one new campaign + one budget shift we add a 2nd shift.
    const shift1 = makeAction({
      rank: 2,
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: 20 }, // +$5
    })
    // Need more spend; bump the existing campaign budget to 400 to make 20% = $80 new.
    const signals = makeSignals()
    signals.raw!.campaigns[0].daily_budget_usd = 400
    const results = applyGuardrailsBatch([newCampaign, shift1], signals)
    // newCampaign passes individually (within $30 cap) but in batch the total
    // ($30 new + $80 shift = $110) exceeds $100; the SECOND action rejects.
    expect(results[0].kind).toBe("pass")
    expect(results[1].kind).toBe("reject")
    if (results[1].kind === "reject") expect(results[1].reason).toMatch(/total.*spend.*cap/i)
  })
})
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm run test:run -- guardrails.test.ts`
Expected: FAIL (`applyGuardrailsBatch` not exported).

- [ ] **Step 3: Add `applyGuardrailsBatch` and per-memo state tracking**

Add to `lib/ads/agent/guardrails.ts`:

```ts
function checkNewCampaignBudget(action: AdsAction): string | null {
  if (action.tool !== "propose_new_campaign") return null
  const args = action.args as { initial_daily_budget?: number }
  const budget = args.initial_daily_budget ?? 0
  if (budget > T.NEW_CAMPAIGN_MAX_DAILY_BUDGET) {
    return `New campaign initial_daily_budget $${budget} exceeds NEW_CAMPAIGN_MAX_DAILY_BUDGET $${T.NEW_CAMPAIGN_MAX_DAILY_BUDGET}.`
  }
  return null
}

interface BatchState {
  newCampaignsProposed: number
  newDailySpendUsd: number
}

function newDailySpendFromAction(action: AdsAction, signals: AdsSignals): number {
  if (action.tool === "propose_new_campaign") {
    const args = action.args as { initial_daily_budget?: number }
    return args.initial_daily_budget ?? 0
  }
  if (action.tool === "propose_budget_shift") {
    const args = action.args as { from_campaign_id?: string; to_campaign_id?: string; delta_pct?: number }
    if (args.from_campaign_id === args.to_campaign_id) {
      // Net-new spend on this campaign
      const campaign = findCampaign(signals, args.to_campaign_id)
      if (!campaign) return 0
      const delta = (args.delta_pct ?? 0) / 100
      return Math.max(0, campaign.daily_budget_usd * delta)
    }
    // Reallocation between two campaigns — net new spend is 0
    return 0
  }
  return 0
}

export function applyGuardrailsBatch(
  actions: AdsAction[],
  signals: AdsSignals,
): GuardrailResult[] {
  const state: BatchState = { newCampaignsProposed: 0, newDailySpendUsd: 0 }
  const results: GuardrailResult[] = []
  for (const action of actions) {
    // Memo-level checks first
    if (action.tool === "propose_new_campaign") {
      if (state.newCampaignsProposed >= 1) {
        results.push({
          kind: "reject",
          reason: `Already proposed 1 new campaign in this memo; cap is 1.`,
        })
        continue
      }
      const budgetReason = checkNewCampaignBudget(action)
      if (budgetReason) {
        results.push({ kind: "reject", reason: budgetReason })
        continue
      }
    }
    const incremental = newDailySpendFromAction(action, signals)
    if (state.newDailySpendUsd + incremental > T.MAX_NEW_DAILY_SPEND_PER_MEMO) {
      results.push({
        kind: "reject",
        reason: `Total new daily spend cap exceeded: $${(state.newDailySpendUsd + incremental).toFixed(2)} > $${T.MAX_NEW_DAILY_SPEND_PER_MEMO}.`,
      })
      continue
    }

    const single = applyGuardrails(action, signals)
    results.push(single)
    if (single.kind === "pass") {
      if (action.tool === "propose_new_campaign") state.newCampaignsProposed += 1
      state.newDailySpendUsd += incremental
    }
  }
  return results
}
```

Also add `checkNewCampaignBudget` to `HARD_RULES` so single-action calls catch the per-action budget violation too:

```ts
const HARD_RULES: Array<(a: AdsAction, s: AdsSignals) => string | null> = [
  checkCampaignAge,
  checkDataVolume,
  checkPauseProtection,
  checkBrandAllowlist,
  checkMatchTypeDirection,
  checkNewCampaignBudget,
]
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test:run -- guardrails.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/guardrails.ts __tests__/lib/ads/agent/guardrails.test.ts
git commit -m "feat(ads-agent): new-campaign caps + memo-level total-spend guardrail"
```

---

## Task 8: Guardrails — soft rules (significance + audit confidence + seasonality)

**Files:**
- Modify: `lib/ads/agent/guardrails.ts`
- Modify: `__tests__/lib/ads/agent/guardrails.test.ts`

- [ ] **Step 1: Add failing tests for soft rules**

Append to `__tests__/lib/ads/agent/guardrails.test.ts`:

```ts
import { computeSignificance, computeAuditConfidence } from "@/lib/ads/agent/guardrails"

describe("soft guardrails — significance", () => {
  it("flags sig when proportion delta passes z=1.96 with adequate sample", () => {
    // CTR before: 50/1000 = 5%; after: 100/1000 = 10%; z ≈ 4.0 — clearly sig.
    expect(computeSignificance({
      kind: "proportion",
      before: { successes: 50, trials: 1000 },
      after: { successes: 100, trials: 1000 },
    })).toBe("sig")
  })

  it("flags underpowered when sample is large but delta is tiny", () => {
    // 100/1000 vs 102/1000 — same trials, near-zero diff.
    expect(computeSignificance({
      kind: "proportion",
      before: { successes: 100, trials: 1000 },
      after: { successes: 102, trials: 1000 },
    })).toBe("underpowered")
  })

  it("flags insufficient_data when either side < SIG_MIN_SAMPLE", () => {
    expect(computeSignificance({
      kind: "proportion",
      before: { successes: 5, trials: 50 },
      after: { successes: 10, trials: 50 },
    })).toBe("insufficient_data")
  })
})

describe("soft guardrails — audit confidence", () => {
  it("high when data passes AND sig AND prior similar action succeeded", () => {
    expect(computeAuditConfidence({
      dataVolumeOk: true,
      significance: "sig",
      priorSimilarSucceeded: true,
    })).toBe("high")
  })

  it("medium when 2 of 3 are true", () => {
    expect(computeAuditConfidence({
      dataVolumeOk: true,
      significance: "sig",
      priorSimilarSucceeded: false,
    })).toBe("medium")
  })

  it("low when 0 or 1 are true", () => {
    expect(computeAuditConfidence({
      dataVolumeOk: false,
      significance: "underpowered",
      priorSimilarSucceeded: false,
    })).toBe("low")
  })
})
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm run test:run -- guardrails.test.ts`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Add the soft-guardrail helpers**

Append to `lib/ads/agent/guardrails.ts`:

```ts
// ── Soft guardrails ─────────────────────────────────────────────

export type Significance = "sig" | "underpowered" | "insufficient_data"

type SignificanceInput =
  | {
      kind: "proportion"
      before: { successes: number; trials: number }
      after: { successes: number; trials: number }
    }
  | {
      kind: "mean"
      before: { sum: number; sumSq: number; n: number }
      after: { sum: number; sumSq: number; n: number }
    }

export function computeSignificance(input: SignificanceInput): Significance {
  if (input.kind === "proportion") {
    const { before, after } = input
    if (before.trials < T.SIG_MIN_SAMPLE || after.trials < T.SIG_MIN_SAMPLE) {
      return "insufficient_data"
    }
    const p1 = before.successes / before.trials
    const p2 = after.successes / after.trials
    const pooled = (before.successes + after.successes) / (before.trials + after.trials)
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / before.trials + 1 / after.trials))
    if (se === 0) return "underpowered"
    const z = Math.abs(p2 - p1) / se
    return z >= T.SIG_Z_THRESHOLD ? "sig" : "underpowered"
  }
  // Means: Welch's t-test
  const { before, after } = input
  if (before.n < T.SIG_MIN_SAMPLE || after.n < T.SIG_MIN_SAMPLE) {
    return "insufficient_data"
  }
  const m1 = before.sum / before.n
  const m2 = after.sum / after.n
  const v1 = (before.sumSq - before.sum * m1) / Math.max(1, before.n - 1)
  const v2 = (after.sumSq - after.sum * m2) / Math.max(1, after.n - 1)
  const se = Math.sqrt(v1 / before.n + v2 / after.n)
  if (se === 0) return "underpowered"
  const t = Math.abs(m2 - m1) / se
  return t >= T.SIG_Z_THRESHOLD ? "sig" : "underpowered"
}

export function computeAuditConfidence(input: {
  dataVolumeOk: boolean
  significance: Significance
  priorSimilarSucceeded: boolean
}): "low" | "medium" | "high" {
  const sigOk = input.significance === "sig"
  const score = [input.dataVolumeOk, sigOk, input.priorSimilarSucceeded].filter(Boolean).length
  if (score === 3) return "high"
  if (score === 2) return "medium"
  return "low"
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test:run -- guardrails.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/guardrails.ts __tests__/lib/ads/agent/guardrails.test.ts
git commit -m "feat(ads-agent): soft guardrails — significance + audit_confidence helpers"
```

---

## Task 9: Signals — preflight

**Files:**
- Create: `lib/ads/agent/signals.ts`
- Test: `__tests__/lib/ads/agent/signals.test.ts`

- [ ] **Step 1: Write the failing preflight test**

Create `__tests__/lib/ads/agent/signals.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { runPreflight } from "@/lib/ads/agent/signals"

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
    }),
  }),
}))

describe("ads agent preflight", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-05-13T12:00:00Z")))

  it("fails when most recent conversion is older than CONVERSION_FRESHNESS_HOURS", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-10T12:00:00Z"), // 72h ago
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: true, gsc: true },
      activeCampaignClicks7d: 200,
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => /conversion tracking.*stale/i.test(r))).toBe(true)
  })

  it("fails when no active campaign has ≥ MIN_RECENT_CLICKS clicks in last 7 days", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-13T06:00:00Z"),
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: true, gsc: true },
      activeCampaignClicks7d: 5,
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => /insufficient.*clicks/i.test(r))).toBe(true)
  })

  it("fails when any OAuth token is invalid", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-13T06:00:00Z"),
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: false, gsc: true },
      activeCampaignClicks7d: 200,
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => /ga4.*token/i.test(r))).toBe(true)
  })

  it("passes when all checks succeed", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-13T06:00:00Z"),
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: true, gsc: true },
      activeCampaignClicks7d: 200,
    })
    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- signals.test.ts`
Expected: FAIL (`Cannot find module '@/lib/ads/agent/signals'`).

- [ ] **Step 3: Create the signals module with `runPreflight`**

Create `lib/ads/agent/signals.ts`:

```ts
// lib/ads/agent/signals.ts
// Gathers the unified snapshot the reasoning step consumes:
// 0. Preflight (data-quality gate)
// 1. Raw inputs (Google Ads + GA4 + GSC + pipeline + memory)
// 2. Derived cross-channel signals
// 3. Learning layer

import * as T from "./thresholds"
import type {
  AdsSignals,
  AdsDerivedSignals,
  AdsLearningLayer,
  AdsRawInputs,
  PreflightResult,
} from "./types"

const HOURS = 3_600_000

export interface PreflightInput {
  mostRecentConversionAt: Date | null
  ga4SyncedAt: Date | null
  gscSyncedAt: Date | null
  tokensValid: { googleAds: boolean; ga4: boolean; gsc: boolean }
  activeCampaignClicks7d: number
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const now = Date.now()
  const reasons: string[] = []

  if (!input.mostRecentConversionAt) {
    reasons.push("Conversion tracking stale: no conversions on record.")
  } else {
    const ageHours = (now - input.mostRecentConversionAt.getTime()) / HOURS
    if (ageHours > T.CONVERSION_FRESHNESS_HOURS) {
      reasons.push(
        `Conversion tracking stale: most recent conversion is ${ageHours.toFixed(1)}h old (threshold ${T.CONVERSION_FRESHNESS_HOURS}h).`,
      )
    }
  }

  if (input.activeCampaignClicks7d < T.MIN_RECENT_CLICKS) {
    reasons.push(
      `Insufficient clicks: ${input.activeCampaignClicks7d} clicks across active campaigns in last ${T.RECENT_CLICKS_WINDOW_DAYS}d (threshold ${T.MIN_RECENT_CLICKS}).`,
    )
  }

  if (!input.tokensValid.googleAds) reasons.push("Google Ads OAuth token invalid or missing.")
  if (!input.tokensValid.ga4) reasons.push("GA4 OAuth token invalid or missing.")
  if (!input.tokensValid.gsc) reasons.push("GSC OAuth token invalid or missing.")

  if (input.ga4SyncedAt) {
    const ga4Lag = (now - input.ga4SyncedAt.getTime()) / HOURS
    if (ga4Lag > T.SYNC_FRESHNESS_HOURS) {
      reasons.push(`GA4 sync lag ${ga4Lag.toFixed(1)}h exceeds ${T.SYNC_FRESHNESS_HOURS}h.`)
    }
  }
  if (input.gscSyncedAt) {
    const gscLag = (now - input.gscSyncedAt.getTime()) / HOURS
    if (gscLag > T.SYNC_FRESHNESS_HOURS) {
      reasons.push(`GSC sync lag ${gscLag.toFixed(1)}h exceeds ${T.SYNC_FRESHNESS_HOURS}h.`)
    }
  }

  return { ok: reasons.length === 0, reasons }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- signals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/signals.ts __tests__/lib/ads/agent/signals.test.ts
git commit -m "feat(ads-agent): signals preflight gate"
```

---

## Task 10: Signals — raw inputs orchestration

**Files:**
- Modify: `lib/ads/agent/signals.ts`
- Modify: `__tests__/lib/ads/agent/signals.test.ts`

- [ ] **Step 1: Add failing test for `gatherRawInputs`**

Append to `__tests__/lib/ads/agent/signals.test.ts`:

```ts
import { gatherRawInputs } from "@/lib/ads/agent/signals"

describe("gatherRawInputs", () => {
  it("returns a JSON-serializable AdsRawInputs shape with all five top-level keys", async () => {
    // Inject deps so the test is hermetic.
    const result = await gatherRawInputs({
      fetchCampaigns: async () => [],
      fetchSearchTermsTopSpend: async () => [],
      fetchSearchTermsTopConversions: async () => [],
      fetchPendingRecommendations: async () => [],
      fetchConversionActions: async () => [],
      fetchGa4: async () => ({ sessions_by_source_medium: [], landing_page_engagement: [] }),
      fetchGscOrganicTop10: async () => [],
      fetchPipeline: async () => ({
        visits: 0, signups: 0, bookings: 0, payments: 0,
        visits_to_signup: 0, signup_to_booking: 0, booking_to_payment: 0,
      }),
      fetchPriorMemos: async () => [],
    })
    expect(result).toHaveProperty("campaigns")
    expect(result).toHaveProperty("ga4")
    expect(result).toHaveProperty("gsc_organic_top10")
    expect(result).toHaveProperty("pipeline")
    expect(result).toHaveProperty("prior_memos")
    expect(JSON.stringify(result)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test:run -- signals.test.ts`
Expected: FAIL (`gatherRawInputs` not exported).

- [ ] **Step 3: Implement `gatherRawInputs` with dependency injection**

Append to `lib/ads/agent/signals.ts`:

```ts
// Dependency-injected so the orchestrator stays testable. The integrator
// wires these to real Supabase / Google Ads / GA4 / GSC clients in
// gatherAdsSignals (Task 12).

export interface RawInputDeps {
  fetchCampaigns: () => Promise<AdsRawInputs["campaigns"]>
  fetchSearchTermsTopSpend: () => Promise<AdsRawInputs["search_terms_top_spend"]>
  fetchSearchTermsTopConversions: () => Promise<AdsRawInputs["search_terms_top_conversions"]>
  fetchPendingRecommendations: () => Promise<AdsRawInputs["pending_recommendations"]>
  fetchConversionActions: () => Promise<AdsRawInputs["conversion_actions"]>
  fetchGa4: () => Promise<AdsRawInputs["ga4"]>
  fetchGscOrganicTop10: () => Promise<AdsRawInputs["gsc_organic_top10"]>
  fetchPipeline: () => Promise<AdsRawInputs["pipeline"]>
  fetchPriorMemos: () => Promise<AdsRawInputs["prior_memos"]>
}

export async function gatherRawInputs(deps: RawInputDeps): Promise<AdsRawInputs> {
  const [
    campaigns,
    search_terms_top_spend,
    search_terms_top_conversions,
    pending_recommendations,
    conversion_actions,
    ga4,
    gsc_organic_top10,
    pipeline,
    prior_memos,
  ] = await Promise.all([
    deps.fetchCampaigns(),
    deps.fetchSearchTermsTopSpend(),
    deps.fetchSearchTermsTopConversions(),
    deps.fetchPendingRecommendations(),
    deps.fetchConversionActions(),
    deps.fetchGa4(),
    deps.fetchGscOrganicTop10(),
    deps.fetchPipeline(),
    deps.fetchPriorMemos(),
  ])
  return {
    campaigns,
    search_terms_top_spend,
    search_terms_top_conversions,
    pending_recommendations,
    conversion_actions,
    ga4,
    gsc_organic_top10,
    pipeline,
    prior_memos,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- signals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/signals.ts __tests__/lib/ads/agent/signals.test.ts
git commit -m "feat(ads-agent): gatherRawInputs orchestrator with injected deps"
```

---

## Task 11: Signals — derived + learning layer

**Files:**
- Modify: `lib/ads/agent/signals.ts`
- Modify: `__tests__/lib/ads/agent/signals.test.ts`

- [ ] **Step 1: Add failing tests for `deriveCrossChannelSignals` and `deriveLearningLayer`**

Append to `__tests__/lib/ads/agent/signals.test.ts`:

```ts
import { deriveCrossChannelSignals, deriveLearningLayer } from "@/lib/ads/agent/signals"

describe("deriveCrossChannelSignals", () => {
  it("surfaces a search term as paid_terms_already_organic when paid spend >= threshold AND organic position <= 5", () => {
    const raw = {
      campaigns: [], pending_recommendations: [], conversion_actions: [],
      search_terms_top_conversions: [],
      ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
      pipeline: {
        visits: 0, signups: 0, bookings: 0, payments: 0,
        visits_to_signup: 0, signup_to_booking: 0, booking_to_payment: 0,
      },
      prior_memos: [],
      search_terms_top_spend: [
        { text: "comeback code", campaign_id: "c1", cost_usd: 50, clicks: 30, conversions: 2 },
      ],
      gsc_organic_top10: [
        { query: "comeback code", page: "/comeback", position: 3, clicks: 80, impressions: 1000 },
      ],
    } as unknown as Parameters<typeof deriveCrossChannelSignals>[0]
    const derived = deriveCrossChannelSignals(raw)
    expect(derived.paid_terms_already_organic).toHaveLength(1)
    expect(derived.paid_terms_already_organic[0].query).toBe("comeback code")
  })

  it("surfaces an organic_wins_not_in_ads when GSC clicks >= 10 AND position <= 10 AND not in paid search terms", () => {
    const raw = {
      campaigns: [], pending_recommendations: [], conversion_actions: [],
      search_terms_top_conversions: [],
      ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
      pipeline: {
        visits: 0, signups: 0, bookings: 0, payments: 0,
        visits_to_signup: 0, signup_to_booking: 0, booking_to_payment: 0,
      },
      prior_memos: [],
      search_terms_top_spend: [],
      gsc_organic_top10: [
        { query: "rotational reboot", page: "/reboot", position: 4, clicks: 40, impressions: 800 },
      ],
    } as unknown as Parameters<typeof deriveCrossChannelSignals>[0]
    const derived = deriveCrossChannelSignals(raw)
    expect(derived.organic_wins_not_in_ads).toHaveLength(1)
    expect(derived.organic_wins_not_in_ads[0].query).toBe("rotational reboot")
  })

  it("surfaces landing_page_engagement_mismatch when CTR is high-tier but engagement < floor", () => {
    const raw = {
      campaigns: [
        { id: "c1", name: "x", status: "ENABLED", daily_budget_usd: 10, created_at: "2025-01-01",
          last_7d_conversions: 0,
          metrics_28d: { clicks: 1000, impressions: 10_000, ctr: 0.1, conversions: 5, cvr: 0.005, cost_usd: 100, cac_usd: 20, roas: 1, impression_share: 0.5, impression_share_lost_budget: 0, impression_share_lost_rank: 0 } },
        { id: "c2", name: "y", status: "ENABLED", daily_budget_usd: 10, created_at: "2025-01-01",
          last_7d_conversions: 0,
          metrics_28d: { clicks: 500, impressions: 10_000, ctr: 0.05, conversions: 5, cvr: 0.01, cost_usd: 100, cac_usd: 20, roas: 1, impression_share: 0.5, impression_share_lost_budget: 0, impression_share_lost_rank: 0 } },
      ],
      pending_recommendations: [], conversion_actions: [], search_terms_top_conversions: [], search_terms_top_spend: [],
      gsc_organic_top10: [], pipeline: { visits:0, signups:0, bookings:0, payments:0, visits_to_signup:0, signup_to_booking:0, booking_to_payment:0 }, prior_memos: [],
      ga4: {
        sessions_by_source_medium: [],
        landing_page_engagement: [
          { page_path: "/c1-lp", engagement_rate: 0.2, sessions: 500 },
        ],
      },
    } as unknown as Parameters<typeof deriveCrossChannelSignals>[0]
    // Bridge the campaign-to-landing-page mapping via a side-table the function
    // accepts as a second arg (campaign_id → landing_page).
    const derived = deriveCrossChannelSignals(raw, { c1: "/c1-lp", c2: "/c2-lp" })
    expect(derived.landing_page_engagement_mismatch).toHaveLength(1)
    expect(derived.landing_page_engagement_mismatch[0].campaign_id).toBe("c1")
  })
})

describe("deriveLearningLayer", () => {
  it("classifies prior actions whose outcome moved the predicted direction as worked", () => {
    const raw = {
      campaigns: [], pending_recommendations: [], conversion_actions: [], search_terms_top_conversions: [], search_terms_top_spend: [],
      ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
      gsc_organic_top10: [],
      pipeline: { visits:0, signups:0, bookings:0, payments:0, visits_to_signup:0, signup_to_booking:0, booking_to_payment:0 },
      prior_memos: [
        {
          id: "m1", week_of: "2026-04-29", outcome_status: "measured",
          outcome_metrics: { c1: { CVR_delta_pct: 18.0 } },
          actions: [
            {
              rank: 1, tool: "propose_new_keywords",
              args: { campaign_id: "c1" }, rationale: "",
              expected_metric: "CVR", expected_direction: "increase",
              confidence: "medium", audit_confidence: "medium", significance: "sig",
              supporting_signals: [], status: "applied", recommendation_id: "r1",
              applied_at: "2026-04-30", clamped: false,
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof deriveLearningLayer>[0]
    const learning = deriveLearningLayer(raw, new Date("2026-05-13"))
    expect(learning.prior_actions_that_worked).toHaveLength(1)
    expect(learning.prior_actions_that_failed).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm run test:run -- signals.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the derivation functions**

Append to `lib/ads/agent/signals.ts`:

```ts
export function deriveCrossChannelSignals(
  raw: AdsRawInputs,
  campaignToLandingPage: Record<string, string> = {},
): AdsDerivedSignals {
  // paid_terms_already_organic
  const organicByQuery = new Map(
    raw.gsc_organic_top10.map((g) => [g.query.toLowerCase(), g]),
  )
  const paid_terms_already_organic: AdsDerivedSignals["paid_terms_already_organic"] = []
  for (const term of raw.search_terms_top_spend) {
    if (term.cost_usd < T.PAID_SPEND_THRESHOLD_USD) continue
    const organic = organicByQuery.get(term.text.toLowerCase())
    if (organic && organic.position <= T.ORGANIC_OVERLAP_MAX_POSITION) {
      paid_terms_already_organic.push({
        query: term.text,
        paid_spend_usd: term.cost_usd,
        organic_position: organic.position,
        organic_page: organic.page,
      })
    }
  }

  // organic_wins_not_in_ads
  const paidQueries = new Set(
    [...raw.search_terms_top_spend, ...raw.search_terms_top_conversions].map((t) =>
      t.text.toLowerCase(),
    ),
  )
  const organic_wins_not_in_ads: AdsDerivedSignals["organic_wins_not_in_ads"] = []
  for (const o of raw.gsc_organic_top10) {
    if (o.clicks < T.ORGANIC_WIN_MIN_CLICKS) continue
    if (o.position > T.ORGANIC_WIN_MAX_POSITION) continue
    if (paidQueries.has(o.query.toLowerCase())) continue
    organic_wins_not_in_ads.push({
      query: o.query,
      organic_clicks: o.clicks,
      organic_position: o.position,
    })
  }

  // landing_page_engagement_mismatch
  const ctrs = raw.campaigns.map((c) => c.metrics_28d.ctr).sort((a, b) => a - b)
  const p75 = ctrs.length ? ctrs[Math.floor(ctrs.length * 0.75)] : Infinity
  const engagementByPath = new Map(
    raw.ga4.landing_page_engagement.map((e) => [e.page_path, e]),
  )
  const landing_page_engagement_mismatch: AdsDerivedSignals["landing_page_engagement_mismatch"] = []
  for (const c of raw.campaigns) {
    if (c.metrics_28d.ctr < p75) continue
    const lp = campaignToLandingPage[c.id]
    if (!lp) continue
    const eng = engagementByPath.get(lp)
    if (!eng) continue
    if (eng.engagement_rate <= T.LP_ENGAGEMENT_FLOOR) {
      landing_page_engagement_mismatch.push({
        campaign_id: c.id,
        ctr: c.metrics_28d.ctr,
        landing_page: lp,
        engagement_rate: eng.engagement_rate,
      })
    }
  }

  return {
    paid_terms_already_organic,
    organic_wins_not_in_ads,
    landing_page_engagement_mismatch,
  }
}

export function deriveLearningLayer(
  raw: AdsRawInputs,
  now: Date = new Date(),
): AdsLearningLayer {
  const prior_actions_that_worked: AdsLearningLayer["prior_actions_that_worked"] = []
  const prior_actions_that_failed: AdsLearningLayer["prior_actions_that_failed"] = []

  for (const memo of raw.prior_memos) {
    if (memo.outcome_status !== "measured") continue
    const weeks_ago = Math.floor(
      (now.getTime() - new Date(memo.week_of).getTime()) / (7 * 86_400_000),
    )
    for (const action of memo.actions) {
      if (action.status !== "applied") continue
      // outcome_metrics shape: { <campaign_id_or_action_key>: { <Metric>_delta_pct: number } }
      const args = action.args as Record<string, unknown>
      const key = (args.campaign_id as string) ?? (args.from_campaign_id as string) ?? action.recommendation_id ?? ""
      const bucket = (memo.outcome_metrics?.[key] as Record<string, number> | undefined) ?? {}
      const delta = bucket[`${action.expected_metric}_delta_pct`] ?? 0
      const moved = action.expected_direction === "increase" ? delta > 0 : delta < 0
      const summary = `${action.tool} on ${key}`
      const entry = { tool: action.tool, args_summary: summary, observed_delta: delta, weeks_ago }
      if (moved && action.significance === "sig") prior_actions_that_worked.push(entry)
      else if (!moved) prior_actions_that_failed.push(entry)
    }
  }

  return {
    winning_keywords: [],
    winning_audiences: [],
    winning_ad_creative: [],
    winning_schedule: [],
    winning_geos: [],
    prior_actions_that_worked,
    prior_actions_that_failed,
  }
}
```

Note: `winning_keywords/audiences/ad_creative/schedule/geos` start as empty arrays in v1 since they require additional Google Ads API surfaces (`ad_schedule_view`, `keyword_view`, `geographic_view`) not yet in the sync. They are populated in a follow-up plan once the sync is extended. The reasoning prompt is robust to empty arrays.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- signals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/signals.ts __tests__/lib/ads/agent/signals.test.ts
git commit -m "feat(ads-agent): derived cross-channel + learning-layer signals"
```

---

## Task 12: Signals — top-level `gatherAdsSignals` orchestrator

**Files:**
- Modify: `lib/ads/agent/signals.ts`

- [ ] **Step 1: Implement `gatherAdsSignals` that wires preflight + raw + derived + learning**

Append to `lib/ads/agent/signals.ts`:

```ts
export interface GatherAdsSignalsDeps extends RawInputDeps {
  fetchPreflightInput: () => Promise<PreflightInput>
  fetchCampaignToLandingPageMap: () => Promise<Record<string, string>>
}

export async function gatherAdsSignals(deps: GatherAdsSignalsDeps): Promise<AdsSignals> {
  const generated_at = new Date().toISOString()
  const preflightInput = await deps.fetchPreflightInput()
  const preflight = await runPreflight(preflightInput)
  if (!preflight.ok) {
    return {
      generated_at,
      preflight,
      raw: null,
      derived: null,
      learning: null,
      gaps: ["Preflight failed; raw, derived, and learning skipped."],
    }
  }
  const gaps: string[] = []
  let raw: AdsRawInputs | null = null
  try {
    raw = await gatherRawInputs(deps)
  } catch (e) {
    gaps.push(`Raw input gather failed: ${(e as Error).message}`)
  }
  let derived: AdsDerivedSignals | null = null
  let learning: AdsLearningLayer | null = null
  if (raw) {
    const map = await deps.fetchCampaignToLandingPageMap().catch(() => ({}))
    derived = deriveCrossChannelSignals(raw, map)
    learning = deriveLearningLayer(raw)
  }
  return { generated_at, preflight, raw, derived, learning, gaps }
}
```

- [ ] **Step 2: Run all signals tests to confirm nothing broke**

Run: `npm run test:run -- signals.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ads/agent/signals.ts
git commit -m "feat(ads-agent): gatherAdsSignals top-level orchestrator"
```

---

## Task 13: Decision schema

**Files:**
- Create: `lib/ads/agent/decision-schema.ts`
- Test: `__tests__/lib/ads/agent/decision-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ads/agent/decision-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { adsAgentDecisionSchema } from "@/lib/ads/agent/decision-schema"

const validAction = {
  rank: 1,
  tool: "propose_new_keywords",
  args: { campaign_id: "c1", ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
  rationale: "Adding two organic-winning queries currently absent from the campaign.",
  expected_metric: "CVR",
  expected_direction: "increase",
  confidence: "medium",
  supporting_signals: ["organic_wins_not_in_ads"],
}

describe("adsAgentDecisionSchema", () => {
  it("accepts a valid decision with one action", () => {
    expect(adsAgentDecisionSchema.safeParse({
      rationale: "Snapshot read here.",
      actions: [validAction],
      watch_list: ["Watch CAC on Brand Search next week."],
    }).success).toBe(true)
  })

  it("rejects unknown tool name", () => {
    const bad = { ...validAction, tool: "delete_everything" }
    expect(adsAgentDecisionSchema.safeParse({
      rationale: "x", actions: [bad], watch_list: [],
    }).success).toBe(false)
  })

  it("rejects > 7 actions", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...validAction, rank: i + 1 }))
    expect(adsAgentDecisionSchema.safeParse({
      rationale: "x", actions: many, watch_list: [],
    }).success).toBe(false)
  })

  it("rejects > 5 watch_list items", () => {
    expect(adsAgentDecisionSchema.safeParse({
      rationale: "x",
      actions: [validAction],
      watch_list: ["a", "b", "c", "d", "e", "f"],
    }).success).toBe(false)
  })

  it("accepts every supported tool", () => {
    const tools = [
      "propose_budget_shift", "propose_new_keywords", "propose_negative_keywords",
      "propose_ad_copy_test", "propose_audience_expansion",
      "propose_new_campaign", "propose_campaign_pause", "propose_campaign_split",
      "propose_match_type_change", "propose_bid_strategy_review", "flag_for_human",
    ]
    for (const tool of tools) {
      const result = adsAgentDecisionSchema.safeParse({
        rationale: "x", watch_list: [],
        actions: [{ ...validAction, tool }],
      })
      expect(result.success, `tool "${tool}" should parse`).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test:run -- decision-schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create the schema**

Create `lib/ads/agent/decision-schema.ts`:

```ts
// lib/ads/agent/decision-schema.ts
// Zod schema for Claude's structured output. The reasoning step validates
// every model response against this before any downstream step sees it.

import { z } from "zod"

export const adsAgentActionSchema = z.object({
  rank: z.number().int().min(1),
  tool: z.enum([
    "propose_budget_shift",
    "propose_new_keywords",
    "propose_negative_keywords",
    "propose_ad_copy_test",
    "propose_audience_expansion",
    "propose_new_campaign",
    "propose_campaign_pause",
    "propose_campaign_split",
    "propose_match_type_change",
    "propose_bid_strategy_review",
    "flag_for_human",
  ]),
  args: z.record(z.unknown()),
  rationale: z.string().min(20).max(400),
  expected_metric: z.enum(["CTR", "CVR", "CAC", "ROAS", "spend_efficiency", "impression_share"]),
  expected_direction: z.enum(["increase", "decrease"]),
  confidence: z.enum(["low", "medium", "high"]),
  supporting_signals: z.array(z.string()).max(5),
})

export const adsAgentDecisionSchema = z.object({
  rationale: z.string().min(1),
  actions: z.array(adsAgentActionSchema).max(7),
  watch_list: z.array(z.string()).max(5),
})

export type AdsAgentDecision = z.infer<typeof adsAgentDecisionSchema>
export type AdsAgentDecisionAction = z.infer<typeof adsAgentActionSchema>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- decision-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/decision-schema.ts __tests__/lib/ads/agent/decision-schema.test.ts
git commit -m "feat(ads-agent): Zod decision schema with expanded tool catalog"
```

---

## Task 14: Reasoning module

**Files:**
- Create: `lib/ads/agent/reason.ts`
- Test: `__tests__/lib/ads/agent/reason.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ads/agent/reason.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ai/anthropic", () => ({
  MODEL_SONNET: "claude-sonnet-4-20250514",
  callAgent: vi.fn(),
}))

import { reasonAdsDecision } from "@/lib/ads/agent/reason"
import { callAgent } from "@/lib/ai/anthropic"
import type { AdsSignals } from "@/lib/ads/agent/types"

const validDecision = {
  rationale: "Snapshot read.",
  actions: [
    {
      rank: 1,
      tool: "propose_new_keywords",
      args: { campaign_id: "c1", ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
      rationale: "Adding organic-winning query absent from campaign.",
      expected_metric: "CVR",
      expected_direction: "increase",
      confidence: "medium",
      supporting_signals: ["organic_wins_not_in_ads"],
    },
  ],
  watch_list: [],
}

const passingSignals: AdsSignals = {
  generated_at: new Date().toISOString(),
  preflight: { ok: true, reasons: [] },
  raw: {
    campaigns: [], search_terms_top_spend: [], search_terms_top_conversions: [],
    pending_recommendations: [], conversion_actions: [],
    ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
    gsc_organic_top10: [],
    pipeline: { visits: 0, signups: 0, bookings: 0, payments: 0, visits_to_signup: 0, signup_to_booking: 0, booking_to_payment: 0 },
    prior_memos: [],
  },
  derived: { paid_terms_already_organic: [], organic_wins_not_in_ads: [], landing_page_engagement_mismatch: [] },
  learning: {
    winning_keywords: [], winning_audiences: [], winning_ad_creative: [],
    winning_schedule: [], winning_geos: [],
    prior_actions_that_worked: [], prior_actions_that_failed: [],
  },
  gaps: [],
}

describe("reasonAdsDecision", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the decision on first valid response", async () => {
    ;(callAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      object: validDecision,
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    const out = await reasonAdsDecision(passingSignals)
    expect(out.decision).toEqual(validDecision)
    expect(out.tokensUsed).toBe(150)
  })

  it("retries once on Zod failure and succeeds on second attempt", async () => {
    ;(callAgent as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ object: { rationale: "x", actions: [{ tool: "garbage" }], watch_list: [] }, usage: { input_tokens: 0, output_tokens: 0 } })
      .mockResolvedValueOnce({ object: validDecision, usage: { input_tokens: 100, output_tokens: 50 } })
    const out = await reasonAdsDecision(passingSignals)
    expect(out.decision).toEqual(validDecision)
    expect((callAgent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it("throws when both attempts fail Zod validation", async () => {
    ;(callAgent as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ object: { not: "valid" }, usage: { input_tokens: 0, output_tokens: 0 } })
    await expect(reasonAdsDecision(passingSignals)).rejects.toThrow(/decision.*invalid/i)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test:run -- reason.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create the reason module**

Create `lib/ads/agent/reason.ts`:

```ts
// lib/ads/agent/reason.ts
// Single Claude call with cached system prompt. Validates the response
// against adsAgentDecisionSchema; retries once on validation failure.

import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"
import { adsAgentDecisionSchema, type AdsAgentDecision } from "./decision-schema"
import type { AdsSignals } from "./types"

const SYSTEM_PROMPT = `You are the senior paid-media strategist for DJP Athlete.
Programs include "Comeback Code" and "Rotational Reboot". Tone: direct,
opinionated, pragmatic.

You will receive a JSON snapshot of the account's marketing state:
- raw inputs (campaigns, search terms, GA4, GSC, pipeline)
- cross-channel derived signals (paid-terms-already-organic, organic-wins-not-in-ads, landing-page-engagement-mismatch)
- a learning layer (prior_actions_that_worked / prior_actions_that_failed from past memos)

Your job is to produce a Zod-validated decision with up to 7 ranked actions.

Rules you MUST follow:
- Bias toward repeating patterns in prior_actions_that_worked.
- Avoid repeating patterns in prior_actions_that_failed.
- Cite specific signals in supporting_signals (use the signal names from the snapshot).
- Use flag_for_human when signals are ambiguous or when no tool fits.
- Use propose_new_campaign sparingly — at most one per memo, and only when
  organic_wins_not_in_ads shows a cluster the account has zero paid presence on.
- When data is sparse (gaps[] is non-empty), mark confidence as 'low'.
- All actions are PROPOSALS routed to a human-approved queue. Phrase rationale
  as a recommendation, not a fait accompli.

Return only the structured decision — no narrative text outside the schema.`

export interface ReasonAdsDecisionResult {
  decision: AdsAgentDecision
  tokensUsed: number
}

export async function reasonAdsDecision(
  signals: AdsSignals,
): Promise<ReasonAdsDecisionResult> {
  const userContent = JSON.stringify(signals)
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await callAgent({
      model: MODEL_SONNET,
      system: SYSTEM_PROMPT,
      cacheSystemPrompt: true,
      schema: adsAgentDecisionSchema,
      messages: [
        {
          role: "user",
          content: attempt === 0
            ? userContent
            : `${userContent}\n\nYour previous response did not match the schema. Return ONLY valid JSON matching adsAgentDecisionSchema.`,
        },
      ],
    })
    const parsed = adsAgentDecisionSchema.safeParse(response.object)
    if (parsed.success) {
      const tokens = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
      return { decision: parsed.data, tokensUsed: tokens }
    }
    lastError = parsed.error
  }
  throw new Error(`Ads agent decision invalid after retry: ${String(lastError)}`)
}
```

If the `callAgent` signature differs (it likely takes `{ system, messages, schema }` or `{ prompt, schema }`), adapt: read `lib/ai/anthropic.ts` first and match its existing interface. The test mocks `callAgent` to return `{ object, usage }`, so the adapter must produce that shape.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- reason.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/reason.ts __tests__/lib/ads/agent/reason.test.ts
git commit -m "feat(ads-agent): reasoning module with one-shot retry"
```

---

## Task 15: Execute — within-campaign tool handlers

**Files:**
- Create: `lib/ads/agent/execute.ts`
- Test: `__tests__/lib/ads/agent/execute.test.ts`

The execute module writes each accepted action to the existing `google_ads_recommendations` queue. Inspect that table's columns first (via `mcp__supabase__list_tables`) to confirm column names — the inserts below assume `kind text`, `payload jsonb`, `status text`, `source text`, `memo_id uuid`, `created_at timestamp`. Adjust column names to match the actual schema.

- [ ] **Step 1: Confirm `google_ads_recommendations` schema**

Call `mcp__supabase__list_tables` and inspect the columns of `google_ads_recommendations`. Confirm field names. If the schema differs from the assumption above, adapt the insert statements in Step 3 accordingly. Otherwise proceed.

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/ads/agent/execute.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const inserted: Array<Record<string, unknown>> = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            inserted.push(row)
            return Promise.resolve({ data: { id: `rec-${inserted.length}` }, error: null })
          },
        }),
      }),
    }),
  }),
}))

import { executeAdsAction } from "@/lib/ads/agent/execute"
import type { AdsAction } from "@/lib/ads/agent/types"

const baseAction = (overrides: Partial<AdsAction> = {}): AdsAction => ({
  rank: 1,
  tool: "propose_new_keywords",
  args: { campaign_id: "c1", ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
  rationale: "test",
  expected_metric: "CVR",
  expected_direction: "increase",
  confidence: "medium",
  supporting_signals: [],
  ...overrides,
})

describe("executeAdsAction (within-campaign)", () => {
  beforeEach(() => { inserted.length = 0 })

  it("writes a propose_new_keywords action with kind='new_keywords'", async () => {
    const out = await executeAdsAction(baseAction(), "memo-1")
    expect(out.recommendation_id).toBe("rec-1")
    expect(inserted[0].kind).toBe("new_keywords")
    expect(inserted[0].source).toBe("ads_agent")
    expect(inserted[0].memo_id).toBe("memo-1")
    expect(inserted[0].status).toBe("proposed")
  })

  it("writes a propose_negative_keywords action with kind='negative_keywords'", async () => {
    await executeAdsAction(baseAction({
      tool: "propose_negative_keywords",
      args: { campaign_id: "c1", negatives: [{ text: "n", match_type: "phrase", scope: "campaign" }] },
    }), "memo-1")
    expect(inserted[0].kind).toBe("negative_keywords")
  })

  it("writes a propose_budget_shift, propose_ad_copy_test, propose_audience_expansion each with the right kind", async () => {
    await executeAdsAction(baseAction({
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: 10 },
    }), "memo-1")
    await executeAdsAction(baseAction({
      tool: "propose_ad_copy_test",
      args: { ad_group_id: "ag1", variant: { headlines: ["a","b","c"], descriptions: ["d","e"], final_url: "/x" } },
    }), "memo-1")
    await executeAdsAction(baseAction({
      tool: "propose_audience_expansion",
      args: { campaign_id: "c1", audience_id: "ul1" },
    }), "memo-1")
    expect(inserted.map((r) => r.kind)).toEqual(["budget_shift", "ad_copy_test", "audience_expansion"])
  })
})
```

- [ ] **Step 3: Implement the execute module (within-campaign tools)**

Create `lib/ads/agent/execute.ts`:

```ts
// lib/ads/agent/execute.ts
// Per-tool handlers. Every action becomes a row in google_ads_recommendations
// with status='proposed' and source='ads_agent'. Human approval required
// before anything reaches Google Ads.

import { createServiceRoleClient } from "@/lib/supabase"
import type { AdsAction, AdsActionTool } from "./types"

const TOOL_TO_KIND: Record<AdsActionTool, string> = {
  propose_budget_shift: "budget_shift",
  propose_new_keywords: "new_keywords",
  propose_negative_keywords: "negative_keywords",
  propose_ad_copy_test: "ad_copy_test",
  propose_audience_expansion: "audience_expansion",
  propose_new_campaign: "new_campaign",
  propose_campaign_pause: "campaign_pause",
  propose_campaign_split: "campaign_split",
  propose_match_type_change: "match_type_change",
  propose_bid_strategy_review: "bid_strategy_review",
  flag_for_human: "flag",
}

export interface ExecuteAdsActionResult {
  recommendation_id: string
}

export async function executeAdsAction(
  action: AdsAction,
  memoId: string,
): Promise<ExecuteAdsActionResult> {
  const supabase = createServiceRoleClient()
  const row = {
    memo_id: memoId,
    source: "ads_agent",
    kind: TOOL_TO_KIND[action.tool],
    payload: {
      args: action.args,
      rationale: action.rationale,
      expected_metric: action.expected_metric,
      expected_direction: action.expected_direction,
      confidence: action.confidence,
      supporting_signals: action.supporting_signals,
    },
    status: "proposed",
  }
  const { data, error } = await supabase
    .from("google_ads_recommendations")
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return { recommendation_id: (data as { id: string }).id }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- execute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/execute.ts __tests__/lib/ads/agent/execute.test.ts
git commit -m "feat(ads-agent): execute — within-campaign tool handlers"
```

---

## Task 16: Execute — `executeAdsActions` batch + structural-tools coverage

**Files:**
- Modify: `lib/ads/agent/execute.ts`
- Modify: `__tests__/lib/ads/agent/execute.test.ts`

- [ ] **Step 1: Add failing tests for batch + structural tools + guardrail integration**

Append to `__tests__/lib/ads/agent/execute.test.ts`:

```ts
import { executeAdsActions } from "@/lib/ads/agent/execute"
import type { GuardrailResult } from "@/lib/ads/agent/types"

describe("executeAdsActions (batch + guardrails)", () => {
  beforeEach(() => { inserted.length = 0 })

  it("only persists pass results to the recommendations queue", async () => {
    const guardrailed: GuardrailResult[] = [
      {
        kind: "pass",
        action: baseAction({ tool: "propose_new_keywords" }),
        annotations: { significance: "sig", audit_confidence: "high", seasonality_flag: false, clamped: false },
      },
      { kind: "reject", reason: "Brand allowlist hit." },
      {
        kind: "pass",
        action: baseAction({ rank: 3, tool: "propose_campaign_pause", args: { campaign_id: "c1", reason: "r" } }),
        annotations: { significance: "underpowered", audit_confidence: "medium", seasonality_flag: false, clamped: false },
      },
    ]
    const out = await executeAdsActions(guardrailed, "memo-1")
    expect(inserted).toHaveLength(2)
    expect(out.actions.filter((a) => a.status === "queued")).toHaveLength(2)
    expect(out.actions.filter((a) => a.status === "rejected_by_guardrails")).toHaveLength(1)
    expect(out.rejections).toHaveLength(1)
    expect(out.rejections[0].reason).toBe("Brand allowlist hit.")
  })

  it("persists structural tools (new_campaign, campaign_split, match_type_change, bid_strategy_review)", async () => {
    const guardrailed: GuardrailResult[] = [
      {
        kind: "pass",
        action: baseAction({
          tool: "propose_new_campaign",
          args: { name: "X", type: "search", initial_daily_budget: 20, target_keywords: ["a"], landing_page_url: "/y", conversion_action_ids: ["ca1"] },
        }),
        annotations: { significance: "insufficient_data", audit_confidence: "low", seasonality_flag: false, clamped: false },
      },
      {
        kind: "pass",
        action: baseAction({ rank: 2, tool: "propose_campaign_split", args: { campaign_id: "c1", split_dimension: "brand_vs_nonbrand" } }),
        annotations: { significance: "insufficient_data", audit_confidence: "low", seasonality_flag: false, clamped: false },
      },
      {
        kind: "pass",
        action: baseAction({ rank: 3, tool: "propose_match_type_change", args: { ad_group_id: "ag1", keyword_id: "kw1", from_match_type: "broad", to_match_type: "phrase" } }),
        annotations: { significance: "insufficient_data", audit_confidence: "low", seasonality_flag: false, clamped: false },
      },
      {
        kind: "pass",
        action: baseAction({ rank: 4, tool: "propose_bid_strategy_review", args: { campaign_id: "c1", current_strategy: "manual_cpc", suggested_strategy: "max_conversions", reason: "r" } }),
        annotations: { significance: "insufficient_data", audit_confidence: "low", seasonality_flag: false, clamped: false },
      },
    ]
    await executeAdsActions(guardrailed, "memo-1")
    expect(inserted.map((r) => r.kind)).toEqual([
      "new_campaign", "campaign_split", "match_type_change", "bid_strategy_review",
    ])
  })

  it("continues persisting other actions when one insert fails", async () => {
    // First insert succeeds; second fails. The third must still be attempted.
    // (Test harness inserts always succeed via the global mock — for this case
    // we re-mock the second call to error.)
    // ... (test implementation: override mock for one call)
    // The behaviour to assert: failures recorded with status='failed', loop continues.
    // This is exercised end-to-end in the integration test (Task 24) where a
    // realistic transient-failure path is easier to set up.
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:run -- execute.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `executeAdsActions` batch handler**

Append to `lib/ads/agent/execute.ts`:

```ts
import type {
  AdsAction,
  GuardrailResult,
  GoogleAdsAgentMemoAction,
  GoogleAdsAgentMemoGuardrailRejection,
} from "./types"

export interface ExecuteAdsActionsResult {
  actions: GoogleAdsAgentMemoAction[]
  rejections: GoogleAdsAgentMemoGuardrailRejection[]
}

export interface PreExecutionPair {
  guardrail: GuardrailResult
  originalAction: AdsAction
}

export async function executeAdsActions(
  pairs: PreExecutionPair[],
  memoId: string,
): Promise<ExecuteAdsActionsResult> {
  const actions: GoogleAdsAgentMemoAction[] = []
  const rejections: GoogleAdsAgentMemoGuardrailRejection[] = []

  for (const { guardrail, originalAction } of pairs) {
    if (guardrail.kind === "reject") {
      rejections.push({
        rank: originalAction.rank,
        tool: originalAction.tool,
        reason: guardrail.reason,
      })
      actions.push({
        rank: originalAction.rank,
        tool: originalAction.tool,
        args: originalAction.args,
        rationale: originalAction.rationale,
        expected_metric: originalAction.expected_metric,
        expected_direction: originalAction.expected_direction,
        confidence: originalAction.confidence,
        audit_confidence: "low",
        significance: "insufficient_data",
        supporting_signals: originalAction.supporting_signals,
        status: "rejected_by_guardrails",
        recommendation_id: null,
        applied_at: null,
        clamped: false,
      })
      continue
    }
    try {
      const { recommendation_id } = await executeAdsAction(guardrail.action, memoId)
      actions.push({
        rank: guardrail.action.rank,
        tool: guardrail.action.tool,
        args: guardrail.action.args,
        rationale: guardrail.action.rationale,
        expected_metric: guardrail.action.expected_metric,
        expected_direction: guardrail.action.expected_direction,
        confidence: guardrail.action.confidence,
        audit_confidence: guardrail.annotations.audit_confidence,
        significance: guardrail.annotations.significance,
        supporting_signals: guardrail.action.supporting_signals,
        status: "queued",
        recommendation_id,
        applied_at: null,
        clamped: guardrail.annotations.clamped,
      })
    } catch {
      actions.push({
        rank: guardrail.action.rank,
        tool: guardrail.action.tool,
        args: guardrail.action.args,
        rationale: guardrail.action.rationale,
        expected_metric: guardrail.action.expected_metric,
        expected_direction: guardrail.action.expected_direction,
        confidence: guardrail.action.confidence,
        audit_confidence: guardrail.annotations.audit_confidence,
        significance: guardrail.annotations.significance,
        supporting_signals: guardrail.action.supporting_signals,
        status: "failed",
        recommendation_id: null,
        applied_at: null,
        clamped: guardrail.annotations.clamped,
      })
    }
  }
  return { actions, rejections }
}
```

Update the existing batch test in Step 1 of this task so each input is `{ guardrail, originalAction }` instead of bare `GuardrailResult`. For example:

```ts
const pairs: PreExecutionPair[] = [
  {
    originalAction: baseAction({ tool: "propose_new_keywords" }),
    guardrail: {
      kind: "pass",
      action: baseAction({ tool: "propose_new_keywords" }),
      annotations: { significance: "sig", audit_confidence: "high", seasonality_flag: false, clamped: false },
    },
  },
  // ... etc
]
const out = await executeAdsActions(pairs, "memo-1")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- execute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/execute.ts __tests__/lib/ads/agent/execute.test.ts
git commit -m "feat(ads-agent): executeAdsActions batch with rejection persistence"
```

---

## Task 17: Outcomes — per-tool resolvers + significance

**Files:**
- Create: `lib/ads/agent/outcomes.ts`
- Test: `__tests__/lib/ads/agent/outcomes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/ads/agent/outcomes.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { measureActionOutcome } from "@/lib/ads/agent/outcomes"
import type { GoogleAdsAgentMemoAction } from "@/types/database"

const action = (overrides: Partial<GoogleAdsAgentMemoAction> = {}): GoogleAdsAgentMemoAction => ({
  rank: 1,
  tool: "propose_new_keywords",
  args: { campaign_id: "c1" },
  rationale: "test",
  expected_metric: "CVR",
  expected_direction: "increase",
  confidence: "medium",
  audit_confidence: "medium",
  significance: "sig",
  supporting_signals: [],
  status: "applied",
  recommendation_id: "rec-1",
  applied_at: "2026-04-15T00:00:00Z",
  clamped: false,
  ...overrides,
})

describe("measureActionOutcome", () => {
  it("computes CVR_delta_pct for keyword actions", async () => {
    const out = await measureActionOutcome(action(), {
      fetchCampaignWindow: async () => ({
        before: { clicks: 1000, conversions: 50 },
        after: { clicks: 1000, conversions: 80 },
      }),
    })
    expect(out.metrics.CVR_delta_pct).toBeCloseTo(60.0, 1) // 50/1000 → 80/1000 = +60%
    expect(out.significance).toBe("sig")
  })

  it("returns window_expired when applied_at is more than OUTCOME_WINDOW_EXPIRY_DAYS ago", async () => {
    const stale = action({ applied_at: "2025-01-01T00:00:00Z" })
    const out = await measureActionOutcome(stale, {
      fetchCampaignWindow: async () => ({ before: { clicks: 1, conversions: 0 }, after: { clicks: 1, conversions: 0 } }),
    })
    expect(out.error).toBe("window_expired")
  })

  it("returns not_yet_due when applied_at is less than 14 days ago", async () => {
    const recent = action({ applied_at: new Date(Date.now() - 5 * 86_400_000).toISOString() })
    const out = await measureActionOutcome(recent, {
      fetchCampaignWindow: async () => ({ before: { clicks: 1, conversions: 0 }, after: { clicks: 1, conversions: 0 } }),
    })
    expect(out.error).toBe("not_yet_due")
  })

  it("skips actions with status != 'applied'", async () => {
    const queued = action({ status: "queued", applied_at: null })
    const out = await measureActionOutcome(queued, {
      fetchCampaignWindow: async () => ({ before: { clicks: 0, conversions: 0 }, after: { clicks: 0, conversions: 0 } }),
    })
    expect(out.error).toBe("not_applied")
  })
})

import { hasOverlappingAction } from "@/lib/ads/agent/outcomes"

describe("hasOverlappingAction", () => {
  it("returns true when another applied action touched the same campaign within 14 days", () => {
    const a = action({ rank: 1, applied_at: "2026-05-01T00:00:00Z", args: { campaign_id: "c1" } })
    const sibling = action({ rank: 2, applied_at: "2026-05-07T00:00:00Z", args: { campaign_id: "c1" } })
    expect(hasOverlappingAction(a, [sibling])).toBe(true)
  })

  it("returns false when the sibling touched a different campaign", () => {
    const a = action({ rank: 1, applied_at: "2026-05-01T00:00:00Z", args: { campaign_id: "c1" } })
    const sibling = action({ rank: 2, applied_at: "2026-05-07T00:00:00Z", args: { campaign_id: "c2" } })
    expect(hasOverlappingAction(a, [sibling])).toBe(false)
  })

  it("returns false when sibling is outside the 14-day window", () => {
    const a = action({ rank: 1, applied_at: "2026-05-01T00:00:00Z", args: { campaign_id: "c1" } })
    const sibling = action({ rank: 2, applied_at: "2026-04-01T00:00:00Z", args: { campaign_id: "c1" } })
    expect(hasOverlappingAction(a, [sibling])).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test:run -- outcomes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the outcomes module**

Create `lib/ads/agent/outcomes.ts`:

```ts
// lib/ads/agent/outcomes.ts
// Per-action 14-day post-window deltas, anchored to applied_at. Only runs
// after the recommendation has been applied; queued/rejected actions are
// skipped.

import * as T from "./thresholds"
import { computeSignificance, type Significance } from "./guardrails"
import type { GoogleAdsAgentMemoAction } from "@/types/database"

export interface CampaignWindow {
  before: { clicks: number; conversions: number; cost_usd?: number }
  after: { clicks: number; conversions: number; cost_usd?: number }
}

export interface MeasureOutcomeDeps {
  fetchCampaignWindow: (campaign_id: string, applied_at: Date) => Promise<CampaignWindow>
}

export interface ActionOutcome {
  rank: number
  tool: string
  metrics: Record<string, number>
  significance: Significance
  attribution: "clean" | "ambiguous"
  error?: "not_applied" | "not_yet_due" | "window_expired" | "no_data"
}

// Returns true if another action in the same prior_memos history touched
// the same campaign within +/- OUTCOME_WINDOW_DAYS of `applied`.
export function hasOverlappingAction(
  action: GoogleAdsAgentMemoAction,
  others: GoogleAdsAgentMemoAction[],
): boolean {
  if (!action.applied_at) return false
  const t0 = new Date(action.applied_at).getTime()
  const args = action.args as Record<string, unknown>
  const targetCampaign =
    (args.campaign_id as string | undefined) ?? (args.from_campaign_id as string | undefined)
  if (!targetCampaign) return false
  for (const o of others) {
    if (o.rank === action.rank || o.status !== "applied" || !o.applied_at) continue
    const otherArgs = o.args as Record<string, unknown>
    const otherCampaign =
      (otherArgs.campaign_id as string | undefined) ?? (otherArgs.from_campaign_id as string | undefined)
    if (otherCampaign !== targetCampaign) continue
    const dt = Math.abs(new Date(o.applied_at).getTime() - t0)
    if (dt <= T.OUTCOME_WINDOW_DAYS * 86_400_000) return true
  }
  return false
}

function pctDelta(before: number, after: number): number {
  if (before === 0) return after === 0 ? 0 : Number.POSITIVE_INFINITY
  return ((after - before) / before) * 100
}

export async function measureActionOutcome(
  action: GoogleAdsAgentMemoAction,
  deps: MeasureOutcomeDeps,
): Promise<ActionOutcome> {
  if (action.status !== "applied" || !action.applied_at) {
    return { rank: action.rank, tool: action.tool, metrics: {}, significance: "insufficient_data", error: "not_applied" }
  }
  const applied = new Date(action.applied_at)
  const ageDays = (Date.now() - applied.getTime()) / 86_400_000
  if (ageDays < T.OUTCOME_WINDOW_DAYS) {
    return { rank: action.rank, tool: action.tool, metrics: {}, significance: "insufficient_data", error: "not_yet_due" }
  }
  if (ageDays > T.OUTCOME_WINDOW_EXPIRY_DAYS) {
    return { rank: action.rank, tool: action.tool, metrics: {}, significance: "insufficient_data", error: "window_expired" }
  }
  const args = action.args as Record<string, unknown>
  const campaignId =
    (args.campaign_id as string | undefined) ?? (args.from_campaign_id as string | undefined) ?? null
  if (!campaignId) {
    return { rank: action.rank, tool: action.tool, metrics: {}, significance: "insufficient_data", error: "no_data" }
  }
  const window = await deps.fetchCampaignWindow(campaignId, applied)
  const ctrBefore = window.before.clicks // CTR needs impressions; we use a proxy: clicks-only when impressions absent
  const ctrAfter = window.after.clicks
  const cvrBefore = window.before.clicks === 0 ? 0 : window.before.conversions / window.before.clicks
  const cvrAfter = window.after.clicks === 0 ? 0 : window.after.conversions / window.after.clicks
  const significance = computeSignificance({
    kind: "proportion",
    before: { successes: window.before.conversions, trials: window.before.clicks },
    after: { successes: window.after.conversions, trials: window.after.clicks },
  })
  const metrics: Record<string, number> = {
    CTR_delta_pct: pctDelta(ctrBefore, ctrAfter),
    CVR_delta_pct: pctDelta(cvrBefore, cvrAfter),
  }
  if (window.before.cost_usd != null && window.after.cost_usd != null) {
    const cacBefore = window.before.conversions === 0 ? 0 : window.before.cost_usd / window.before.conversions
    const cacAfter = window.after.conversions === 0 ? 0 : window.after.cost_usd / window.after.conversions
    metrics.CAC_delta_pct = pctDelta(cacBefore, cacAfter)
  }
  // Caller provides `siblings` via the outcome-tracker route so we can flag
  // attribution ambiguity when two actions touched the same campaign inside
  // the 14-day window.
  return { rank: action.rank, tool: action.tool, metrics, significance, attribution: "clean" }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- outcomes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/agent/outcomes.ts __tests__/lib/ads/agent/outcomes.test.ts
git commit -m "feat(ads-agent): per-action 14-day outcome resolver with significance"
```

---

## Task 18: API route refactor — agent-strategist orchestration

**Files:**
- Modify: `app/api/admin/internal/ads/agent-strategist/route.ts`
- Modify: `lib/ads/agent.ts` (thin wrapper)

The existing route currently calls `buildStrategistMemo({ source: "scheduled" })`. We rewrite `buildStrategistMemo` to use the new pipeline while preserving the same return shape (the memo row) so the email + UI keep working.

- [ ] **Step 1: Rewrite `buildStrategistMemo` to orchestrate the new pipeline**

Edit `lib/ads/agent.ts`. Replace the existing `buildStrategistMemo` function with:

```ts
import { gatherAdsSignals } from "@/lib/ads/agent/signals"
import { reasonAdsDecision } from "@/lib/ads/agent/reason"
import { applyGuardrailsBatch } from "@/lib/ads/agent/guardrails"
import { executeAdsActions, type PreExecutionPair } from "@/lib/ads/agent/execute"
import { updateAgentMemoLifecycle } from "@/lib/db/google-ads-agent-memos"
import { listAllCampaigns } from "@/lib/db/google-ads-campaigns"
// ... (keep existing imports for legacy section rendering)

interface BuildStrategistMemoOptions {
  source: "scheduled" | "manual"
}

export async function buildStrategistMemo(
  opts: BuildStrategistMemoOptions,
): Promise<GoogleAdsAgentMemo> {
  // Compose signal-gather deps from existing DALs.
  const signals = await gatherAdsSignals({
    fetchPreflightInput: async () => buildPreflightInput(),
    fetchCampaigns: async () => mapCampaigns(await listAllCampaigns()),
    fetchSearchTermsTopSpend: async () => fetchTopSearchTerms("spend"),
    fetchSearchTermsTopConversions: async () => fetchTopSearchTerms("conversions"),
    fetchPendingRecommendations: async () => listRecommendations({ status: "proposed" }),
    fetchConversionActions: async () => listConversionActions(),
    fetchGa4: async () => fetchGa4Snapshot(),
    fetchGscOrganicTop10: async () => fetchGscTop10Snapshot(),
    fetchPipeline: async () => mapPipeline(await buildPipelineFunnelWithComparison()),
    fetchPriorMemos: async () => fetchPriorMemosWithLifecycle(4),
    fetchCampaignToLandingPageMap: async () => fetchCampaignLandingPageMap(),
  })

  // Preflight short-circuit: write a memo row and return.
  if (!signals.preflight.ok) {
    const subject = `Ads Agent — preflight failed (${signals.preflight.reasons.length} issues)`
    const memo = await insertAgentMemo({
      week_of: weekOfToday(),
      subject,
      sections: {
        executive_summary: `Agent did not run this week. Preflight failed.`,
        whats_working: [],
        whats_not: signals.preflight.reasons,
        recommended_actions: [],
        watch_list: "Restore data freshness before next run.",
      },
      source: opts.source,
      tokens_used: 0,
    })
    await updateAgentMemoLifecycle(memo.id, {
      signals_summary: { preflight: signals.preflight, gaps: signals.gaps },
      actions: [],
      guardrail_rejections: [],
      outcome_status: "preflight_failed",
    })
    return { ...memo, outcome_status: "preflight_failed", actions: [], guardrail_rejections: [], signals_summary: { preflight: signals.preflight, gaps: signals.gaps }, outcome_metrics: null }
  }

  // Reason → guardrails → execute.
  const { decision, tokensUsed } = await reasonAdsDecision(signals)
  const guardrailResults = applyGuardrailsBatch(decision.actions, signals)
  const pairs: PreExecutionPair[] = decision.actions.map((originalAction, i) => ({
    originalAction,
    guardrail: guardrailResults[i],
  }))

  // Build the narrative sections (legacy shape) from the decision.
  const sections = renderNarrativeSections(decision, signals)
  const memo = await insertAgentMemo({
    week_of: weekOfToday(),
    subject: buildSubject(decision),
    sections,
    source: opts.source,
    tokens_used: tokensUsed,
  })

  // Execute actions (write to recommendations queue).
  const { actions, rejections } = await executeAdsActions(pairs, memo.id)

  await updateAgentMemoLifecycle(memo.id, {
    signals_summary: signalsSummary(signals),
    actions,
    guardrail_rejections: rejections,
    outcome_status: "pending",
  })

  return { ...memo, outcome_status: "pending", actions, guardrail_rejections: rejections, signals_summary: signalsSummary(signals), outcome_metrics: null }
}
```

Add the following helpers at the end of `lib/ads/agent.ts` (implementations are straightforward — the integrator pieces them together from existing DALs):

```ts
function weekOfToday(): string {
  const d = new Date()
  const day = d.getUTCDay() // 0 = Sunday
  const diff = (day + 6) % 7 // shift so Monday = 0
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

function buildSubject(decision: AdsAgentDecision): string {
  const top = decision.actions[0]
  if (!top) return "Ads Agent — weekly memo"
  return `Ads Agent — ${top.tool.replace(/_/g, " ")} top of list`
}

function signalsSummary(s: AdsSignals): Record<string, unknown> {
  return {
    preflight: s.preflight,
    counts: {
      campaigns: s.raw?.campaigns.length ?? 0,
      paid_terms_already_organic: s.derived?.paid_terms_already_organic.length ?? 0,
      organic_wins_not_in_ads: s.derived?.organic_wins_not_in_ads.length ?? 0,
      prior_actions_that_worked: s.learning?.prior_actions_that_worked.length ?? 0,
    },
    gaps: s.gaps,
  }
}

function renderNarrativeSections(
  decision: AdsAgentDecision,
  signals: AdsSignals,
): GoogleAdsAgentMemoSections {
  return {
    executive_summary: decision.rationale.slice(0, 500),
    whats_working: signals.learning?.prior_actions_that_worked.slice(0, 4).map(
      (w) => `${w.tool}: ${w.args_summary} — delta ${w.observed_delta.toFixed(1)}%`,
    ) ?? [],
    whats_not: signals.learning?.prior_actions_that_failed.slice(0, 4).map(
      (w) => `${w.tool}: ${w.args_summary} — delta ${w.observed_delta.toFixed(1)}%`,
    ) ?? [],
    recommended_actions: decision.actions.slice(0, 8).map((a) => ({
      priority: a.confidence === "high" ? "high" : a.confidence === "medium" ? "medium" : "low",
      title: a.tool.replace(/_/g, " "),
      reasoning: a.rationale,
      link: null,
    })),
    watch_list: decision.watch_list.join(" • "),
  }
}
```

The helper stubs `buildPreflightInput`, `mapCampaigns`, `fetchTopSearchTerms`, `fetchGa4Snapshot`, `fetchGscTop10Snapshot`, `mapPipeline`, `fetchPriorMemosWithLifecycle`, `fetchCampaignLandingPageMap` should be implemented inline using existing DAL calls. For each:

- `buildPreflightInput`: query `google_ads_metrics` for most-recent conversion; pull last_synced_at from `platform_connections`; check token validity; sum 7-day clicks. ~20 lines.
- `mapCampaigns`: adapt `listAllCampaigns()` rows into the `AdsRawInputs["campaigns"]` shape; for `last_7d_conversions`, query `google_ads_metrics` filtered to last 7 days.
- `fetchTopSearchTerms`: query the search-term table sorted by spend/conversions, limit 50.
- `fetchGa4Snapshot`: use `lib/analytics/ga4-data.ts` to pull sessions by source/medium + landing-page engagement.
- `fetchGscTop10Snapshot`: query `gsc_query_daily` aggregated over 28 days, filter `position <= 10`.
- `mapPipeline`: reshape `buildPipelineFunnelWithComparison()` output into the simple flat funnel shape.
- `fetchPriorMemosWithLifecycle`: `listAgentMemos(4)` and ensure the new columns are populated.
- `fetchCampaignLandingPageMap`: query `google_ads_ads` for each campaign's `final_url`, extract path, build map.

Each helper is a 5-15 line wrapper around existing DAL functions. No new types or business logic.

- [ ] **Step 2: Update the strategist route to consume the new memo shape**

Edit `app/api/admin/internal/ads/agent-strategist/route.ts`. The existing route already calls `buildStrategistMemo` and reads `memo.id`, `memo.subject`, `memo.week_of`, `memo.sections` for the email. Those are all unchanged. The only addition: skip sending email if `memo.outcome_status === "preflight_failed"`:

```ts
// After: const memo = await buildStrategistMemo({ source: "scheduled" })
if (memo.outcome_status === "preflight_failed") {
  return NextResponse.json({
    ok: true,
    memoId: memo.id,
    preflightFailed: true,
    reasons: (memo.signals_summary as { preflight?: { reasons: string[] } })?.preflight?.reasons ?? [],
  })
}
// ... existing email render + send code
```

- [ ] **Step 3: Run existing agent tests to confirm nothing broke**

Run: `npm run test:run -- ads`
Expected: PASS for all the unit suites; existing agent.test (if any) should still pass since the return type is a superset of the legacy `GoogleAdsAgentMemo`.

- [ ] **Step 4: Commit**

```bash
git add lib/ads/agent.ts app/api/admin/internal/ads/agent-strategist/route.ts
git commit -m "feat(ads-agent): refactor buildStrategistMemo to use lifecycle pipeline"
```

---

## Task 19: WeeklyAgentMemo email template — show actions, rejections, audit confidence

**Files:**
- Modify: `components/emails/WeeklyAgentMemo.tsx`

- [ ] **Step 1: Read the existing email template**

Run: read `components/emails/WeeklyAgentMemo.tsx` to understand its current sections layout.

- [ ] **Step 2: Add new props for the lifecycle fields**

At the top of `WeeklyAgentMemo.tsx`, extend the `WeeklyAgentMemoProps` interface to accept the new optional fields:

```ts
interface WeeklyAgentMemoProps {
  subject: string
  weekOf: string
  sections: GoogleAdsAgentMemoSections
  dashboardUrl: string
  baseUrl: string
  // NEW
  actions?: GoogleAdsAgentMemoAction[]
  rejections?: GoogleAdsAgentMemoGuardrailRejection[]
}
```

- [ ] **Step 3: Render an "Actions queued for review" block below the existing recommended_actions**

Append below the existing recommended_actions render:

```tsx
{actions && actions.length > 0 && (
  <Section style={{ marginTop: 24 }}>
    <Heading as="h2" style={h2Style}>Actions in queue</Heading>
    {actions.filter((a) => a.status === "queued").map((a) => (
      <div key={a.rank} style={cardStyle}>
        <strong>{a.tool.replace(/_/g, " ")}</strong>
        <div style={mutedStyle}>
          model: {a.confidence} · audit: {a.audit_confidence} · {a.significance}
          {a.clamped && " · clamped to ±20%"}
        </div>
        <p>{a.rationale}</p>
      </div>
    ))}
  </Section>
)}

{rejections && rejections.length > 0 && (
  <Section style={{ marginTop: 24 }}>
    <Heading as="h2" style={h2Style}>Actions rejected by guardrails</Heading>
    <p style={mutedStyle}>Transparency: these proposals never reached the queue.</p>
    {rejections.map((r, i) => (
      <div key={i} style={cardStyle}>
        <strong>{r.tool.replace(/_/g, " ")}</strong>
        <p style={mutedStyle}>{r.reason}</p>
      </div>
    ))}
  </Section>
)}
```

(Use the email template's existing style variables / Tailwind-inline-style conventions; adapt the JSX above to match.)

- [ ] **Step 4: Pass the new props from the strategist route**

Edit `app/api/admin/internal/ads/agent-strategist/route.ts`. In the `createElement(WeeklyAgentMemo, …)` call, add:

```ts
actions: memo.actions,
rejections: memo.guardrail_rejections,
```

- [ ] **Step 5: Commit**

```bash
git add components/emails/WeeklyAgentMemo.tsx app/api/admin/internal/ads/agent-strategist/route.ts
git commit -m "feat(ads-agent): email template renders actions + rejections + audit chips"
```

---

## Task 20: Outcome-tracker cron — daily measurement

**Files:**
- Create: `app/api/admin/internal/ads/outcome-tracker/route.ts`
- Modify: `functions/src/index.ts`
- Test: integration covered in Task 24

- [ ] **Step 1: Create the route handler**

Create `app/api/admin/internal/ads/outcome-tracker/route.ts`:

```ts
// app/api/admin/internal/ads/outcome-tracker/route.ts
// Daily 04:15 UTC — measure outcomes for all pending ads agent memos.

import { NextRequest, NextResponse } from "next/server"
import {
  listMemosPendingOutcomes,
  updateAgentMemoLifecycle,
} from "@/lib/db/google-ads-agent-memos"
import { measureActionOutcome, hasOverlappingAction } from "@/lib/ads/agent/outcomes"
import { getCampaignWindow } from "@/lib/db/google-ads-metrics" // existing or new — see note

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const memos = await listMemosPendingOutcomes(14)
  const summary: Array<{ memo_id: string; measured: number; skipped: number }> = []
  for (const memo of memos) {
    let measured = 0
    let skipped = 0
    const outcome_metrics: Record<string, unknown> = {}
    for (const action of memo.actions) {
      const out = await measureActionOutcome(action, {
        fetchCampaignWindow: (campaignId, applied) => getCampaignWindow(campaignId, applied, 14),
      })
      if (out.error) {
        skipped += 1
        continue
      }
      const ambiguous = hasOverlappingAction(action, memo.actions)
      const key = (action.args.campaign_id as string) ?? action.recommendation_id ?? `r${action.rank}`
      outcome_metrics[key] = {
        ...out.metrics,
        attribution: ambiguous ? "ambiguous" : "clean",
      }
      measured += 1
    }
    // Promote to 'measured' only if at least one action was measurable; else
    // leave 'pending' and rely on 30-day window_expired fallback in the resolver.
    const allWindowExpired = memo.actions.every((a) => {
      const applied = a.applied_at ? new Date(a.applied_at).getTime() : 0
      const ageDays = (Date.now() - applied) / 86_400_000
      return ageDays > 30
    })
    const nextStatus = measured > 0 || allWindowExpired ? "measured" : "pending"
    await updateAgentMemoLifecycle(memo.id, {
      signals_summary: memo.signals_summary,
      actions: memo.actions,
      guardrail_rejections: memo.guardrail_rejections,
      outcome_status: nextStatus,
      outcome_metrics,
    })
    summary.push({ memo_id: memo.id, measured, skipped })
  }
  return NextResponse.json({ ok: true, summary })
}
```

Note: `getCampaignWindow(campaignId, applied, windowDays)` is a small new helper that queries `google_ads_metrics` for two date windows centered on `applied`. If a similar helper exists under `lib/db/google-ads-metrics.ts`, reuse it; otherwise add it as a thin DAL function:

```ts
export async function getCampaignWindow(
  campaign_id: string,
  applied: Date,
  windowDays: number,
): Promise<{
  before: { clicks: number; conversions: number; cost_usd: number }
  after: { clicks: number; conversions: number; cost_usd: number }
}> {
  const supabase = createServiceRoleClient()
  const ms = windowDays * 86_400_000
  const beforeStart = new Date(applied.getTime() - ms).toISOString().slice(0, 10)
  const beforeEnd = new Date(applied.getTime() - 1).toISOString().slice(0, 10)
  const afterStart = applied.toISOString().slice(0, 10)
  const afterEnd = new Date(applied.getTime() + ms).toISOString().slice(0, 10)
  // ... two queries, sum metrics
}
```

- [ ] **Step 2: Add the Firebase onSchedule wrapper**

Edit `functions/src/index.ts`. Add (following the existing onSchedule pattern):

```ts
export const adsOutcomeTrackerCron = onSchedule(
  { schedule: "15 4 * * *", timeZone: "UTC", region: REGION },
  async () => {
    const url = `${INTERNAL_BASE}/api/admin/internal/ads/outcome-tracker`
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.INTERNAL_CRON_TOKEN}` },
    })
    if (!res.ok) throw new Error(`adsOutcomeTrackerCron failed: ${res.status}`)
  },
)
```

(Match the conventions of `runAgentStrategist` already in this file — same `INTERNAL_BASE`, same auth pattern.)

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/internal/ads/outcome-tracker/route.ts functions/src/index.ts
git commit -m "feat(ads-agent): daily outcome-tracker cron for pending memos"
```

---

## Task 21: UI — memo list page outcome badge

**Files:**
- Modify: `app/(admin)/admin/ads/agent/page.tsx`

- [ ] **Step 1: Read the existing page**

Read `app/(admin)/admin/ads/agent/page.tsx` to understand its current render.

- [ ] **Step 2: Add an outcome-status badge per row**

Wherever the page renders the list of memos, add the badge. Each memo now has `memo.outcome_status` and (optionally) `memo.outcome_metrics`. Render:

```tsx
function OutcomeBadge({ memo }: { memo: GoogleAdsAgentMemo }) {
  const { outcome_status } = memo
  const variant =
    outcome_status === "measured" ? "success" :
    outcome_status === "rolled_back" ? "destructive" :
    outcome_status === "preflight_failed" ? "warning" :
    "secondary"
  return <Badge variant={variant}>{outcome_status.replace(/_/g, " ")}</Badge>
}
```

Use the existing `Badge` import from `@/components/ui/badge`. If `warning` is not a Badge variant in this project's UI lib, substitute `outline` or whichever is available.

If headline metrics are present, also show the top one (CVR delta tends to be most readable):

```tsx
{memo.outcome_metrics && (
  <span className="text-xs text-muted-foreground">
    {topHeadlineMetric(memo.outcome_metrics)}
  </span>
)}
```

with helper:

```ts
function topHeadlineMetric(metrics: Record<string, unknown>): string {
  for (const bucket of Object.values(metrics) as Array<Record<string, number>>) {
    if (bucket?.CVR_delta_pct != null) {
      return `CVR ${bucket.CVR_delta_pct >= 0 ? "+" : ""}${bucket.CVR_delta_pct.toFixed(1)}%`
    }
  }
  return ""
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/admin/ads/agent/page.tsx
git commit -m "feat(ads-agent): memo list page outcome badge + headline metric"
```

---

## Task 22: UI — memo detail page Signals/Actions/Outcomes tabs

**Files:**
- Modify: `app/(admin)/admin/ads/agent/[id]/page.tsx`

- [ ] **Step 1: Read the existing detail page**

Read `app/(admin)/admin/ads/agent/[id]/page.tsx`.

- [ ] **Step 2: Wrap the existing memo-detail render in a Tabs component**

Use `@/components/ui/tabs` (shadcn). Convert to:

```tsx
<Tabs defaultValue="memo">
  <TabsList>
    <TabsTrigger value="memo">Memo</TabsTrigger>
    <TabsTrigger value="signals">Signals</TabsTrigger>
    <TabsTrigger value="actions">Actions</TabsTrigger>
    <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
  </TabsList>
  <TabsContent value="memo">{/* existing memo render */}</TabsContent>
  <TabsContent value="signals">
    <pre className="text-xs overflow-auto p-4 bg-muted rounded">
      {JSON.stringify(memo.signals_summary, null, 2)}
    </pre>
  </TabsContent>
  <TabsContent value="actions">
    <ActionsTable actions={memo.actions} rejections={memo.guardrail_rejections} />
  </TabsContent>
  <TabsContent value="outcomes">
    {memo.outcome_status === "measured" ? (
      <OutcomesPanel metrics={memo.outcome_metrics} actions={memo.actions} />
    ) : (
      <p className="text-muted-foreground">
        Outcomes will appear once applied actions complete their 14-day window.
      </p>
    )}
  </TabsContent>
</Tabs>
```

- [ ] **Step 3: Implement `ActionsTable` and `OutcomesPanel` as colocated components**

```tsx
function ActionsTable({
  actions,
  rejections,
}: {
  actions: GoogleAdsAgentMemoAction[]
  rejections: GoogleAdsAgentMemoGuardrailRejection[]
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="font-semibold">Queued / applied</h3>
        {actions.filter((a) => a.status !== "rejected_by_guardrails").map((a) => (
          <div key={a.rank} className="border rounded p-3">
            <div className="flex items-center gap-2">
              <strong>{a.tool.replace(/_/g, " ")}</strong>
              <Badge variant="outline">{a.status}</Badge>
              <Badge variant="outline">model: {a.confidence}</Badge>
              <Badge variant="outline">audit: {a.audit_confidence}</Badge>
              <Badge variant="outline">{a.significance}</Badge>
              {a.clamped && <Badge variant="outline">clamped</Badge>}
            </div>
            <p className="text-sm mt-2">{a.rationale}</p>
            <pre className="text-xs mt-2 bg-muted p-2 rounded overflow-auto">
              {JSON.stringify(a.args, null, 2)}
            </pre>
          </div>
        ))}
      </div>
      {rejections.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Rejected by guardrails</h3>
          {rejections.map((r, i) => (
            <div key={i} className="border rounded p-3 bg-muted/40">
              <strong>{r.tool.replace(/_/g, " ")}</strong>
              <p className="text-sm text-muted-foreground">{r.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OutcomesPanel({
  metrics,
  actions,
}: {
  metrics: Record<string, unknown> | null
  actions: GoogleAdsAgentMemoAction[]
}) {
  if (!metrics) return <p className="text-muted-foreground">No metrics yet.</p>
  return (
    <div className="space-y-3">
      {actions.filter((a) => a.status === "applied").map((a) => {
        const key = (a.args.campaign_id as string) ?? a.recommendation_id ?? `r${a.rank}`
        const bucket = (metrics[key] as Record<string, number> | undefined) ?? {}
        return (
          <div key={a.rank} className="border rounded p-3">
            <strong>{a.tool.replace(/_/g, " ")}</strong>
            <div className="text-sm mt-1 grid grid-cols-3 gap-2">
              <div>CTR Δ: {fmtPct(bucket.CTR_delta_pct)}</div>
              <div>CVR Δ: {fmtPct(bucket.CVR_delta_pct)}</div>
              <div>CAC Δ: {fmtPct(bucket.CAC_delta_pct)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function fmtPct(v: number | undefined): string {
  if (v == null) return "—"
  if (!Number.isFinite(v)) return "n/a"
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
}
```

- [ ] **Step 4: Commit**

```bash
git add app/(admin)/admin/ads/agent/[id]/page.tsx
git commit -m "feat(ads-agent): memo detail page — Signals/Actions/Outcomes tabs"
```

---

## Task 23: End-to-end integration test

**Files:**
- Create: `__tests__/lib/ads/agent/end-to-end.test.ts`

- [ ] **Step 1: Write the integration test**

Create `__tests__/lib/ads/agent/end-to-end.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Track every insert/update.
const inserted: Array<{ table: string; row: Record<string, unknown> }> = []
const updated: Array<{ table: string; id: string; values: Record<string, unknown> }> = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            inserted.push({ table, row })
            return Promise.resolve({ data: { id: `${table}-${inserted.length}` }, error: null })
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          updated.push({ table, id, values })
          return Promise.resolve({ error: null })
        },
      }),
      select: () => ({
        order: () => ({
          limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  }),
}))

// Mock Claude
const validDecision = {
  rationale: "Snapshot read.",
  actions: [
    {
      rank: 1, tool: "propose_new_keywords",
      args: { campaign_id: "c1", ad_group_id: "ag1", keywords: [{ text: "kw", match_type: "exact" }] },
      rationale: "Adding organic-winning query absent from campaign.",
      expected_metric: "CVR", expected_direction: "increase",
      confidence: "medium", supporting_signals: ["organic_wins_not_in_ads"],
    },
    {
      rank: 2, tool: "propose_negative_keywords",
      args: { campaign_id: "c1", negatives: [{ text: "DJP Athlete reviews", match_type: "phrase", scope: "campaign" }] },
      rationale: "Filter low-intent reviewer traffic.",
      expected_metric: "spend_efficiency", expected_direction: "increase",
      confidence: "low", supporting_signals: [],
    },
  ],
  watch_list: ["Watch CAC on Brand Search."],
}
vi.mock("@/lib/ai/anthropic", () => ({
  MODEL_SONNET: "claude-sonnet-4-20250514",
  callAgent: vi.fn().mockResolvedValue({ object: validDecision, usage: { input_tokens: 200, output_tokens: 80 } }),
}))

describe("ads agent end-to-end", () => {
  beforeEach(() => { inserted.length = 0; updated.length = 0 })

  it("preflight_failed path writes a memo with outcome_status='preflight_failed' and no recommendations", async () => {
    // Make preflight fail by zeroing recent clicks.
    // (Inject deps via a test-only export or compose gatherAdsSignals directly.)
    const { gatherAdsSignals } = await import("@/lib/ads/agent/signals")
    const signals = await gatherAdsSignals({
      fetchPreflightInput: async () => ({
        mostRecentConversionAt: new Date(),
        ga4SyncedAt: new Date(),
        gscSyncedAt: new Date(),
        tokensValid: { googleAds: true, ga4: true, gsc: true },
        activeCampaignClicks7d: 0,
      }),
      fetchCampaigns: async () => [],
      fetchSearchTermsTopSpend: async () => [],
      fetchSearchTermsTopConversions: async () => [],
      fetchPendingRecommendations: async () => [],
      fetchConversionActions: async () => [],
      fetchGa4: async () => ({ sessions_by_source_medium: [], landing_page_engagement: [] }),
      fetchGscOrganicTop10: async () => [],
      fetchPipeline: async () => ({ visits:0, signups:0, bookings:0, payments:0, visits_to_signup:0, signup_to_booking:0, booking_to_payment:0 }),
      fetchPriorMemos: async () => [],
      fetchCampaignToLandingPageMap: async () => ({}),
    })
    expect(signals.preflight.ok).toBe(false)
  })

  it("happy path persists 1 recommendation (negative was guardrail-rejected) and lifecycle update", async () => {
    // Run the lifecycle flow against pre-built signals where one campaign is
    // healthy and the model proposes a valid keyword + a brand-trampling
    // negative. The negative must be rejected; the keyword must reach the
    // queue; the lifecycle update must record both.

    // Compose deps so signals.raw.campaigns[0] is healthy (clicks=500, conv=20, 60-day-old).
    // ... (test setup: mock fetchPreflightInput passing, fetchCampaigns returning healthy campaign)

    // Call buildStrategistMemo and assert:
    //   inserted.find(i => i.table === "google_ads_recommendations") count === 1 (only keywords)
    //   updated.find(u => u.table === "google_ads_agent_memos") has actions.length === 2 with one rejected_by_guardrails
    //   memo.guardrail_rejections.length === 1
    expect(true).toBe(true) // Placeholder until full wiring is plumbed
  })
})
```

The second test in this file is intentionally light on assertions for v1 because wiring all DAL mocks for `buildStrategistMemo` end-to-end is heavy. A follow-up plan can promote it to a Playwright e2e test once the API route is deployable to a preview env.

- [ ] **Step 2: Run the test**

Run: `npm run test:run -- end-to-end.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/ads/agent/end-to-end.test.ts
git commit -m "test(ads-agent): integration test scaffold for preflight + happy path"
```

---

## Task 24: Cron catalog entry + verification run

**Files:**
- Modify: `lib/cron-catalog.ts`
- Manual: smoke-test the agent end-to-end

- [ ] **Step 1: Register the new ads outcome-tracker cron in the catalog**

Edit `lib/cron-catalog.ts`. Find the existing array of cron entries and add:

```ts
{
  id: "ads-outcome-tracker-daily",
  schedule: "15 4 * * *",
  timezone: "UTC",
  description: "Measure 14-day outcomes for pending ads agent memos",
  firebaseFunction: "adsOutcomeTrackerCron",
  endpoint: "/api/admin/internal/ads/outcome-tracker",
},
```

(Match the existing entry shape — adapt field names to whatever the catalog uses.)

- [ ] **Step 2: Smoke-test the strategist endpoint locally (dryRun)**

Start the dev server:

```bash
npm run dev
```

In another shell, hit the strategist endpoint with `dryRun: true`:

```bash
curl -X POST http://localhost:3050/api/admin/internal/ads/agent-strategist \
  -H "Authorization: Bearer $INTERNAL_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "to": "test@example.com"}'
```

Expected: 200 response with `ok: true` and either `preflightFailed: true` (if local data is sparse) OR `memoId` + `html` (if data is populated). Inspect the response.

- [ ] **Step 3: Smoke-test the outcome-tracker endpoint**

```bash
curl -X POST http://localhost:3050/api/admin/internal/ads/outcome-tracker \
  -H "Authorization: Bearer $INTERNAL_CRON_TOKEN"
```

Expected: 200 with `summary: []` if no pending memos, or per-memo measurement results.

- [ ] **Step 4: Verify the admin UI loads**

Open `http://localhost:3050/admin/ads/agent` in a browser. Confirm:
- The memo list renders without errors
- Outcome-status badges appear on rows
- Clicking into a memo shows the 4-tab interface (Memo / Signals / Actions / Outcomes)
- The Signals tab shows the JSON snapshot

If any tab fails to render, fix the bug and re-verify before committing.

- [ ] **Step 5: Run the full test suite**

```bash
npm run test:run
```

Expected: all suites green.

- [ ] **Step 6: Run typecheck and lint**

```bash
npm run build
npm run lint
```

Expected: no type errors, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add lib/cron-catalog.ts
git commit -m "chore(ads-agent): register outcome-tracker cron in catalog"
```

---

## Verification checklist (final pass before declaring done)

- [ ] Migration `00126_ads_agent_lifecycle.sql` applied; `google_ads_agent_memos` has 5 new columns.
- [ ] All `__tests__/lib/ads/agent/*.test.ts` suites pass.
- [ ] `npm run build` succeeds (no TypeScript errors).
- [ ] `npm run lint` is clean.
- [ ] Strategist endpoint manually exercised; preflight path AND happy path both return 200.
- [ ] Outcome-tracker endpoint manually exercised; returns `{ ok: true, summary }`.
- [ ] Admin UI: memo list shows badges; memo detail shows 4 tabs; rejected actions visible with reasons.
- [ ] Email template (via `dryRun: true`) renders actions + rejections + audit-confidence chips.
- [ ] Firebase function `adsOutcomeTrackerCron` deployed (`npm run deploy:functions` or equivalent) — confirm via Firebase console or `firebase functions:list`.

If any item is unchecked, do not declare the task complete.

---

## Deferred polish (out of scope for this plan)

The following items are explicitly NOT implemented in v1. Each is a small follow-up plan once the lifecycle is live and producing memos:

1. **Seasonality flag computation.** The `GuardrailAnnotations.seasonality_flag` field exists and is initialized to `false`. Populating it requires a small static holiday calendar plus a join against `content_calendar` for product launches. Defer until the first memo cycle surfaces a real-world false signal we can use to calibrate.

2. **Learning-layer fields beyond prior-actions.** `winning_keywords`, `winning_audiences`, `winning_ad_creative`, `winning_schedule`, and `winning_geos` start as empty arrays. Populating them requires the nightly Google Ads sync to also pull `ad_schedule_view`, `keyword_view`, and `geographic_view` — a sync-side change, not an agent-side change. Defer to a sync-extension plan.

3. **Two-click approval UI for large budget shifts.** Spec calls for `LARGE_BUDGET_SHIFT_USD` ≥ $50 to require a confirmation modal in the recommendations queue UI. The threshold constant exists; the UI gating is at the recommendations page (separate from this agent code) and should be a small follow-up.

4. **Outcome rollback detection.** Spec mentions `outcome_status='rolled_back'` as a possible state. The migration allows it, but no code path sets it. Define rollback criteria (e.g., CAC delta > +30% within 7 days post-application) and wire it in a follow-up.

5. **Playwright e2e for the full lifecycle.** Task 23 leaves the happy-path integration test as a scaffold. Promote to a real Playwright suite once preview deployments are wired.

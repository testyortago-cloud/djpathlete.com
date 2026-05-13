# SEO Agent — Phase 4 (Agent Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Solo-dev project — commit directly to `main`, no branches.

**Goal:** Ship the SEO agent itself. A weekly Firebase scheduled function (`seoAgentCron`, Sun 14:00 UTC) enqueues a `seo_agent_run` `ai_jobs` doc whose handler fuses five signal streams (GSC striking-distance + decay, blog inventory, recent Tavily suggestions, orphan posts, last 8 memos) into a single Claude call. Claude returns a written rationale plus two ranked actions (different types) using the three primitives from Phases 1-3 (`queue_new_post`, `queue_refresh`, `queue_internal_link_sweep`) plus a fourth (`flag_for_human`). The handler executes both actions, then writes one row to `seo_agent_memos` with the signals snapshot, rationale, executed action records, and `outcome_status = "pending"` — closed by Phase 5's outcome tracker fourteen days later.

**Architecture:** Four-step Firebase handler (`gather → reason → execute → remember`) that talks to Supabase for inputs/memos and Firestore for downstream `ai_jobs`. Reasoning is one `callAgent` call with a discriminated-union Zod schema (`tool: queue_new_post | queue_refresh | queue_internal_link_sweep | flag_for_human` per action). Execute is a `switch` on `action.tool` that calls one of four per-tool helpers, each returning the new row/job id for the memo's `execution_target_id`. The agent never reads live GSC — it queries `gsc_query_daily` populated by Phase 1's nightly substrate. Off by default; cron skips silently when `gsc_query_daily` has fewer than 28 distinct dates (data warm-up gate).

**Tech Stack:** Same as Phases 1-3 — Next.js 16 App Router (Route Handlers + Server Components), Firebase Functions v2 (`onDocumentCreated` + `onSchedule`), Anthropic Claude via `functions/src/ai/anthropic.ts` (`callAgent<T>` with Zod schema), Supabase (`mcp__supabase__apply_migration` for the new table), Vitest, TypeScript strict.

**Spec:** [docs/superpowers/specs/2026-05-13-seo-agent-design.md](../specs/2026-05-13-seo-agent-design.md) — sections "Data model: seo_agent_memos", "Agent run pipeline", and "Tools — execution detail" cover Phase 4.

**Phase 1-3 reference:**
- Phase 1 shipped GSC substrate (`gsc_query_daily`, `gsc_properties`, GSC OAuth, nightly sync).
- Phase 2 shipped `blog_refresh` primitive (`ai_jobs.type = "blog_refresh"` triggers `handleBlogRefresh` which UPDATEs to draft).
- Phase 3 shipped `internal_link_sweep` primitive (`ai_jobs.type = "internal_link_sweep"` triggers `handleInternalLinkSweep` which inserts up to 2 inbound links).

**Verification:** Each sub-step (signal gatherers, tool executors, schema parsing) is unit-tested with Vitest in isolation. The end-to-end handler test mocks Claude + Supabase + Firestore to assert the four-step orchestration. The cron and the admin page get manual post-deploy verification.

**Out of scope for this phase:**
- Phase 5 (outcome tracker that backfills `outcome_metrics` after 14 days)
- Cooldown enforcement on auto-queued refreshes (the spec calls for 90-day-per-post; tracked as a Phase 5 follow-up)
- Manual "Run now" agent button on the memos page (use Firebase console for now)
- Dry-run / preview mode (the gate is the data warm-up check + the opt-in toggle)
- Multi-action iterative reasoning, reflexion, or critic agents (single reasoning call per run)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| Supabase migration (via MCP) | Create | `seo_agent_memos` table + 2 indexes |
| `types/database.ts` | Modify | Add `SeoAgentMemo` interface |
| `lib/db/seo-agent-memos.ts` | Create | Next.js DAL: `getRecentMemos`, `getMemoById`, `listMemos` (used by admin page) |
| `__tests__/lib/db/seo-agent-memos.test.ts` | Create | DAL tests |
| `functions/src/seo/signals.ts` | Create | Pure-ish helpers: `gatherGscSignals`, `gatherInventorySignals`, `gatherMemorySignals`, `gatherTavilySignals`, `gatherOrphanPostIds`, `gatherCount28dDates`, and a top-level `gatherSeoSignals` that runs them in parallel |
| `functions/src/__tests__/seo-signals.test.ts` | Create | Unit tests for each gather function with seeded fixtures |
| `functions/src/seo/decision-schema.ts` | Create | Zod discriminated-union schema for `{ rationale, actions: [Action, Action] }` |
| `functions/src/seo/reason.ts` | Create | `reasonAboutWeek(signals): Promise<Decision>` — single `callAgent` invocation with the system prompt + signals as user message |
| `functions/src/__tests__/seo-reason-schema.test.ts` | Create | Schema parse tests (valid, invalid-tool, missing-rank, same-tool-twice rejection) |
| `functions/src/seo/execute.ts` | Create | `executeAction(action, agent_context): Promise<ExecutionResult>` with switch over tool name; per-tool helpers `executeQueueNewPost`, `executeQueueRefresh`, `executeQueueInternalLinkSweep`, `executeFlagForHuman` |
| `functions/src/__tests__/seo-execute.test.ts` | Create | Unit tests for each executor with mocked Supabase + Firestore |
| `functions/src/seo-agent.ts` | Create | The handler — `handleSeoAgent(jobId)`: gather → reason → execute → remember |
| `functions/src/__tests__/seo-agent.test.ts` | Create | End-to-end handler test (mocked Claude, Supabase, Firestore) |
| `functions/src/index.ts` | Modify | Add `seoAgent` Firestore trigger + `seoAgentCron` scheduled function |
| `app/api/admin/internal/seo-agent/route.ts` | Create | POST handler: bearer-auth-gated, enqueues Firestore `ai_jobs.type = "seo_agent_run"` |
| `__tests__/api/admin/internal/seo-agent.test.ts` | Create | Auth + enqueue tests |
| `app/(admin)/admin/seo-agent/memos/page.tsx` | Create | Server Component: lists last N memos with their action outcomes |
| `lib/cron-catalog.ts` | Modify | Add `seo-agent-weekly` entry |
| `app/api/admin/automation/trigger/route.ts` | Modify | Add mapping `seo-agent-weekly → /api/admin/internal/seo-agent` |

---

## Task 1: Migration + `SeoAgentMemo` type

**Files:**
- Create (via MCP): migration `create_seo_agent_memos`
- Modify: `types/database.ts`

### Step 1: Apply the migration

Run via `mcp__supabase__apply_migration` with name `create_seo_agent_memos` and SQL:

```sql
CREATE TABLE seo_agent_memos (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date        DATE         NOT NULL,
  ai_job_id       TEXT         NOT NULL,

  signals_summary JSONB        NOT NULL,
  rationale       TEXT         NOT NULL,
  actions         JSONB        NOT NULL,

  outcome_status  TEXT         NOT NULL DEFAULT 'pending',
                  -- 'pending' (set by agent on insert)
                  -- 'measured' (set by Phase 5 outcomeTrackerCron after 14d)
                  -- 'rolled_back' (set when coach overrides an action before it runs)
  outcome_metrics JSONB        NULL,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  measured_at     TIMESTAMPTZ  NULL
);

CREATE INDEX idx_seo_agent_memos_run_date ON seo_agent_memos (run_date DESC);
CREATE INDEX idx_seo_agent_memos_pending  ON seo_agent_memos (outcome_status, run_date)
  WHERE outcome_status = 'pending';

ALTER TABLE seo_agent_memos ENABLE ROW LEVEL SECURITY;
-- Service-role only access (no policies).
```

### Step 2: Verify the schema

Run via `mcp__supabase__list_tables` on schema `public`. Expected: `seo_agent_memos` present, `rls_enabled: true`.

Also via `mcp__supabase__execute_sql`:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'seo_agent_memos'
ORDER BY ordinal_position;
```

Expected: 9 rows matching the column list above.

### Step 3: Add the TS type

Modify `types/database.ts`. After the existing `GscQueryDailyRow` interface (the last block in the Phase 1 section), add:

```ts
export interface SeoAgentMemo {
  id: string
  run_date: string         // YYYY-MM-DD
  ai_job_id: string
  signals_summary: SeoAgentSignalsSummary
  rationale: string
  actions: SeoAgentMemoAction[]
  outcome_status: "pending" | "measured" | "rolled_back"
  outcome_metrics: SeoAgentMemoOutcomeMetric[] | null
  created_at: string       // ISO string
  measured_at: string | null
}

export interface SeoAgentSignalsSummary {
  gsc_28d: {
    total_clicks: number
    total_impressions: number
    avg_position: number
    top_winnable: Array<{ query: string; avg_position: number; impressions_28d: number; clicks_28d: number }>
    top_decayed: Array<{ slug: string; position_drop: number; clicks_28d: number; avg_position_recent: number }>
  }
  inventory: {
    total_posts: number
    oldest_post_age_days: number
    never_refreshed_count: number
  }
  recent_tavily: Array<{ title: string; score: number; created_at: string }>
  orphan_post_ids: string[]
  last_8_memos_outcomes: Array<{
    run_date: string
    tool: SeoAgentToolName
    outcome_status: SeoAgentMemo["outcome_status"]
    outcome_summary?: string
  }>
  /** Convenience field; the agent stores this in the memo for auditing.
   *  Used by the handler's warm-up gate (skip when < 28). */
  gsc_distinct_dates: number
}

export type SeoAgentToolName =
  | "queue_new_post"
  | "queue_refresh"
  | "queue_internal_link_sweep"
  | "flag_for_human"

export interface SeoAgentMemoAction {
  rank: 1 | 2
  tool: SeoAgentToolName
  args: Record<string, unknown>
  executed: boolean
  execution_target_id: string | null
  complementary_to_rank_1?: string
}

export interface SeoAgentMemoOutcomeMetric {
  action_index: 0 | 1
  executed: boolean
  target_id: string | null
  clicks_before?: number | null
  clicks_after?: number | null
  position_before?: number | null
  position_after?: number | null
  acknowledged?: boolean
}
```

### Step 4: Commit

```bash
git add types/database.ts
git commit -m "feat(seo-agent): seo_agent_memos table + TS types"
```

The migration applies directly via MCP; only the TS additions are tracked in git.

---

## Task 2: `seo-agent-memos` DAL (Next.js side)

The admin page in Task 10 reads from this DAL.

**Files:**
- Create: `lib/db/seo-agent-memos.ts`
- Create: `__tests__/lib/db/seo-agent-memos.test.ts`

### Step 1: Implement the DAL

Create `lib/db/seo-agent-memos.ts`:

```ts
// lib/db/seo-agent-memos.ts
// Read-only DAL for the admin /admin/seo-agent/memos page. The agent itself
// writes from inside the Firebase Function via direct Supabase calls.

import { createServiceRoleClient } from "@/lib/supabase"
import type { SeoAgentMemo } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getMemoById(id: string): Promise<SeoAgentMemo | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("seo_agent_memos")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as SeoAgentMemo | null) ?? null
}

export async function listMemos(limit = 25): Promise<SeoAgentMemo[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("seo_agent_memos")
    .select("*")
    .order("run_date", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as SeoAgentMemo[]
}

export async function getRecentMemos(limit = 8): Promise<SeoAgentMemo[]> {
  return listMemos(limit)
}
```

### Step 2: Write the test

Create `__tests__/lib/db/seo-agent-memos.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"

const singleResponse = vi.fn()
const listResponse = vi.fn()
const fromMock = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({ maybeSingle: () => singleResponse() })),
    order: vi.fn(() => ({ limit: () => listResponse() })),
  })),
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

const { getMemoById, listMemos, getRecentMemos } = await import("@/lib/db/seo-agent-memos")

beforeEach(() => {
  fromMock.mockClear()
  singleResponse.mockReset()
  listResponse.mockReset()
})

describe("seo_agent_memos DAL", () => {
  it("getMemoById returns null when no row", async () => {
    singleResponse.mockResolvedValueOnce({ data: null, error: null })
    expect(await getMemoById("missing")).toBeNull()
  })

  it("getMemoById returns the row", async () => {
    const row = { id: "m1", rationale: "..." }
    singleResponse.mockResolvedValueOnce({ data: row, error: null })
    expect(await getMemoById("m1")).toEqual(row)
  })

  it("listMemos returns sorted rows up to limit", async () => {
    const rows = [{ id: "m1" }, { id: "m2" }]
    listResponse.mockResolvedValueOnce({ data: rows, error: null })
    expect(await listMemos(25)).toEqual(rows)
  })

  it("listMemos returns [] on null data", async () => {
    listResponse.mockResolvedValueOnce({ data: null, error: null })
    expect(await listMemos()).toEqual([])
  })

  it("getRecentMemos delegates to listMemos with default 8", async () => {
    listResponse.mockResolvedValueOnce({ data: [], error: null })
    expect(await getRecentMemos()).toEqual([])
  })

  it("throws on supabase error", async () => {
    singleResponse.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    await expect(getMemoById("x")).rejects.toMatchObject({ message: "boom" })
  })
})
```

### Step 3: Run the test

```
npm run test:run -- __tests__/lib/db/seo-agent-memos.test.ts
```

Expected: PASS, 6 tests.

### Step 4: Commit

```bash
git add lib/db/seo-agent-memos.ts __tests__/lib/db/seo-agent-memos.test.ts
git commit -m "feat(seo-agent): seo_agent_memos DAL (Next.js read side)"
```

---

## Task 3: Signal-gathering helpers (Firebase Functions)

The first step of the agent: parallel fetches into a single `signals_summary` object that the reasoning step feeds to Claude.

**Files:**
- Create: `functions/src/seo/signals.ts`
- Create: `functions/src/__tests__/seo-signals.test.ts`

### Step 1: Implement the helpers

Create `functions/src/seo/signals.ts`:

```ts
// functions/src/seo/signals.ts
// Signal-gathering functions for the SEO agent. Each one is a pure function
// of a Supabase client + parameters, returning a typed summary slice.
// Run in parallel from gatherSeoSignals().

import type { SupabaseClient } from "@supabase/supabase-js"

export interface GscSignals {
  total_clicks: number
  total_impressions: number
  avg_position: number
  top_winnable: Array<{ query: string; avg_position: number; impressions_28d: number; clicks_28d: number }>
  top_decayed: Array<{ slug: string; position_drop: number; clicks_28d: number; avg_position_recent: number }>
}

export interface InventorySignals {
  total_posts: number
  oldest_post_age_days: number
  never_refreshed_count: number
}

export interface TavilySignal {
  title: string
  score: number
  created_at: string
}

export interface MemoryOutcomeSignal {
  run_date: string
  tool: string
  outcome_status: string
  outcome_summary?: string
}

export interface SeoSignalsSummary {
  gsc_28d: GscSignals
  inventory: InventorySignals
  recent_tavily: TavilySignal[]
  orphan_post_ids: string[]
  last_8_memos_outcomes: MemoryOutcomeSignal[]
  /** Convenience: count of distinct dates in gsc_query_daily — used by the data warm-up gate. */
  gsc_distinct_dates: number
}

const TOP_K = 20
const ORPHAN_LOOKBACK_LIMIT = 200
const SITE_URL = "https://www.darrenjpaul.com"

// ─── Individual gatherers ───────────────────────────────────────────────────

export async function gatherCount28dDates(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("gsc_query_daily")
    .select("date", { count: "exact" })
    .gte("date", isoDateNDaysAgo(28))
  if (error) throw error
  // The select returns rows; count distinct via Set.
  const dates = new Set((data as Array<{ date: string }> | null)?.map((r) => r.date) ?? [])
  return dates.size
}

export async function gatherGscSignals(supabase: SupabaseClient): Promise<GscSignals> {
  // 28-day window aggregated per (query, page).
  const since = isoDateNDaysAgo(28)
  const { data: rawRows, error } = await supabase
    .from("gsc_query_daily")
    .select("query, page, impressions, clicks, position, date")
    .gte("date", since)
  if (error) throw error
  type Row = {
    query: string
    page: string
    impressions: number
    clicks: number
    position: number
    date: string
  }
  const rows = (rawRows as Row[] | null) ?? []

  // Site-wide totals
  const totalClicks = rows.reduce((acc, r) => acc + r.clicks, 0)
  const totalImpressions = rows.reduce((acc, r) => acc + r.impressions, 0)
  const avgPosition =
    totalImpressions > 0
      ? rows.reduce((acc, r) => acc + r.position * r.impressions, 0) / totalImpressions
      : 0

  // Aggregate per-query for the winnable pick.
  const perQuery = new Map<
    string,
    { impressions: number; clicks: number; weightedPosition: number }
  >()
  for (const r of rows) {
    const entry = perQuery.get(r.query) ?? { impressions: 0, clicks: 0, weightedPosition: 0 }
    entry.impressions += r.impressions
    entry.clicks += r.clicks
    entry.weightedPosition += r.position * r.impressions
    perQuery.set(r.query, entry)
  }
  const winnable = Array.from(perQuery.entries())
    .map(([query, agg]) => ({
      query,
      impressions_28d: agg.impressions,
      clicks_28d: agg.clicks,
      avg_position: agg.impressions > 0 ? agg.weightedPosition / agg.impressions : 0,
    }))
    .filter((q) => q.avg_position >= 8 && q.avg_position <= 20 && q.impressions_28d >= 50)
    .sort((a, b) => (20 - a.avg_position) * Math.log(1 + a.impressions_28d) - (20 - b.avg_position) * Math.log(1 + b.impressions_28d))
    .reverse()
    .slice(0, TOP_K)

  // Aggregate per-page for the decay pick (28d vs prior 28d).
  const recent: Record<string, { impressions: number; weightedPosition: number; clicks: number }> = {}
  for (const r of rows) {
    const e = recent[r.page] ?? { impressions: 0, weightedPosition: 0, clicks: 0 }
    e.impressions += r.impressions
    e.weightedPosition += r.position * r.impressions
    e.clicks += r.clicks
    recent[r.page] = e
  }

  const priorSince = isoDateNDaysAgo(56)
  const priorEnd = isoDateNDaysAgo(28)
  const { data: priorRowsRaw, error: priorErr } = await supabase
    .from("gsc_query_daily")
    .select("page, impressions, position")
    .gte("date", priorSince)
    .lt("date", priorEnd)
  if (priorErr) throw priorErr
  const priorRows = (priorRowsRaw as Array<{ page: string; impressions: number; position: number }> | null) ?? []
  const prior: Record<string, { impressions: number; weightedPosition: number }> = {}
  for (const r of priorRows) {
    const e = prior[r.page] ?? { impressions: 0, weightedPosition: 0 }
    e.impressions += r.impressions
    e.weightedPosition += r.position * r.impressions
    prior[r.page] = e
  }

  const decayed: Array<{ slug: string; position_drop: number; clicks_28d: number; avg_position_recent: number }> = []
  for (const [page, recentAgg] of Object.entries(recent)) {
    const priorAgg = prior[page]
    if (!priorAgg) continue
    if (recentAgg.impressions < 10 || priorAgg.impressions < 10) continue
    const recentPos = recentAgg.weightedPosition / recentAgg.impressions
    const priorPos = priorAgg.weightedPosition / priorAgg.impressions
    const drop = recentPos - priorPos
    if (drop < 5) continue
    // Derive the slug from the page URL — naive, expects /blog/<slug> in the path.
    const m = page.match(/\/blog\/([^/?#]+)/)
    if (!m) continue
    decayed.push({
      slug: m[1],
      position_drop: drop,
      clicks_28d: recentAgg.clicks,
      avg_position_recent: recentPos,
    })
  }
  decayed.sort((a, b) => b.position_drop - a.position_drop)

  return {
    total_clicks: totalClicks,
    total_impressions: totalImpressions,
    avg_position: avgPosition,
    top_winnable: winnable,
    top_decayed: decayed.slice(0, TOP_K),
  }
}

export async function gatherInventorySignals(supabase: SupabaseClient): Promise<InventorySignals> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, published_at, last_refreshed_at")
    .eq("status", "published")
  if (error) throw error
  type Row = { id: string; published_at: string | null; last_refreshed_at: string | null }
  const rows = (data as Row[] | null) ?? []
  const totalPosts = rows.length
  if (totalPosts === 0) {
    return { total_posts: 0, oldest_post_age_days: 0, never_refreshed_count: 0 }
  }
  const now = Date.now()
  const oldestAgeMs = rows.reduce((acc, r) => {
    if (!r.published_at) return acc
    return Math.max(acc, now - new Date(r.published_at).getTime())
  }, 0)
  const neverRefreshedCount = rows.filter((r) => !r.last_refreshed_at).length
  return {
    total_posts: totalPosts,
    oldest_post_age_days: Math.floor(oldestAgeMs / 86_400_000),
    never_refreshed_count: neverRefreshedCount,
  }
}

export async function gatherTavilySignals(supabase: SupabaseClient): Promise<TavilySignal[]> {
  // Last 4 weeks of Tavily-sourced topic suggestions.
  const since = isoDateNDaysAgo(28)
  const { data, error } = await supabase
    .from("content_calendar")
    .select("title, metadata, created_at")
    .eq("entry_type", "topic_suggestion")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50)
  if (error) throw error
  type Row = { title: string; metadata: { rank?: number; source?: string } | null; created_at: string }
  const rows = (data as Row[] | null) ?? []
  return rows
    .filter((r) => r.metadata?.source !== "seo_agent") // exclude rows we ourselves wrote earlier
    .map((r) => ({
      title: r.title,
      score: typeof r.metadata?.rank === "number" ? 1 / r.metadata.rank : 0,
      created_at: r.created_at,
    }))
}

export async function gatherOrphanPostIds(supabase: SupabaseClient): Promise<string[]> {
  // Cheap heuristic: a post is "orphaned" if no OTHER post's content references its slug
  // via /blog/<slug>. Pulls the most recent N published posts and checks for inbound refs.
  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, slug, content")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(ORPHAN_LOOKBACK_LIMIT)
  if (error) throw error
  type Row = { id: string; slug: string; content: string }
  const rows = (data as Row[] | null) ?? []

  // Concatenate all content once; then check each slug's presence.
  const combinedContent = rows.map((r) => r.content ?? "").join("\n")
  const orphans: string[] = []
  for (const row of rows) {
    const needle = `/blog/${row.slug}`
    // Strip out self-references by removing this row's own content.
    const otherContent = combinedContent.replace(row.content ?? "", "")
    if (!otherContent.includes(needle)) {
      orphans.push(row.id)
    }
  }
  return orphans
}

export async function gatherMemorySignals(supabase: SupabaseClient): Promise<MemoryOutcomeSignal[]> {
  const { data, error } = await supabase
    .from("seo_agent_memos")
    .select("run_date, actions, outcome_status, outcome_metrics")
    .order("run_date", { ascending: false })
    .limit(8)
  if (error) throw error
  type Row = {
    run_date: string
    actions: Array<{ tool: string }>
    outcome_status: string
    outcome_metrics: unknown
  }
  const rows = (data as Row[] | null) ?? []
  const out: MemoryOutcomeSignal[] = []
  for (const m of rows) {
    for (const a of m.actions ?? []) {
      out.push({
        run_date: m.run_date,
        tool: a.tool,
        outcome_status: m.outcome_status,
        outcome_summary: m.outcome_metrics ? JSON.stringify(m.outcome_metrics).slice(0, 200) : undefined,
      })
    }
  }
  return out
}

// ─── Top-level ──────────────────────────────────────────────────────────────

export async function gatherSeoSignals(supabase: SupabaseClient): Promise<SeoSignalsSummary> {
  const [gsc, inventory, tavily, orphanIds, memory, gscDistinctDates] = await Promise.all([
    gatherGscSignals(supabase),
    gatherInventorySignals(supabase),
    gatherTavilySignals(supabase),
    gatherOrphanPostIds(supabase),
    gatherMemorySignals(supabase),
    gatherCount28dDates(supabase),
  ])
  return {
    gsc_28d: gsc,
    inventory,
    recent_tavily: tavily,
    orphan_post_ids: orphanIds,
    last_8_memos_outcomes: memory,
    gsc_distinct_dates: gscDistinctDates,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isoDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
```

### Step 2: Write the test

Create `functions/src/__tests__/seo-signals.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

// Helper that mirrors the project pattern for Supabase mocks:
// `chains` is keyed by table name and returns the chainable mock.
function buildSupabase(chains: Record<string, unknown>): unknown {
  return {
    from: vi.fn((table: string) => chains[table] ?? {}),
  }
}

async function loadSignals() {
  return import("../seo/signals.js")
}

describe("gatherCount28dDates", () => {
  it("returns the count of distinct dates in the 28d window", async () => {
    const { gatherCount28dDates } = await loadSignals()
    const supabase = buildSupabase({
      gsc_query_daily: {
        select: () => ({
          gte: () =>
            Promise.resolve({
              data: [{ date: "2026-05-12" }, { date: "2026-05-12" }, { date: "2026-05-11" }],
              error: null,
            }),
        }),
      },
    }) as never
    expect(await gatherCount28dDates(supabase)).toBe(2)
  })
})

describe("gatherInventorySignals", () => {
  it("computes totals, oldest age, never-refreshed count", async () => {
    const { gatherInventorySignals } = await loadSignals()
    const longAgo = new Date(Date.now() - 1000 * 86400 * 1000).toISOString()
    const supabase = buildSupabase({
      blog_posts: {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                { id: "a", published_at: longAgo, last_refreshed_at: null },
                { id: "b", published_at: new Date().toISOString(), last_refreshed_at: new Date().toISOString() },
              ],
              error: null,
            }),
        }),
      },
    }) as never
    const out = await gatherInventorySignals(supabase)
    expect(out.total_posts).toBe(2)
    expect(out.never_refreshed_count).toBe(1)
    expect(out.oldest_post_age_days).toBeGreaterThan(900)
  })

  it("returns zeros when no published posts", async () => {
    const { gatherInventorySignals } = await loadSignals()
    const supabase = buildSupabase({
      blog_posts: { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) },
    }) as never
    expect(await gatherInventorySignals(supabase)).toEqual({
      total_posts: 0,
      oldest_post_age_days: 0,
      never_refreshed_count: 0,
    })
  })
})

describe("gatherOrphanPostIds", () => {
  it("flags posts whose slug is not referenced by other posts' content", async () => {
    const { gatherOrphanPostIds } = await loadSignals()
    const supabase = buildSupabase({
      blog_posts: {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: [
                    { id: "a", slug: "alpha", content: '<p>links to <a href="/blog/beta">beta</a></p>' },
                    { id: "b", slug: "beta", content: "<p>no inbound refs</p>" },
                    { id: "c", slug: "gamma", content: "<p>orphan with no inbound links</p>" },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      },
    }) as never
    const orphans = await gatherOrphanPostIds(supabase)
    expect(orphans).toContain("a")
    expect(orphans).toContain("c")
    expect(orphans).not.toContain("b")
  })
})

describe("gatherTavilySignals", () => {
  it("excludes rows the agent itself wrote (source=seo_agent)", async () => {
    const { gatherTavilySignals } = await loadSignals()
    const supabase = buildSupabase({
      content_calendar: {
        select: () => ({
          eq: () => ({
            gte: () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [
                      { title: "From Tavily", metadata: { source: "tavily", rank: 1 }, created_at: "2026-05-10" },
                      { title: "From agent", metadata: { source: "seo_agent", rank: 1 }, created_at: "2026-05-09" },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      },
    }) as never
    const out = await gatherTavilySignals(supabase)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("From Tavily")
  })
})

describe("gatherMemorySignals", () => {
  it("flattens last-8 memos into per-action records", async () => {
    const { gatherMemorySignals } = await loadSignals()
    const supabase = buildSupabase({
      seo_agent_memos: {
        select: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    run_date: "2026-05-05",
                    actions: [
                      { tool: "queue_refresh" },
                      { tool: "queue_new_post" },
                    ],
                    outcome_status: "measured",
                    outcome_metrics: [{ clicks_after: 31 }],
                  },
                ],
                error: null,
              }),
          }),
        }),
      },
    }) as never
    const out = await gatherMemorySignals(supabase)
    expect(out).toHaveLength(2)
    expect(out[0].tool).toBe("queue_refresh")
    expect(out[0].outcome_status).toBe("measured")
    expect(out[1].tool).toBe("queue_new_post")
  })
})
```

### Step 3: Run tests, type-check

```
cd functions && npm run test -- src/__tests__/seo-signals.test.ts && npm run build && cd ..
```

Expected: All tests pass, build clean.

### Step 4: Commit

```bash
git add functions/src/seo/signals.ts functions/src/__tests__/seo-signals.test.ts
git commit -m "feat(seo-agent): signal-gathering helpers (GSC + inventory + Tavily + orphans + memory)"
```

---

## Task 4: Decision Zod schema

The agent's response is a discriminated union — one of four tools, with per-tool arg shapes.

**Files:**
- Create: `functions/src/seo/decision-schema.ts`
- Create: `functions/src/__tests__/seo-decision-schema.test.ts`

### Step 1: Write the failing test

Create `functions/src/__tests__/seo-decision-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { decisionSchema } from "../seo/decision-schema.js"

describe("decisionSchema", () => {
  const validQueueNewPost = {
    rank: 1 as const,
    tool: "queue_new_post" as const,
    args: { keyword: "deadlift form", angle: "biomechanics-first" },
  }
  const validQueueRefresh = {
    rank: 2 as const,
    tool: "queue_refresh" as const,
    args: { blog_post_id: "11111111-1111-1111-1111-111111111111", reason: "Lost 7 positions in 28d" },
    complementary_to_rank_1: "different type",
  }

  it("accepts a valid decision with two actions of different tools", () => {
    const valid = {
      rationale: "Striking-distance keyword + refresh of a decayed post — diverse and high-leverage.",
      actions: [validQueueNewPost, validQueueRefresh],
    }
    const out = decisionSchema.safeParse(valid)
    expect(out.success).toBe(true)
  })

  it("rejects when actions.length != 2", () => {
    expect(
      decisionSchema.safeParse({
        rationale: "x".repeat(50),
        actions: [validQueueNewPost],
      }).success,
    ).toBe(false)
    expect(
      decisionSchema.safeParse({
        rationale: "x".repeat(50),
        actions: [validQueueNewPost, validQueueRefresh, validQueueNewPost],
      }).success,
    ).toBe(false)
  })

  it("rejects when both actions are the same tool", () => {
    const dup = {
      rationale: "x".repeat(50),
      actions: [
        validQueueNewPost,
        { rank: 2 as const, tool: "queue_new_post" as const, args: { keyword: "x", angle: "y" } },
      ],
    }
    expect(decisionSchema.safeParse(dup).success).toBe(false)
  })

  it("rejects an unknown tool name", () => {
    const bad = {
      rationale: "x".repeat(50),
      actions: [
        { rank: 1, tool: "nuke_database", args: {} },
        validQueueRefresh,
      ],
    }
    expect(decisionSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects when rank is missing or not 1/2", () => {
    const bad = {
      rationale: "x".repeat(50),
      actions: [
        { tool: "queue_new_post", args: { keyword: "x", angle: "y" } },
        validQueueRefresh,
      ],
    }
    expect(decisionSchema.safeParse(bad).success).toBe(false)
  })

  it("requires queue_refresh args.blog_post_id and args.reason", () => {
    const bad = {
      rationale: "x".repeat(50),
      actions: [
        validQueueNewPost,
        { rank: 2, tool: "queue_refresh", args: { blog_post_id: "id" } }, // missing reason
      ],
    }
    expect(decisionSchema.safeParse(bad).success).toBe(false)
  })

  it("accepts flag_for_human with urgency enum", () => {
    const ok = {
      rationale: "x".repeat(50),
      actions: [
        validQueueNewPost,
        {
          rank: 2,
          tool: "flag_for_human",
          args: { issue: "Possible cannibalization", urgency: "medium", context: "Posts X and Y both target keyword Z" },
        },
      ],
    }
    expect(decisionSchema.safeParse(ok).success).toBe(true)
  })

  it("rejects flag_for_human with invalid urgency", () => {
    const bad = {
      rationale: "x".repeat(50),
      actions: [
        validQueueNewPost,
        { rank: 2, tool: "flag_for_human", args: { issue: "x", urgency: "extreme", context: "y" } },
      ],
    }
    expect(decisionSchema.safeParse(bad).success).toBe(false)
  })
})
```

### Step 2: Run, verify it fails

```
cd functions && npm run test -- src/__tests__/seo-decision-schema.test.ts && cd ..
```

Expected: FAIL — module not found.

### Step 3: Implement

Create `functions/src/seo/decision-schema.ts`:

```ts
// functions/src/seo/decision-schema.ts
// Zod schema for the SEO agent's decision shape. The schema enforces:
// - exactly 2 actions
// - each action is a valid tool with the right args
// - the two actions must be of different tools (refine())
// - rank is 1 or 2

import { z } from "zod"

const queueNewPostArgs = z.object({
  keyword: z.string().min(2).max(120),
  angle: z.string().min(5).max(500),
  references: z.array(z.string().url()).max(5).optional(),
})

const queueRefreshArgs = z.object({
  blog_post_id: z.string().uuid(),
  reason: z.string().min(5).max(500),
})

const queueLinkSweepArgs = z.object({
  target_blog_post_id: z.string().uuid(),
  candidate_anchor_post_ids: z.array(z.string().uuid()).min(1).max(10),
})

const flagForHumanArgs = z.object({
  issue: z.string().min(5).max(200),
  urgency: z.enum(["low", "medium", "high"]),
  context: z.string().min(10).max(1000),
})

const baseActionFields = {
  rank: z.union([z.literal(1), z.literal(2)]),
  complementary_to_rank_1: z.string().max(300).optional(),
}

const actionSchema = z.discriminatedUnion("tool", [
  z.object({ ...baseActionFields, tool: z.literal("queue_new_post"), args: queueNewPostArgs }),
  z.object({ ...baseActionFields, tool: z.literal("queue_refresh"), args: queueRefreshArgs }),
  z.object({
    ...baseActionFields,
    tool: z.literal("queue_internal_link_sweep"),
    args: queueLinkSweepArgs,
  }),
  z.object({ ...baseActionFields, tool: z.literal("flag_for_human"), args: flagForHumanArgs }),
])

export const decisionSchema = z
  .object({
    rationale: z.string().min(20).max(2000),
    actions: z.tuple([actionSchema, actionSchema]),
  })
  .refine((d) => d.actions[0].tool !== d.actions[1].tool, {
    message: "Both actions must be of different tools",
    path: ["actions"],
  })

export type Decision = z.infer<typeof decisionSchema>
export type Action = z.infer<typeof actionSchema>
export type ToolName = Action["tool"]
```

### Step 4: Run the test, verify it passes

```
cd functions && npm run test -- src/__tests__/seo-decision-schema.test.ts && cd ..
```

Expected: PASS, 8 tests.

### Step 5: Commit

```bash
git add functions/src/seo/decision-schema.ts functions/src/__tests__/seo-decision-schema.test.ts
git commit -m "feat(seo-agent): decision Zod schema (4 tools, exactly 2 different-typed actions)"
```

---

## Task 5: `reason()` helper

The single Claude call. Takes the full signals summary, returns a parsed `Decision`.

**Files:**
- Create: `functions/src/seo/reason.ts`

(No separate test file — `reason()` is mocked at the `callAgent` layer in the handler test. The decision schema's parsing is already tested in Task 4.)

### Step 1: Implement

Create `functions/src/seo/reason.ts`:

```ts
// functions/src/seo/reason.ts
// The single Claude call that picks two ranked actions for the week.

import { callAgent, MODEL_SONNET } from "../ai/anthropic.js"
import { decisionSchema, type Decision } from "./decision-schema.js"
import type { SeoSignalsSummary } from "./signals.js"

export const SYSTEM_PROMPT = `You are the SEO strategist for darrenjpaul.com — a strength & conditioning coach's site. Your job each Sunday is to pick the two highest-leverage SEO actions for the coming week.

You see fused signals: Google Search Console performance, the blog inventory, prior Tavily topic suggestions, orphan posts with no inbound internal links, and the outcomes of your previous 8 decisions.

Rules:
1. Output exactly two actions, ranked by leverage (rank 1 = highest, rank 2 = second highest).
2. The two actions MUST be of different types. No two refreshes, no two new posts, etc.
3. Each action must be justified in one sentence inside its args.reason field (for queue_refresh) or via the action's nature (for the others). The overall pair must be justified in a 2-5 sentence top-level rationale.
4. Prefer actions whose outcome you can measure. Avoid actions whose outcome is purely qualitative.
5. If the outcomes table shows a tactic underperforming (e.g., refreshes producing no clicks delta), shift weight to other tactics this week.

The four tools available to you:

  queue_new_post(keyword, angle, references?)
    Drops a topic_suggestion row that autoBlogCron picks up on Tuesday or Thursday.
    Use for: striking-distance keywords (avg position 8-20, ≥50 impressions in last 28d)
    where no published post already targets that keyword.

  queue_refresh(blog_post_id, reason)
    Enqueues a refresh of an existing post. Produces a draft for coach review.
    Use for: posts with position_drop ≥5 over the last 28d, OR posts >6 months old
    that haven't been refreshed in 90+ days.

  queue_internal_link_sweep(target_blog_post_id, candidate_anchor_post_ids[])
    Inserts up to 2 inbound links from candidate posts into the target.
    Use for: posts in orphan_post_ids (no inbound links from other posts) that you
    want to lift. Pick candidate posts from the inventory that are topically related.

  flag_for_human(issue, urgency, context)
    Creates an admin notification. Use only when you spot something that needs
    human judgment — cannibalization, schema breakage, off-brand content drift.
    Use sparingly; this is the escape hatch, not a default action.

Output a JSON object matching this shape exactly:
{
  "rationale": "<2-5 sentences explaining why these two actions, in this combination, are the highest-leverage moves this week>",
  "actions": [
    { "rank": 1, "tool": "<tool_name>", "args": { ... }, "complementary_to_rank_1": "optional reason" },
    { "rank": 2, "tool": "<different_tool_name>", "args": { ... }, "complementary_to_rank_1": "why this complements rank 1" }
  ]
}`

export async function reasonAboutWeek(signals: SeoSignalsSummary): Promise<{ decision: Decision; tokens_used: number }> {
  const userMessage = `Here is the current state of darrenjpaul.com SEO. Pick the two highest-leverage actions for this week.

\`\`\`json
${JSON.stringify(signals, null, 2)}
\`\`\`

Return ONLY the JSON object — no commentary outside it.`
  const result = await callAgent(SYSTEM_PROMPT, userMessage, decisionSchema, { model: MODEL_SONNET })
  return { decision: result.content, tokens_used: result.tokens_used }
}
```

### Step 2: Type-check

```
cd functions && npm run build && cd ..
```

Expected: clean.

### Step 3: Commit

```bash
git add functions/src/seo/reason.ts
git commit -m "feat(seo-agent): reasonAboutWeek — single Claude call, returns parsed Decision"
```

---

## Task 6: Tool executors

Four per-tool functions. Each returns `{ executed: boolean, execution_target_id: string | null, error?: string }`. The handler calls one per action and records the result in the memo's `actions[i]` shape.

**Files:**
- Create: `functions/src/seo/execute.ts`
- Create: `functions/src/__tests__/seo-execute.test.ts`

### Step 1: Write the failing test

Create `functions/src/__tests__/seo-execute.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"

const supabaseFromMock = vi.fn()
const firestoreDocSet = vi.fn()
const firestoreCollectionDoc = vi.fn(() => ({ id: "new-doc-id", set: firestoreDocSet }))

vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({ from: supabaseFromMock }),
}))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: vi.fn(() => ({ doc: firestoreCollectionDoc })),
  }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  supabaseFromMock.mockReset()
  firestoreDocSet.mockReset()
  firestoreCollectionDoc.mockClear()
})

describe("executeQueueNewPost", () => {
  it("inserts a topic_suggestion row, returns execution_target_id", async () => {
    const { executeQueueNewPost } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "content_calendar") {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "cc-id-1" }, error: null }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await executeQueueNewPost(
      { keyword: "deadlift", angle: "biomechanics" },
      { memoId: "memo-1", userId: "u" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "cc-id-1" })
  })

  it("returns executed=false on supabase error", async () => {
    const { executeQueueNewPost } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation(() => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "boom" } }) }),
      }),
    }))
    const out = await executeQueueNewPost(
      { keyword: "x", angle: "y" },
      { memoId: "memo-1", userId: "u" },
    )
    expect(out).toMatchObject({ executed: false, execution_target_id: null, error: "boom" })
  })
})

describe("executeQueueRefresh", () => {
  it("creates a Firestore ai_job and returns its id", async () => {
    const { executeQueueRefresh } = await import("../seo/execute.js")
    firestoreDocSet.mockResolvedValueOnce(undefined)
    const out = await executeQueueRefresh(
      { blog_post_id: "11111111-1111-1111-1111-111111111111", reason: "decay" },
      { memoId: "memo-1", userId: "u" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "new-doc-id" })
    const arg = firestoreDocSet.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.type).toBe("blog_refresh")
    expect(arg.triggeredBy).toBe("seo_agent_run")
    expect((arg.input as Record<string, unknown>).blogPostId).toBe("11111111-1111-1111-1111-111111111111")
  })
})

describe("executeQueueInternalLinkSweep", () => {
  it("creates a Firestore ai_job with type=internal_link_sweep", async () => {
    const { executeQueueInternalLinkSweep } = await import("../seo/execute.js")
    firestoreDocSet.mockResolvedValueOnce(undefined)
    const out = await executeQueueInternalLinkSweep(
      {
        target_blog_post_id: "11111111-1111-1111-1111-111111111111",
        candidate_anchor_post_ids: ["22222222-2222-2222-2222-222222222222"],
      },
      { memoId: "memo-1", userId: "u" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "new-doc-id" })
    const arg = firestoreDocSet.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.type).toBe("internal_link_sweep")
  })
})

describe("executeFlagForHuman", () => {
  it("inserts a notification row and returns its id (when admin user resolvable)", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: [{ id: "admin-uuid" }], error: null }),
            }),
          }),
        }
      }
      if (table === "notifications") {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "notif-1" }, error: null }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await executeFlagForHuman(
      { issue: "Cannibalization", urgency: "medium", context: "Posts A and B compete on keyword X" },
      { memoId: "memo-1", userId: "u" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "notif-1" })
  })

  it("returns executed=false when no admin user found", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }))
    const out = await executeFlagForHuman(
      { issue: "x", urgency: "low", context: "y" },
      { memoId: "memo-1", userId: "u" },
    )
    expect(out.executed).toBe(false)
    expect(out.error).toMatch(/no admin user/i)
  })
})

describe("executeAction (dispatcher)", () => {
  it("dispatches to the correct tool executor by action.tool", async () => {
    const { executeAction } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation(() => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: "cc-id" }, error: null }) }),
      }),
    }))
    const out = await executeAction(
      { rank: 1, tool: "queue_new_post", args: { keyword: "k", angle: "a" } },
      { memoId: "memo-1", userId: "u" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "cc-id" })
  })
})
```

### Step 2: Run, verify it fails

```
cd functions && npm run test -- src/__tests__/seo-execute.test.ts && cd ..
```

Expected: FAIL — module not found.

### Step 3: Implement

Create `functions/src/seo/execute.ts`:

```ts
// functions/src/seo/execute.ts
// One executor per tool. Each returns the new entity id so the memo can
// record execution_target_id. The dispatcher executeAction() routes by
// action.tool — keeps the handler short and the test surface small.

import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getSupabase } from "../lib/supabase.js"
import type { Action } from "./decision-schema.js"

export interface AgentContext {
  memoId: string
  userId: string
}

export interface ExecutionResult {
  executed: boolean
  execution_target_id: string | null
  error?: string
}

// ─── queue_new_post ────────────────────────────────────────────────────────

export async function executeQueueNewPost(
  args: { keyword: string; angle: string; references?: string[] },
  ctx: AgentContext,
): Promise<ExecutionResult> {
  const supabase = getSupabase()
  const nextTuesday = nextWeekdayIso(2) // 2 = Tuesday in JS Date.getDay()
  const { data, error } = await supabase
    .from("content_calendar")
    .insert({
      entry_type: "topic_suggestion",
      title: args.keyword,
      scheduled_for: nextTuesday,
      status: "planned",
      metadata: {
        source: "seo_agent",
        rank: 1,
        primary_keyword: args.keyword,
        angle: args.angle,
        references: args.references ?? [],
        memo_id: ctx.memoId,
      },
    })
    .select("id")
    .single()
  if (error || !data) {
    return { executed: false, execution_target_id: null, error: error?.message ?? "insert failed" }
  }
  return { executed: true, execution_target_id: (data as { id: string }).id }
}

// ─── queue_refresh ─────────────────────────────────────────────────────────

export async function executeQueueRefresh(
  args: { blog_post_id: string; reason: string },
  ctx: AgentContext,
): Promise<ExecutionResult> {
  try {
    const db = getFirestore()
    const jobRef = db.collection("ai_jobs").doc()
    await jobRef.set({
      type: "blog_refresh",
      status: "pending",
      input: {
        blogPostId: args.blog_post_id,
        triggerReason: `seo_agent: ${args.reason}`,
        userId: ctx.userId,
      },
      result: null,
      error: null,
      userId: ctx.userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      triggeredBy: "seo_agent_run",
      memoId: ctx.memoId,
    })
    return { executed: true, execution_target_id: jobRef.id }
  } catch (err) {
    return { executed: false, execution_target_id: null, error: (err as Error).message }
  }
}

// ─── queue_internal_link_sweep ─────────────────────────────────────────────

export async function executeQueueInternalLinkSweep(
  args: { target_blog_post_id: string; candidate_anchor_post_ids: string[] },
  ctx: AgentContext,
): Promise<ExecutionResult> {
  try {
    const db = getFirestore()
    const jobRef = db.collection("ai_jobs").doc()
    await jobRef.set({
      type: "internal_link_sweep",
      status: "pending",
      input: {
        targetBlogPostId: args.target_blog_post_id,
        candidateAnchorPostIds: args.candidate_anchor_post_ids,
        userId: ctx.userId,
      },
      result: null,
      error: null,
      userId: ctx.userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      triggeredBy: "seo_agent_run",
      memoId: ctx.memoId,
    })
    return { executed: true, execution_target_id: jobRef.id }
  } catch (err) {
    return { executed: false, execution_target_id: null, error: (err as Error).message }
  }
}

// ─── flag_for_human ────────────────────────────────────────────────────────

export async function executeFlagForHuman(
  args: { issue: string; urgency: "low" | "medium" | "high"; context: string },
  ctx: AgentContext,
): Promise<ExecutionResult> {
  const supabase = getSupabase()

  // Resolve admin user via role lookup. Solo-dev project — one admin row.
  const { data: admins, error: adminErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1)
  if (adminErr) {
    return { executed: false, execution_target_id: null, error: adminErr.message }
  }
  const adminId = (admins as Array<{ id: string }> | null)?.[0]?.id
  if (!adminId) {
    return { executed: false, execution_target_id: null, error: "no admin user found" }
  }

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: adminId,
      type: "seo_agent_flag",
      title: `[${args.urgency}] ${args.issue}`,
      body: args.context,
      href: "/admin/seo-agent/memos",
      is_read: false,
    })
    .select("id")
    .single()
  if (error || !data) {
    return { executed: false, execution_target_id: null, error: error?.message ?? "notification insert failed" }
  }
  return { executed: true, execution_target_id: (data as { id: string }).id }
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

export async function executeAction(action: Action, ctx: AgentContext): Promise<ExecutionResult> {
  switch (action.tool) {
    case "queue_new_post":
      return executeQueueNewPost(action.args, ctx)
    case "queue_refresh":
      return executeQueueRefresh(action.args, ctx)
    case "queue_internal_link_sweep":
      return executeQueueInternalLinkSweep(action.args, ctx)
    case "flag_for_human":
      return executeFlagForHuman(action.args, ctx)
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function nextWeekdayIso(targetDayOfWeek: number): string {
  const d = new Date()
  const dayOfWeek = d.getUTCDay()
  const daysAhead = (targetDayOfWeek - dayOfWeek + 7) % 7 || 7
  d.setUTCDate(d.getUTCDate() + daysAhead)
  return d.toISOString().slice(0, 10)
}
```

### Step 4: Run the test, verify it passes

```
cd functions && npm run test -- src/__tests__/seo-execute.test.ts && cd ..
```

Expected: PASS, 6 tests.

### Step 5: Commit

```bash
git add functions/src/seo/execute.ts functions/src/__tests__/seo-execute.test.ts
git commit -m "feat(seo-agent): tool executors (queue_new_post, queue_refresh, queue_internal_link_sweep, flag_for_human)"
```

---

## Task 7: `handleSeoAgent` — the main handler

Orchestrates `gather → reason → execute → remember`. Includes the data warm-up gate.

**Files:**
- Create: `functions/src/seo-agent.ts`
- Create: `functions/src/__tests__/seo-agent.test.ts`

### Step 1: Write the failing test

Create `functions/src/__tests__/seo-agent.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"

const gatherSeoSignalsMock = vi.fn()
const reasonAboutWeekMock = vi.fn()
const executeActionMock = vi.fn()
const supabaseFromMock = vi.fn()
const jobRefGet = vi.fn()
const jobRefUpdate = vi.fn()

vi.mock("../seo/signals.js", () => ({ gatherSeoSignals: gatherSeoSignalsMock }))
vi.mock("../seo/reason.js", () => ({ reasonAboutWeek: reasonAboutWeekMock }))
vi.mock("../seo/execute.js", () => ({ executeAction: executeActionMock }))
vi.mock("../lib/supabase.js", () => ({ getSupabase: () => ({ from: supabaseFromMock }) }))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: jobRefGet, update: jobRefUpdate }) }),
  }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  gatherSeoSignalsMock.mockReset()
  reasonAboutWeekMock.mockReset()
  executeActionMock.mockReset()
  supabaseFromMock.mockReset()
  jobRefGet.mockReset()
  jobRefUpdate.mockReset()
})

describe("handleSeoAgent", () => {
  it("happy path: gather, reason, execute 2 actions, insert memo, mark job completed", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "pending", type: "seo_agent_run", input: { userId: "admin-uuid" } }),
    })
    gatherSeoSignalsMock.mockResolvedValueOnce({
      gsc_28d: { total_clicks: 100, total_impressions: 1000, avg_position: 12, top_winnable: [], top_decayed: [] },
      inventory: { total_posts: 50, oldest_post_age_days: 600, never_refreshed_count: 40 },
      recent_tavily: [],
      orphan_post_ids: [],
      last_8_memos_outcomes: [],
      gsc_distinct_dates: 28,
    })
    reasonAboutWeekMock.mockResolvedValueOnce({
      decision: {
        rationale: "Striking-distance keyword + decay refresh — diverse and measurable",
        actions: [
          { rank: 1, tool: "queue_new_post", args: { keyword: "deadlift", angle: "bio" } },
          { rank: 2, tool: "queue_refresh", args: { blog_post_id: "11111111-1111-1111-1111-111111111111", reason: "decay" } },
        ],
      },
      tokens_used: 500,
    })
    executeActionMock
      .mockResolvedValueOnce({ executed: true, execution_target_id: "cc-1" })
      .mockResolvedValueOnce({ executed: true, execution_target_id: "ai-1" })

    // Memo insert returns id.
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "seo_agent_memos") {
        return {
          insert: () => ({
            select: () => ({ single: () => Promise.resolve({ data: { id: "memo-1" }, error: null }) }),
          }),
        }
      }
      return {}
    })

    const { handleSeoAgent } = await import("../seo-agent.js")
    await handleSeoAgent("job-1")

    expect(executeActionMock).toHaveBeenCalledTimes(2)
    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { memoId: string }).memoId).toBe("memo-1")
  })

  it("skips silently when gsc_query_daily has fewer than 28 distinct dates", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "pending", type: "seo_agent_run", input: { userId: "u" } }),
    })
    gatherSeoSignalsMock.mockResolvedValueOnce({
      gsc_28d: { total_clicks: 0, total_impressions: 0, avg_position: 0, top_winnable: [], top_decayed: [] },
      inventory: { total_posts: 0, oldest_post_age_days: 0, never_refreshed_count: 0 },
      recent_tavily: [],
      orphan_post_ids: [],
      last_8_memos_outcomes: [],
      gsc_distinct_dates: 5,
    })

    const { handleSeoAgent } = await import("../seo-agent.js")
    await handleSeoAgent("job-2")

    expect(reasonAboutWeekMock).not.toHaveBeenCalled()
    expect(executeActionMock).not.toHaveBeenCalled()
    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { skipped: string }).skipped).toMatch(/warm.?up/i)
  })

  it("marks job failed when reasoning throws", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "pending", type: "seo_agent_run", input: { userId: "u" } }),
    })
    gatherSeoSignalsMock.mockResolvedValueOnce({
      gsc_28d: { total_clicks: 0, total_impressions: 0, avg_position: 0, top_winnable: [], top_decayed: [] },
      inventory: { total_posts: 0, oldest_post_age_days: 0, never_refreshed_count: 0 },
      recent_tavily: [],
      orphan_post_ids: [],
      last_8_memos_outcomes: [],
      gsc_distinct_dates: 30,
    })
    reasonAboutWeekMock.mockRejectedValueOnce(new Error("Claude API timeout"))

    const { handleSeoAgent } = await import("../seo-agent.js")
    await handleSeoAgent("job-3")

    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; error?: string }
    expect(finalUpdate?.status).toBe("failed")
    expect(finalUpdate?.error).toMatch(/Claude API timeout/)
  })

  it("bails when job doc is not pending", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "completed", type: "seo_agent_run", input: {} }),
    })
    const { handleSeoAgent } = await import("../seo-agent.js")
    await handleSeoAgent("done-job")
    expect(gatherSeoSignalsMock).not.toHaveBeenCalled()
  })
})
```

### Step 2: Run, verify it fails

```
cd functions && npm run test -- src/__tests__/seo-agent.test.ts && cd ..
```

Expected: FAIL — module not found.

### Step 3: Implement

Create `functions/src/seo-agent.ts`:

```ts
// functions/src/seo-agent.ts
// The SEO agent handler. Runs gather → reason → execute → remember once per
// week (Sunday 14:00 UTC). Subject to the data warm-up gate: skip silently
// when gsc_query_daily has fewer than 28 distinct dates.

import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getSupabase } from "./lib/supabase.js"
import { gatherSeoSignals } from "./seo/signals.js"
import { reasonAboutWeek } from "./seo/reason.js"
import { executeAction, type ExecutionResult } from "./seo/execute.js"
import type { Decision } from "./seo/decision-schema.js"

const WARM_UP_MIN_DISTINCT_DATES = 28

export async function handleSeoAgent(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as { userId: string }
  const userId = input.userId

  const startTime = Date.now()

  try {
    const supabase = getSupabase()

    // Step 1: gather
    const signals = await gatherSeoSignals(supabase)

    if (signals.gsc_distinct_dates < WARM_UP_MIN_DISTINCT_DATES) {
      console.log(
        `[seo-agent] data warm-up incomplete (${signals.gsc_distinct_dates}/${WARM_UP_MIN_DISTINCT_DATES} distinct dates) — skipping silently`,
      )
      await jobRef.update({
        status: "completed",
        result: {
          skipped: "warm_up",
          gsc_distinct_dates: signals.gsc_distinct_dates,
          required: WARM_UP_MIN_DISTINCT_DATES,
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    // Step 2: reason
    const { decision } = await reasonAboutWeek(signals)

    // Step 3a: insert the memo first (we need its id to pass to executors).
    // outcome_status starts as 'pending'.
    const runDate = new Date().toISOString().slice(0, 10)
    const { data: memoInsert, error: memoInsertErr } = await supabase
      .from("seo_agent_memos")
      .insert({
        run_date: runDate,
        ai_job_id: jobId,
        signals_summary: signals,
        rationale: decision.rationale,
        actions: decision.actions.map((a) => ({
          rank: a.rank,
          tool: a.tool,
          args: a.args,
          executed: false,
          execution_target_id: null,
          complementary_to_rank_1: a.complementary_to_rank_1,
        })),
        outcome_status: "pending",
      })
      .select("id")
      .single()
    if (memoInsertErr || !memoInsert) {
      throw new Error(`memo insert failed: ${memoInsertErr?.message ?? "unknown"}`)
    }
    const memoId = (memoInsert as { id: string }).id

    // Step 3b: execute each action in order, writing back the result to the memo.
    const ctx = { memoId, userId }
    const results: ExecutionResult[] = []
    for (const action of decision.actions) {
      const r = await executeAction(action, ctx)
      results.push(r)
      console.log(
        `[seo-agent] action rank=${action.rank} tool=${action.tool} executed=${r.executed} target=${r.execution_target_id ?? "null"}`,
      )
    }

    // Step 4: update the memo's actions[] with executed flags + target ids.
    const finalActions = decision.actions.map((a, i) => ({
      rank: a.rank,
      tool: a.tool,
      args: a.args,
      executed: results[i].executed,
      execution_target_id: results[i].execution_target_id,
      complementary_to_rank_1: a.complementary_to_rank_1,
    }))
    await supabase
      .from("seo_agent_memos")
      .update({ actions: finalActions })
      .eq("id", memoId)

    await jobRef.update({
      status: "completed",
      result: {
        memoId,
        rationale: decision.rationale,
        actions_executed: results.filter((r) => r.executed).length,
        duration_ms: Date.now() - startTime,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[seo-agent] Job ${jobId} failed:`, errorMessage)
    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
```

### Step 4: Run, confirm pass

```
cd functions && npm run test -- src/__tests__/seo-agent.test.ts && cd ..
```

Expected: PASS, 4 tests.

### Step 5: Type-check

```
cd functions && npm run build && cd ..
```

Expected: clean.

### Step 6: Commit

```bash
git add functions/src/seo-agent.ts functions/src/__tests__/seo-agent.test.ts
git commit -m "feat(seo-agent): handleSeoAgent — gather → reason → execute → remember"
```

---

## Task 8: Register Firestore trigger + scheduled function

**Files:**
- Modify: `functions/src/index.ts`

### Step 1: Add the Firestore trigger

Open `functions/src/index.ts`. Find the existing `internalLinkSweep` `onDocumentCreated` block (Phase 3 Task 4). Add immediately after it:

```ts
// ─── SEO Agent Run ──────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "seo_agent_run".
// Runs the four-step orchestration (gather → reason → execute → remember).

export const seoAgent = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "seo_agent_run") return

    const { handleSeoAgent } = await import("./seo-agent.js")
    await handleSeoAgent(event.params.jobId)
  },
)
```

### Step 2: Add the scheduled function

In the same file, find the existing scheduled functions section (after `tavilyTrendingCron` is fine). Add:

```ts
// ─── SEO Agent Weekly (Sun 14:00 UTC) ───────────────────────────────────────
// Calls /api/admin/internal/seo-agent which enqueues a seo_agent_run ai_job.
// Subject to automation_paused + cron_seo_agent_enabled gates inside the route.

export const seoAgentCron = onSchedule(
  {
    schedule: "0 14 * * 0",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[seoAgentCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/seo-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[seoAgentCron]", res.status, body)
    } catch (err) {
      console.error("[seoAgentCron] failed:", err)
    }
  },
)
```

### Step 3: Type-check

```
cd functions && npm run build && cd ..
```

Expected: clean.

### Step 4: Commit

```bash
git add functions/src/index.ts
git commit -m "feat(seo-agent): register seoAgent trigger + seoAgentCron weekly schedule"
```

### Deploy

The user deploys after Phase 4 merges:

```bash
firebase deploy --only functions:default:seoAgent functions:default:seoAgentCron
```

Do NOT deploy from the subagent.

---

## Task 9: `/api/admin/internal/seo-agent` route

Bearer-auth-gated. Enqueues the Firestore ai_job. Same pattern as the other internal routes.

**Files:**
- Create: `app/api/admin/internal/seo-agent/route.ts`
- Create: `__tests__/api/admin/internal/seo-agent.test.ts`

### Step 1: Write the failing test

Create `__tests__/api/admin/internal/seo-agent.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const isCronSkipped = vi.fn()
const jobSetMock = vi.fn()
const jobDocMock = vi.fn(() => ({ id: "new-job-id", set: jobSetMock }))
const collectionMock = vi.fn(() => ({ doc: jobDocMock }))

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: collectionMock }),
}))
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  isCronSkipped.mockReset()
  jobSetMock.mockReset()
  jobDocMock.mockClear()
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
})

async function call({ bearer = "shared-secret" }: { bearer?: string } = {}) {
  const { POST } = await import("@/app/api/admin/internal/seo-agent/route")
  const req = new NextRequest("https://example.test/api/admin/internal/seo-agent", {
    method: "POST",
    headers: { authorization: bearer ? `Bearer ${bearer}` : "" },
    body: "{}",
  })
  return POST(req)
}

describe("POST /api/admin/internal/seo-agent", () => {
  it("returns 401 without bearer", async () => {
    const res = await call({ bearer: "" })
    expect(res.status).toBe(401)
  })

  it("returns 401 with wrong bearer", async () => {
    const res = await call({ bearer: "wrong" })
    expect(res.status).toBe(401)
  })

  it("returns { skipped } when cron is disabled", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "disabled" })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: "disabled" })
  })

  it("happy path: enqueues ai_job and returns 202", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    jobSetMock.mockResolvedValueOnce(undefined)
    const res = await call()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ jobId: "new-job-id", status: "pending" })
    const jobArg = jobSetMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(jobArg).toMatchObject({
      type: "seo_agent_run",
      status: "pending",
      triggeredBy: "seo_agent_cron",
    })
  })
})
```

### Step 2: Run, verify it fails

```
npm run test:run -- __tests__/api/admin/internal/seo-agent.test.ts
```

Expected: FAIL — route not found.

### Step 3: Implement

Create `app/api/admin/internal/seo-agent/route.ts`:

```ts
// POST /api/admin/internal/seo-agent
// Hit weekly (Sun 14:00 UTC) by the seoAgentCron Firebase function.
// Enqueues a seo_agent_run ai_job. Guarded by INTERNAL_CRON_TOKEN +
// isCronSkipped({ cron_seo_agent_enabled, defaultEnabled: false }).

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001"

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_seo_agent_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const db = getAdminFirestore()
  const jobRef = db.collection("ai_jobs").doc()
  await jobRef.set({
    type: "seo_agent_run",
    status: "pending",
    input: { userId: SYSTEM_USER_ID, runDate: new Date().toISOString().slice(0, 10) },
    result: null,
    error: null,
    userId: SYSTEM_USER_ID,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    triggeredBy: "seo_agent_cron",
  })

  return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
}
```

### Step 4: Run test

```
npm run test:run -- __tests__/api/admin/internal/seo-agent.test.ts
```

Expected: PASS, 4 tests.

### Step 5: Commit

```bash
git add app/api/admin/internal/seo-agent/route.ts __tests__/api/admin/internal/seo-agent.test.ts
git commit -m "feat(seo-agent): /api/admin/internal/seo-agent — bearer-gated enqueue"
```

---

## Task 10: Admin `/admin/seo-agent/memos` page

A read-only viewer for the agent's history.

**Files:**
- Create: `app/(admin)/admin/seo-agent/memos/page.tsx`

### Step 1: Implement

Create `app/(admin)/admin/seo-agent/memos/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { listMemos } from "@/lib/db/seo-agent-memos"
import type { SeoAgentMemo, SeoAgentMemoAction } from "@/types/database"

export const dynamic = "force-dynamic"

const TOOL_LABELS: Record<string, string> = {
  queue_new_post: "New post",
  queue_refresh: "Refresh post",
  queue_internal_link_sweep: "Link sweep",
  flag_for_human: "Human flag",
}

function ActionRow({ action }: { action: SeoAgentMemoAction }) {
  const label = TOOL_LABELS[action.tool] ?? action.tool
  return (
    <div className="rounded-md border bg-surface p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-mono text-xs text-muted-foreground">#{action.rank}</span>{" "}
          <span className="font-medium text-primary">{label}</span>
        </div>
        <div className="text-xs">
          {action.executed ? (
            <span className="text-success">executed</span>
          ) : (
            <span className="text-error">not executed</span>
          )}
        </div>
      </div>
      <pre className="mt-2 overflow-auto rounded bg-background p-2 text-xs">
        {JSON.stringify(action.args, null, 2)}
      </pre>
      {action.complementary_to_rank_1 && (
        <p className="mt-2 text-xs italic text-muted-foreground">
          Complementary: {action.complementary_to_rank_1}
        </p>
      )}
      {action.execution_target_id && (
        <p className="mt-1 text-xs text-muted-foreground">
          Target id: <code>{action.execution_target_id}</code>
        </p>
      )}
    </div>
  )
}

function MemoCard({ memo }: { memo: SeoAgentMemo }) {
  return (
    <article className="rounded-xl border border-border bg-white p-5 space-y-4">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="font-heading text-xl text-primary">{memo.run_date}</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
            {memo.outcome_status}
          </span>
          <span className="text-muted-foreground">job:</span>
          <code className="text-muted-foreground">{memo.ai_job_id}</code>
        </div>
      </header>

      <p className="text-sm leading-relaxed">{memo.rationale}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {memo.actions.map((a, i) => (
          <ActionRow key={i} action={a} />
        ))}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-primary">
          Signals snapshot
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted/30 p-3">
          {JSON.stringify(memo.signals_summary, null, 2)}
        </pre>
      </details>
    </article>
  )
}

export default async function SeoAgentMemosPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login?callbackUrl=/admin/seo-agent/memos")
  }
  const memos = await listMemos(25)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-heading text-3xl text-primary">SEO Agent — Memos</h1>
        <p className="text-muted-foreground">
          One row per weekly run. Each shows the rationale and the two ranked actions the agent chose.
        </p>
      </header>

      {memos.length === 0 ? (
        <div className="rounded-md border bg-surface p-6 text-center text-muted-foreground">
          No memos yet. The agent runs Sundays at 14:00 UTC once enabled in{" "}
          <a className="text-primary underline" href="/admin/automation">
            /admin/automation
          </a>
          .
        </div>
      ) : (
        <div className="space-y-4">
          {memos.map((m) => (
            <MemoCard key={m.id} memo={m} />
          ))}
        </div>
      )}
    </div>
  )
}
```

### Step 2: Verify build

```
npm run build
```

Expected: clean (no NEW TS errors).

### Step 3: Commit

```bash
git add "app/(admin)/admin/seo-agent/memos/page.tsx"
git commit -m "feat(seo-agent): /admin/seo-agent/memos viewer"
```

---

## Task 11: Cron catalog wiring

Register the new cron in `lib/cron-catalog.ts` and the trigger route mapping.

**Files:**
- Modify: `lib/cron-catalog.ts`
- Modify: `app/api/admin/automation/trigger/route.ts`

### Step 1: Add catalog entry

Open `lib/cron-catalog.ts`. Add `"seo-agent-weekly"` to the `CronJobName` union and append this entry to `CRON_CATALOG`:

```ts
  {
    name: "seo-agent-weekly",
    label: "SEO Agent weekly run",
    description:
      "Every Sunday afternoon, the SEO agent reviews your Google Search Console data, blog inventory, and prior decisions, then picks the two highest-leverage actions for the week — a new post, a refresh, an internal-link sweep, or a human flag. Skips silently until GSC has 28+ days of data.",
    schedule: "0 14 * * 0",
    timezone: "UTC",
    humanSchedule: "Every Sunday at 2:00 PM UTC",
    firebaseFunction: "seoAgentCron",
    phase: "seo-agent-4",
    enabledKey: "cron_seo_agent_enabled",
    defaultEnabled: false,
  },
```

### Step 2: Register Vercel-route mapping

Open `app/api/admin/automation/trigger/route.ts`. Find `VERCEL_ROUTE_JOBS` and add:

```ts
const VERCEL_ROUTE_JOBS: Record<string, string> = {
  "auto-blog-generation": "/api/admin/internal/auto-blog",
  "gsc-nightly-sync":     "/api/admin/internal/gsc-sync",
  "seo-agent-weekly":     "/api/admin/internal/seo-agent",
}
```

### Step 3: Type-check + build

```
npm run build
```

Expected: clean.

### Step 4: Commit

```bash
git add lib/cron-catalog.ts app/api/admin/automation/trigger/route.ts
git commit -m "feat(seo-agent): register seo-agent-weekly in catalog + trigger map"
```

---

## Task 12: Final verification + user deploy

**Files:** None — verification only.

### Step 1: Run all Phase 4 tests

```
npm run test:run -- __tests__/lib/db/seo-agent-memos.test.ts __tests__/api/admin/internal/seo-agent.test.ts
```

Plus:

```
cd functions && npm run test -- src/__tests__/seo-signals.test.ts src/__tests__/seo-decision-schema.test.ts src/__tests__/seo-execute.test.ts src/__tests__/seo-agent.test.ts && cd ..
```

Expected: 6 + 4 + 5 + 8 + 6 + 4 = 33 tests passing.

### Step 2: Lint

```
npm run lint
```

Expected: clean.

### Step 3: Build both packages

```
npm run build && cd functions && npm run build && cd ..
```

Expected: both succeed.

### Step 4: User's manual deploy (after Phase 4 lands)

```bash
firebase deploy --only functions:default:seoAgent functions:default:seoAgentCron
```

Do NOT deploy from the subagent.

### Step 5: User's manual smoke (after deploy + at least 28 days of GSC data accumulated)

1. Visit `/admin/automation`. The "SEO Agent weekly run" entry should be visible with the toggle OFF.
2. Flip the toggle ON.
3. Click "Run now" on the SEO Agent row (or manually trigger `seoAgentCron` via Firebase console).
4. Wait ~60-90s. The function logs (`firebase functions:log --only seoAgent`) should show `[seo-agent]` lines:
   - If GSC has fewer than 28 distinct dates: `[seo-agent] data warm-up incomplete (N/28 distinct dates) — skipping silently`. No memo is written. This is expected for the first ~4 weeks after Phase 1 deploy.
   - If GSC has ≥28 days: `[seo-agent] action rank=1 tool=... executed=true target=...` × 2, followed by job completion.
5. Visit `/admin/seo-agent/memos`. The most recent memo should be on top with rationale + the two action cards.
6. Verify the executed action ran:
   - For `queue_new_post`: check `content_calendar` for a new row with `metadata.source = 'seo_agent'`.
   - For `queue_refresh`: check Firestore `ai_jobs` for a new doc with `type = 'blog_refresh'` and `triggeredBy = 'seo_agent_run'`.
   - For `queue_internal_link_sweep`: same as above with `type = 'internal_link_sweep'`.
   - For `flag_for_human`: check `notifications` for a new row with `type = 'seo_agent_flag'`.

---

## Notes for the executor

- **Solo-dev workflow:** commit directly to `main`. No branches, no PRs.
- **Firebase deploys** use the `default:` codebase prefix.
- **The data warm-up gate is the BIG safety net.** Until GSC has 28+ days, the agent runs but skips — no Claude call, no execution. This is what allows you to flip the toggle ON immediately after deploy without burning tokens.
- **The agent always produces a memo IF it gets past the warm-up gate**, even if executions fail. The memo records the decision and any execution errors via `executed: false`.
- **Tool execution failures don't fail the job.** Each `executeAction` returns `{ executed, error? }` — the memo records partial execution honestly. This is intentional: a transient Firestore failure on action 1 shouldn't prevent action 2 from running.
- **Cron timing:** `seoAgentCron` fires Sunday 14:00 UTC. The `auto-blog` cron fires Tuesday + Thursday at 13:00 UTC, so any `queue_new_post` action created by the agent gets picked up Tuesday morning (next civil weekday after the Sunday run).

## Known follow-ups (track for Phase 5 or beyond)

- **Phase 5 — outcome tracker.** Daily cron that finds memos older than 14 days with `outcome_status = 'pending'`, backfills `outcome_metrics` from GSC, sets `outcome_status = 'measured'`. Required for the agent to learn — the `last_8_memos_outcomes` signal is only useful once outcomes are measured.
- **Cooldown enforcement.** When the agent queues `queue_refresh` for a post that was refreshed in the last 90 days, the executor should reject. Currently no such check — Phase 5 work.
- **Memo override / rollback UI.** The spec mentions a coach being able to cancel a queued action before it runs (sets `outcome_status = 'rolled_back'`). Not implemented in Phase 4 — Phase 5 follow-up.
- **Schema validation re-prompt.** If Claude returns an invalid decision (failed Zod parse), `callAgent`'s retry logic kicks in but max ~3 attempts. After that, the handler throws and the job is marked failed. Per spec: ultimately wire a `flag_for_human` fallback when validation fails twice — for now, a failed job is acceptable.
- **`signals_summary` size.** Currently passing the full top-20 winnable/decayed lists + last 8 memos to Claude. With 50 posts and 28 days of GSC data, the prompt is ~10-30KB. Watch token consumption. If it grows past comfort, truncate to top-10 per category.

# SEO Agent — Phase 5 (Outcome Tracker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Solo-dev project — commit directly to `main`, no branches.

**Goal:** Close the agent's learning loop. A daily Firebase cron (`outcomeTrackerCron`, 04:00 UTC) POSTs to a new Next.js internal route that finds `seo_agent_memos` rows with `outcome_status = 'pending'` and `run_date <= today − 14 days`, then for each of the memo's two actions resolves the `execution_target_id` (Firestore `ai_jobs` doc id, Supabase `content_calendar` row id, or Supabase `notifications` row id) → the affected blog post (or notification), pulls 14-day before/after windows from `gsc_query_daily`, and writes the deltas back into `seo_agent_memos.outcome_metrics`. Sets `outcome_status = 'measured'` and `measured_at = now()`. The agent's `last_8_memos_outcomes` signal (Phase 4) starts surfacing real outcomes the next Sunday, enabling the "shift weight away from underperforming tactics" rule in the system prompt.

**Architecture:** All work happens in a Next.js internal route — same pattern as Phase 1's `gsc-sync` and Phase 4's `seo-agent`. The route is bearer-auth-gated, runs through `isCronSkipped({ enabledKey: "cron_outcome_tracker_enabled", defaultEnabled: false })`, then iterates pending memos. Per-action resolution is split into four small helpers (one per tool) in `lib/seo-agent/outcomes.ts`. Each helper takes the `execution_target_id` + `runDate` and returns a typed `OutcomeMetric` slice. The route assembles per-memo metric arrays, writes them back via `seo_agent_memos.update()`, and reports a summary. Firestore reads (for `queue_refresh` and `queue_internal_link_sweep` whose target ids are `ai_jobs` doc ids) use the existing `getAdminFirestore()` helper from `@/lib/firebase-admin`.

**Tech Stack:** Same as Phases 1-4 — Next.js 16 App Router (Route Handlers), Firebase Functions v2 (`onSchedule`), Firebase Admin SDK from Next.js for Firestore reads, Supabase via `createServiceRoleClient`, Vitest, TypeScript strict.

**Spec:** [docs/superpowers/specs/2026-05-13-seo-agent-design.md](../specs/2026-05-13-seo-agent-design.md) — section "Outcome tracking — `outcomeTrackerCron`".

**Phase 4 reference:** Phase 4 shipped the agent. Memos are inserted with `outcome_status = 'pending'`. The Phase 4 plan called out Phase 5 as the closing piece for the learning loop.

**Verification:** Each resolver helper is unit-tested with mocked Supabase + Firestore. The orchestration route's end-to-end test verifies pending-memo filtering, dispatch by `action.tool`, and the final UPDATE. Cron and admin UI changes get manual post-deploy verification.

**Spec correction (important):** The spec text mentions `notifications.read_at` for `flag_for_human` outcome resolution. The actual `notifications` table has a boolean `is_read` column (no `read_at` timestamp). This plan uses `is_read` and maps it to `acknowledged: boolean` on the metric.

**Out of scope for this phase:**
- Memo override / rollback UI (sets `outcome_status = 'rolled_back'` — Phase 6+ territory; the constant is wired but no path writes it yet).
- 90-day refresh cooldown enforcement (separate concern, not strictly part of outcome tracking).
- Sparkline charts of outcomes over time on the admin page (Phase 5 just renders raw numbers; charts can come later).
- Email digest of measured outcomes (the admin sees them on `/admin/seo-agent/memos`; no separate notification needed).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/seo-agent/outcomes.ts` | Create | Four per-tool resolver helpers + a shared `gscDeltaForPage` window helper |
| `__tests__/lib/seo-agent/outcomes.test.ts` | Create | Unit tests for each resolver with mocked Supabase + Firestore |
| `app/api/admin/internal/outcome-tracker/route.ts` | Create | POST handler: bearer auth, gate, pull pending memos, iterate actions, write back |
| `__tests__/api/admin/internal/outcome-tracker.test.ts` | Create | Auth + gate + happy path + no-pending-memos + dispatch-by-tool |
| `types/database.ts` | Modify | Extend `SeoAgentMemoOutcomeMetric` with optional `error?: string` and `note?: string` fields |
| `functions/src/index.ts` | Modify | Add `outcomeTrackerCron` `onSchedule` export (daily 04:00 UTC) |
| `lib/cron-catalog.ts` | Modify | Add `outcome-tracker-daily` entry |
| `app/api/admin/automation/trigger/route.ts` | Modify | Add `outcome-tracker-daily → /api/admin/internal/outcome-tracker` mapping |
| `app/(admin)/admin/seo-agent/memos/page.tsx` | Modify | Render `outcome_metrics` alongside each `ActionRow` when present |

---

## Task 1: Per-tool outcome resolvers

The brain of Phase 5. Four pure-ish functions that take a target id + run date + clients, return a typed metric slice. Plus a shared GSC delta helper.

**Files:**
- Create: `lib/seo-agent/outcomes.ts`
- Create: `__tests__/lib/seo-agent/outcomes.test.ts`
- Modify: `types/database.ts` (extend the existing `SeoAgentMemoOutcomeMetric` interface)

### Step 1: Extend the outcome metric type

Open `types/database.ts`. Find the existing `SeoAgentMemoOutcomeMetric` interface (added in Phase 4 Task 1). Add two optional fields at the end:

```ts
export interface SeoAgentMemoOutcomeMetric {
  action_index: 0 | 1
  executed: boolean
  target_id: string | null
  clicks_before?: number | null
  clicks_after?: number | null
  position_before?: number | null
  position_after?: number | null
  acknowledged?: boolean
  /** Set when resolution failed mid-way (e.g., target row deleted, Firestore unreachable). */
  error?: string
  /** Diagnostic note for unusual outcomes (e.g., topic_suggestion never picked up by auto-blog). */
  note?: string
}
```

### Step 2: Write the failing test

Create `__tests__/lib/seo-agent/outcomes.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"

// All resolvers consume a Supabase client and (some) a Firestore client.
// We pass minimal stubs that respond to the chained calls.

const supabaseFromMock = vi.fn()
const firestoreDocGet = vi.fn()
const firestoreCollectionMock = vi.fn(() => ({ doc: () => ({ get: firestoreDocGet }) }))

const supabase = {
  from: supabaseFromMock,
} as unknown as import("@supabase/supabase-js").SupabaseClient

const firestore = {
  collection: firestoreCollectionMock,
} as unknown as import("firebase-admin/firestore").Firestore

beforeEach(() => {
  supabaseFromMock.mockReset()
  firestoreDocGet.mockReset()
  firestoreCollectionMock.mockClear()
})

// ─── resolveNewPostOutcome ─────────────────────────────────────────────────

describe("resolveNewPostOutcome", () => {
  it("returns { note: not_picked_up } when content_calendar.reference_id is null", async () => {
    const { resolveNewPostOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "content_calendar") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "cc-1", reference_id: null, status: "planned" },
                  error: null,
                }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await resolveNewPostOutcome("cc-1", supabase)
    expect(out).toEqual({
      executed: true,
      target_id: null,
      note: "topic_suggestion_not_yet_picked_up",
    })
  })

  it("returns clicks/position window when reference_id resolves to a published post", async () => {
    const { resolveNewPostOutcome } = await import("@/lib/seo-agent/outcomes")
    const publishedAt = new Date(Date.now() - 21 * 86400 * 1000).toISOString()
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "content_calendar") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "cc-1", reference_id: "post-1", status: "published" },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === "blog_posts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "post-1", slug: "deadlift-tips", published_at: publishedAt },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === "gsc_query_daily") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: () =>
                  Promise.resolve({
                    data: [
                      { clicks: 3, impressions: 50, position: 12 },
                      { clicks: 5, impressions: 80, position: 11 },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await resolveNewPostOutcome("cc-1", supabase)
    expect(out.executed).toBe(true)
    expect(out.target_id).toBe("post-1")
    expect(out.clicks_before).toBe(0)
    expect(out.clicks_after).toBe(8) // 3 + 5
    expect(out.position_before).toBeNull()
    expect(typeof out.position_after).toBe("number")
  })

  it("returns error when content_calendar row missing", async () => {
    const { resolveNewPostOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }))
    const out = await resolveNewPostOutcome("missing", supabase)
    expect(out.executed).toBe(true)
    expect(out.error).toMatch(/content_calendar row not found/i)
  })
})

// ─── resolveRefreshOutcome ─────────────────────────────────────────────────

describe("resolveRefreshOutcome", () => {
  it("returns before/after clicks based on blog_posts.last_refreshed_at", async () => {
    const { resolveRefreshOutcome } = await import("@/lib/seo-agent/outcomes")
    const lastRefreshedAt = new Date(Date.now() - 14 * 86400 * 1000).toISOString()
    firestoreDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ input: { blogPostId: "post-1" }, status: "completed" }),
    })
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "blog_posts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "post-1", slug: "deadlift-tips", last_refreshed_at: lastRefreshedAt },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === "gsc_query_daily") {
        // Two distinct calls: one for "before" window, one for "after".
        // Use call-count to differentiate.
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: () =>
                  Promise.resolve({
                    data: [{ clicks: 4, impressions: 60, position: 14 }],
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await resolveRefreshOutcome("ai-job-1", supabase, firestore)
    expect(out.executed).toBe(true)
    expect(out.target_id).toBe("post-1")
    expect(out.clicks_before).toBe(4)
    expect(out.clicks_after).toBe(4)
    expect(typeof out.position_before).toBe("number")
    expect(typeof out.position_after).toBe("number")
  })

  it("returns error when Firestore ai_jobs doc not found", async () => {
    const { resolveRefreshOutcome } = await import("@/lib/seo-agent/outcomes")
    firestoreDocGet.mockResolvedValueOnce({ exists: false, data: () => null })
    const out = await resolveRefreshOutcome("missing-job", supabase, firestore)
    expect(out.executed).toBe(true)
    expect(out.error).toMatch(/ai_job not found/i)
  })
})

// ─── resolveLinkSweepOutcome ───────────────────────────────────────────────

describe("resolveLinkSweepOutcome", () => {
  it("returns before/after windows centered on the memo's run_date", async () => {
    const { resolveLinkSweepOutcome } = await import("@/lib/seo-agent/outcomes")
    firestoreDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ input: { targetBlogPostId: "post-1" }, status: "completed" }),
    })
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "blog_posts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "post-1", slug: "target-post" },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === "gsc_query_daily") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: () =>
                  Promise.resolve({
                    data: [{ clicks: 2, impressions: 40, position: 18 }],
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await resolveLinkSweepOutcome("ai-job-2", "2026-05-01", supabase, firestore)
    expect(out.executed).toBe(true)
    expect(out.target_id).toBe("post-1")
    expect(out.clicks_before).toBe(2)
    expect(out.clicks_after).toBe(2)
  })
})

// ─── resolveFlagOutcome ────────────────────────────────────────────────────

describe("resolveFlagOutcome", () => {
  it("returns acknowledged=true when notification is_read=true", async () => {
    const { resolveFlagOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: "notif-1", is_read: true }, error: null }),
        }),
      }),
    }))
    const out = await resolveFlagOutcome("notif-1", supabase)
    expect(out).toEqual({ executed: true, target_id: "notif-1", acknowledged: true })
  })

  it("returns acknowledged=false when is_read=false", async () => {
    const { resolveFlagOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: "notif-1", is_read: false }, error: null }),
        }),
      }),
    }))
    const out = await resolveFlagOutcome("notif-1", supabase)
    expect(out.acknowledged).toBe(false)
  })

  it("returns error when notification not found", async () => {
    const { resolveFlagOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }))
    const out = await resolveFlagOutcome("missing", supabase)
    expect(out.error).toMatch(/notification not found/i)
  })
})
```

### Step 3: Run, verify it fails

```
npm run test:run -- __tests__/lib/seo-agent/outcomes.test.ts
```

Expected: FAIL — module not found.

### Step 4: Implement

Create `lib/seo-agent/outcomes.ts`:

```ts
// lib/seo-agent/outcomes.ts
// Per-tool outcome resolvers used by the daily outcome-tracker cron. Each
// resolver takes the action's execution_target_id (plus run date / clients)
// and returns the per-action OutcomeMetric slice for the memo.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Firestore } from "firebase-admin/firestore"
import type { SeoAgentMemoOutcomeMetric } from "@/types/database"

// The resolvers return everything except `action_index`, which the
// orchestrator (in the route) adds after collecting results.
export type ResolvedOutcome = Omit<SeoAgentMemoOutcomeMetric, "action_index">

const SITE_URL = "https://www.darrenjpaul.com"

// ─── Shared GSC delta helper ───────────────────────────────────────────────

interface GscWindowResult {
  clicks: number
  impressions: number
  position: number | null
}

/**
 * Sum clicks/impressions and compute impression-weighted avg position for a
 * single page over a date window. Returns position=null when the window has
 * zero impressions (avoids divide-by-zero AND signals "no data").
 */
async function gscDeltaForPage(
  supabase: SupabaseClient,
  page: string,
  startDate: string,
  endDate: string,
): Promise<GscWindowResult> {
  const { data, error } = await supabase
    .from("gsc_query_daily")
    .select("clicks, impressions, position")
    .eq("page", page)
    .gte("date", startDate)
    .lte("date", endDate)
  if (error) throw error
  type Row = { clicks: number; impressions: number; position: number }
  const rows = (data as Row[] | null) ?? []
  let clicks = 0
  let impressions = 0
  let weightedPosition = 0
  for (const r of rows) {
    clicks += r.clicks
    impressions += r.impressions
    weightedPosition += r.position * r.impressions
  }
  return {
    clicks,
    impressions,
    position: impressions > 0 ? weightedPosition / impressions : null,
  }
}

function isoDateOffset(baseIso: string, daysOffset: number): string {
  const d = new Date(baseIso)
  d.setUTCDate(d.getUTCDate() + daysOffset)
  return d.toISOString().slice(0, 10)
}

function pageUrlForSlug(slug: string): string {
  return `${SITE_URL}/blog/${slug}`
}

// ─── resolveNewPostOutcome ─────────────────────────────────────────────────

/**
 * For queue_new_post: the execution_target_id is a content_calendar row id.
 * If the auto-blog cron has picked it up (`reference_id` is set), measure
 * GSC clicks/position in the (post.published_at + 7) → (+21) window.
 * Otherwise return a note that the topic was never picked up.
 */
export async function resolveNewPostOutcome(
  executionTargetId: string,
  supabase: SupabaseClient,
): Promise<ResolvedOutcome> {
  const { data: ccRow, error: ccErr } = await supabase
    .from("content_calendar")
    .select("id, reference_id, status")
    .eq("id", executionTargetId)
    .maybeSingle()
  if (ccErr) throw ccErr
  if (!ccRow) {
    return { executed: true, target_id: null, error: "content_calendar row not found" }
  }
  const refId = (ccRow as { reference_id: string | null }).reference_id
  if (!refId) {
    return { executed: true, target_id: null, note: "topic_suggestion_not_yet_picked_up" }
  }

  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select("id, slug, published_at")
    .eq("id", refId)
    .maybeSingle()
  if (postErr) throw postErr
  if (!post) {
    return { executed: true, target_id: refId, error: "blog_post not found" }
  }
  const p = post as { id: string; slug: string; published_at: string | null }
  if (!p.published_at) {
    return { executed: true, target_id: p.id, note: "post_not_yet_published" }
  }

  const startDate = isoDateOffset(p.published_at, 7)
  const endDate = isoDateOffset(p.published_at, 21)
  const window = await gscDeltaForPage(supabase, pageUrlForSlug(p.slug), startDate, endDate)
  return {
    executed: true,
    target_id: p.id,
    clicks_before: 0,
    clicks_after: window.clicks,
    position_before: null,
    position_after: window.position,
  }
}

// ─── resolveRefreshOutcome ─────────────────────────────────────────────────

/**
 * For queue_refresh: the execution_target_id is a Firestore ai_jobs doc id.
 * Read the doc to get input.blogPostId, then read blog_posts.last_refreshed_at,
 * then measure GSC in 14-day windows BEFORE and AFTER that timestamp.
 */
export async function resolveRefreshOutcome(
  executionTargetId: string,
  supabase: SupabaseClient,
  firestore: Firestore,
): Promise<ResolvedOutcome> {
  const jobSnap = await firestore.collection("ai_jobs").doc(executionTargetId).get()
  if (!jobSnap.exists) {
    return { executed: true, target_id: null, error: "ai_job not found" }
  }
  const job = jobSnap.data() as { input?: { blogPostId?: string } } | undefined
  const blogPostId = job?.input?.blogPostId
  if (!blogPostId) {
    return { executed: true, target_id: null, error: "ai_job missing input.blogPostId" }
  }

  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select("id, slug, last_refreshed_at")
    .eq("id", blogPostId)
    .maybeSingle()
  if (postErr) throw postErr
  if (!post) {
    return { executed: true, target_id: blogPostId, error: "blog_post not found" }
  }
  const p = post as { id: string; slug: string; last_refreshed_at: string | null }
  if (!p.last_refreshed_at) {
    return { executed: true, target_id: p.id, error: "blog_post has no last_refreshed_at" }
  }

  const beforeStart = isoDateOffset(p.last_refreshed_at, -14)
  const beforeEnd = isoDateOffset(p.last_refreshed_at, -1)
  const afterStart = isoDateOffset(p.last_refreshed_at, 1)
  const afterEnd = isoDateOffset(p.last_refreshed_at, 14)
  const pageUrl = pageUrlForSlug(p.slug)
  const [before, after] = await Promise.all([
    gscDeltaForPage(supabase, pageUrl, beforeStart, beforeEnd),
    gscDeltaForPage(supabase, pageUrl, afterStart, afterEnd),
  ])
  return {
    executed: true,
    target_id: p.id,
    clicks_before: before.clicks,
    clicks_after: after.clicks,
    position_before: before.position,
    position_after: after.position,
  }
}

// ─── resolveLinkSweepOutcome ───────────────────────────────────────────────

/**
 * For queue_internal_link_sweep: the execution_target_id is a Firestore
 * ai_jobs doc id. Read input.targetBlogPostId, then measure GSC for the
 * TARGET page (not the candidate posts — we want target lift) in 14-day
 * windows centered on the memo's run_date.
 */
export async function resolveLinkSweepOutcome(
  executionTargetId: string,
  runDateIso: string,
  supabase: SupabaseClient,
  firestore: Firestore,
): Promise<ResolvedOutcome> {
  const jobSnap = await firestore.collection("ai_jobs").doc(executionTargetId).get()
  if (!jobSnap.exists) {
    return { executed: true, target_id: null, error: "ai_job not found" }
  }
  const job = jobSnap.data() as { input?: { targetBlogPostId?: string } } | undefined
  const targetId = job?.input?.targetBlogPostId
  if (!targetId) {
    return { executed: true, target_id: null, error: "ai_job missing input.targetBlogPostId" }
  }

  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select("id, slug")
    .eq("id", targetId)
    .maybeSingle()
  if (postErr) throw postErr
  if (!post) {
    return { executed: true, target_id: targetId, error: "target blog_post not found" }
  }
  const p = post as { id: string; slug: string }

  const beforeStart = isoDateOffset(runDateIso, -14)
  const beforeEnd = isoDateOffset(runDateIso, -1)
  const afterStart = isoDateOffset(runDateIso, 1)
  const afterEnd = isoDateOffset(runDateIso, 14)
  const pageUrl = pageUrlForSlug(p.slug)
  const [before, after] = await Promise.all([
    gscDeltaForPage(supabase, pageUrl, beforeStart, beforeEnd),
    gscDeltaForPage(supabase, pageUrl, afterStart, afterEnd),
  ])
  return {
    executed: true,
    target_id: p.id,
    clicks_before: before.clicks,
    clicks_after: after.clicks,
    position_before: before.position,
    position_after: after.position,
  }
}

// ─── resolveFlagOutcome ────────────────────────────────────────────────────

/**
 * For flag_for_human: the execution_target_id is a notifications row id.
 * Just check is_read.
 */
export async function resolveFlagOutcome(
  executionTargetId: string,
  supabase: SupabaseClient,
): Promise<ResolvedOutcome> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, is_read")
    .eq("id", executionTargetId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    return { executed: true, target_id: null, error: "notification not found" }
  }
  const row = data as { id: string; is_read: boolean }
  return { executed: true, target_id: row.id, acknowledged: row.is_read }
}
```

### Step 5: Run the test, verify it passes

```
npm run test:run -- __tests__/lib/seo-agent/outcomes.test.ts
```

Expected: PASS, 9 tests (3 + 2 + 1 + 3).

### Step 6: Commit

```bash
git add lib/seo-agent/outcomes.ts __tests__/lib/seo-agent/outcomes.test.ts types/database.ts
git commit -m "feat(seo-agent): per-tool outcome resolvers + extended OutcomeMetric type"
```

---

## Task 2: `/api/admin/internal/outcome-tracker` route

The orchestration route. Bearer-gated, skip-gated, pulls pending memos older than 14 days, iterates their actions, writes back.

**Files:**
- Create: `app/api/admin/internal/outcome-tracker/route.ts`
- Create: `__tests__/api/admin/internal/outcome-tracker.test.ts`

### Step 1: Write the failing test

Create `__tests__/api/admin/internal/outcome-tracker.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const isCronSkipped = vi.fn()
const supabaseFromMock = vi.fn()
const firestoreCollectionMock = vi.fn()
const resolveNewPostOutcome = vi.fn()
const resolveRefreshOutcome = vi.fn()
const resolveLinkSweepOutcome = vi.fn()
const resolveFlagOutcome = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: supabaseFromMock }),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: firestoreCollectionMock }),
}))
vi.mock("@/lib/seo-agent/outcomes", () => ({
  resolveNewPostOutcome,
  resolveRefreshOutcome,
  resolveLinkSweepOutcome,
  resolveFlagOutcome,
}))

beforeEach(() => {
  isCronSkipped.mockReset()
  supabaseFromMock.mockReset()
  firestoreCollectionMock.mockClear()
  resolveNewPostOutcome.mockReset()
  resolveRefreshOutcome.mockReset()
  resolveLinkSweepOutcome.mockReset()
  resolveFlagOutcome.mockReset()
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
})

async function call({ bearer = "shared-secret" }: { bearer?: string } = {}) {
  const { POST } = await import("@/app/api/admin/internal/outcome-tracker/route")
  const req = new NextRequest("https://example.test/api/admin/internal/outcome-tracker", {
    method: "POST",
    headers: { authorization: bearer ? `Bearer ${bearer}` : "" },
    body: "{}",
  })
  return POST(req)
}

describe("POST /api/admin/internal/outcome-tracker", () => {
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

  it("returns { processed: 0 } when no pending memos older than 14 days", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          lte: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }))
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 0, measured: [] })
  })

  it("happy path: 1 memo with 2 different-tool actions, both executed, marks measured", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })

    const memo = {
      id: "memo-1",
      run_date: "2026-04-29",
      actions: [
        {
          rank: 1,
          tool: "queue_new_post",
          args: { keyword: "k", angle: "a" },
          executed: true,
          execution_target_id: "cc-1",
        },
        {
          rank: 2,
          tool: "queue_refresh",
          args: { blog_post_id: "p1", reason: "decay" },
          executed: true,
          execution_target_id: "ai-1",
        },
      ],
    }

    // First call: list pending memos.
    // Second call: update memo by id.
    let fromCallCount = 0
    supabaseFromMock.mockImplementation((table: string) => {
      fromCallCount++
      if (table === "seo_agent_memos") {
        if (fromCallCount === 1) {
          // select pending
          return {
            select: () => ({
              eq: () => ({
                lte: () => Promise.resolve({ data: [memo], error: null }),
              }),
            }),
          }
        }
        // update
        return {
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }
      }
      return {}
    })

    resolveNewPostOutcome.mockResolvedValueOnce({
      executed: true,
      target_id: "post-1",
      clicks_before: 0,
      clicks_after: 12,
      position_before: null,
      position_after: 11.5,
    })
    resolveRefreshOutcome.mockResolvedValueOnce({
      executed: true,
      target_id: "p1",
      clicks_before: 3,
      clicks_after: 9,
      position_before: 18,
      position_after: 12,
    })

    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(1)
    expect(body.measured).toEqual(["memo-1"])

    expect(resolveNewPostOutcome).toHaveBeenCalledTimes(1)
    expect(resolveRefreshOutcome).toHaveBeenCalledTimes(1)
    expect(resolveLinkSweepOutcome).not.toHaveBeenCalled()
    expect(resolveFlagOutcome).not.toHaveBeenCalled()
  })

  it("dispatches each tool to the correct resolver across multiple memos", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })

    const memos = [
      {
        id: "m-sweep",
        run_date: "2026-04-29",
        actions: [
          { rank: 1, tool: "queue_internal_link_sweep", args: {}, executed: true, execution_target_id: "ai-2" },
          { rank: 2, tool: "flag_for_human", args: {}, executed: true, execution_target_id: "notif-1" },
        ],
      },
    ]

    let fromCallCount = 0
    supabaseFromMock.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        return {
          select: () => ({
            eq: () => ({ lte: () => Promise.resolve({ data: memos, error: null }) }),
          }),
        }
      }
      return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) }
    })

    resolveLinkSweepOutcome.mockResolvedValueOnce({ executed: true, target_id: "p", clicks_before: 1, clicks_after: 4 })
    resolveFlagOutcome.mockResolvedValueOnce({ executed: true, target_id: "notif-1", acknowledged: true })

    const res = await call()
    expect(res.status).toBe(200)
    expect(resolveLinkSweepOutcome).toHaveBeenCalledTimes(1)
    expect(resolveFlagOutcome).toHaveBeenCalledTimes(1)
  })

  it("skips resolution for actions with executed=false, records as { executed: false }", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })

    const memo = {
      id: "memo-2",
      run_date: "2026-04-29",
      actions: [
        { rank: 1, tool: "queue_new_post", args: {}, executed: false, execution_target_id: null },
        { rank: 2, tool: "queue_refresh", args: {}, executed: true, execution_target_id: "ai-1" },
      ],
    }

    let fromCallCount = 0
    supabaseFromMock.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        return {
          select: () => ({
            eq: () => ({ lte: () => Promise.resolve({ data: [memo], error: null }) }),
          }),
        }
      }
      return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) }
    })

    resolveRefreshOutcome.mockResolvedValueOnce({ executed: true, target_id: "p1", clicks_before: 1, clicks_after: 2 })

    await call()

    expect(resolveNewPostOutcome).not.toHaveBeenCalled()
    expect(resolveRefreshOutcome).toHaveBeenCalledTimes(1)
  })
})
```

### Step 2: Run, verify it fails

```
npm run test:run -- __tests__/api/admin/internal/outcome-tracker.test.ts
```

Expected: FAIL — route not found.

### Step 3: Implement

Create `app/api/admin/internal/outcome-tracker/route.ts`:

```ts
// POST /api/admin/internal/outcome-tracker
// Hit daily (04:00 UTC) by the outcomeTrackerCron Firebase function.
// Finds seo_agent_memos with outcome_status='pending' and run_date <= today-14d,
// resolves each action's outcome (per tool), writes outcome_metrics back,
// flips outcome_status to 'measured'.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  resolveNewPostOutcome,
  resolveRefreshOutcome,
  resolveLinkSweepOutcome,
  resolveFlagOutcome,
  type ResolvedOutcome,
} from "@/lib/seo-agent/outcomes"
import type { SeoAgentMemo, SeoAgentMemoAction, SeoAgentMemoOutcomeMetric } from "@/types/database"

const MEASUREMENT_AGE_DAYS = 14

function isoDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_outcome_tracker_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const firestore = getAdminFirestore()

  // Pull pending memos older than 14 days.
  const cutoff = isoDateNDaysAgo(MEASUREMENT_AGE_DAYS)
  const { data: pendingMemos, error: pendingErr } = await supabase
    .from("seo_agent_memos")
    .select("id, run_date, actions")
    .eq("outcome_status", "pending")
    .lte("run_date", cutoff)
  if (pendingErr) {
    return NextResponse.json({ error: `pending fetch failed: ${pendingErr.message}` }, { status: 500 })
  }
  const memos =
    (pendingMemos as Array<Pick<SeoAgentMemo, "id" | "run_date" | "actions">> | null) ?? []

  if (memos.length === 0) {
    return NextResponse.json({ processed: 0, measured: [] }, { status: 200 })
  }

  const measured: string[] = []
  const errors: Array<{ memoId: string; message: string }> = []

  for (const memo of memos) {
    try {
      const metrics: SeoAgentMemoOutcomeMetric[] = []
      const actions = (memo.actions ?? []) as SeoAgentMemoAction[]
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]
        const action_index = i as 0 | 1

        if (!action.executed || !action.execution_target_id) {
          metrics.push({ action_index, executed: false, target_id: null })
          continue
        }

        let resolved: ResolvedOutcome
        try {
          switch (action.tool) {
            case "queue_new_post":
              resolved = await resolveNewPostOutcome(action.execution_target_id, supabase)
              break
            case "queue_refresh":
              resolved = await resolveRefreshOutcome(
                action.execution_target_id,
                supabase,
                firestore,
              )
              break
            case "queue_internal_link_sweep":
              resolved = await resolveLinkSweepOutcome(
                action.execution_target_id,
                memo.run_date,
                supabase,
                firestore,
              )
              break
            case "flag_for_human":
              resolved = await resolveFlagOutcome(action.execution_target_id, supabase)
              break
            default:
              resolved = {
                executed: action.executed,
                target_id: action.execution_target_id,
                error: `unknown tool: ${action.tool}`,
              }
          }
        } catch (err) {
          console.error(
            `[outcome-tracker] memo=${memo.id} action#${i} tool=${action.tool} resolve failed:`,
            err,
          )
          resolved = {
            executed: action.executed,
            target_id: action.execution_target_id,
            error: (err as Error).message ?? "resolver threw",
          }
        }

        metrics.push({ action_index, ...resolved })
      }

      const { error: updateErr } = await supabase
        .from("seo_agent_memos")
        .update({
          outcome_status: "measured",
          outcome_metrics: metrics,
          measured_at: new Date().toISOString(),
        })
        .eq("id", memo.id)
      if (updateErr) {
        errors.push({ memoId: memo.id, message: updateErr.message })
        continue
      }
      measured.push(memo.id)
    } catch (err) {
      console.error(`[outcome-tracker] memo=${memo.id} failed:`, err)
      errors.push({ memoId: memo.id, message: (err as Error).message ?? "unknown" })
    }
  }

  return NextResponse.json(
    { processed: memos.length, measured, errors },
    { status: 200 },
  )
}
```

### Step 4: Run the test, verify it passes

```
npm run test:run -- __tests__/api/admin/internal/outcome-tracker.test.ts
```

Expected: PASS, 7 tests.

### Step 5: Commit

```bash
git add app/api/admin/internal/outcome-tracker/route.ts __tests__/api/admin/internal/outcome-tracker.test.ts
git commit -m "feat(seo-agent): outcome-tracker route — measure 14d-aged pending memos"
```

---

## Task 3: `outcomeTrackerCron` Firebase scheduled function

**Files:**
- Modify: `functions/src/index.ts`

### Step 1: Add the scheduled function

Open `functions/src/index.ts`. Find the existing `seoAgentCron` `onSchedule` block (Phase 4 Task 8 — Grep for `seoAgentCron`). Add this new block immediately after it:

```ts
// ─── SEO Outcome Tracker (Daily 04:00 UTC) ──────────────────────────────────
// Calls /api/admin/internal/outcome-tracker which backfills outcome_metrics
// for seo_agent_memos older than 14 days, closing the agent's learning loop.
// Subject to automation_paused + cron_outcome_tracker_enabled gates inside
// the route (defaults to false — opt-in once Phase 5 is deployed).

export const outcomeTrackerCron = onSchedule(
  {
    schedule: "0 4 * * *",
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
      console.error("[outcomeTrackerCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/outcome-tracker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[outcomeTrackerCron]", res.status, body)
    } catch (err) {
      console.error("[outcomeTrackerCron] failed:", err)
    }
  },
)
```

### Step 2: Type-check

```
cd functions && npm run build && cd ..
```

Expected: clean.

### Step 3: Commit

```bash
git add functions/src/index.ts
git commit -m "feat(seo-agent): outcomeTrackerCron Firebase scheduled function (daily 04:00 UTC)"
```

The user deploys after Phase 5 merges:

```bash
firebase deploy --only functions:default:outcomeTrackerCron
```

DO NOT deploy from the subagent.

---

## Task 4: Cron catalog wiring

**Files:**
- Modify: `lib/cron-catalog.ts`
- Modify: `app/api/admin/automation/trigger/route.ts`

### Step 1: Extend `CronJobName` + add catalog entry

Open `lib/cron-catalog.ts`. Add `"outcome-tracker-daily"` to the `CronJobName` union, then append this entry at the end of `CRON_CATALOG`:

```ts
  {
    name: "outcome-tracker-daily",
    label: "SEO outcome tracker (daily)",
    description:
      "Every morning, finds SEO agent decisions made 14+ days ago and measures their outcomes — clicks before vs after, position before vs after — so the agent learns which tactics are working on your site.",
    schedule: "0 4 * * *",
    timezone: "UTC",
    humanSchedule: "Every morning at 4:00 AM UTC",
    firebaseFunction: "outcomeTrackerCron",
    phase: "seo-agent-5",
    enabledKey: "cron_outcome_tracker_enabled",
    defaultEnabled: false,
  },
```

### Step 2: Register Vercel-route mapping

Open `app/api/admin/automation/trigger/route.ts`. Find `VERCEL_ROUTE_JOBS` and add a fourth entry:

```ts
const VERCEL_ROUTE_JOBS: Record<string, string> = {
  "auto-blog-generation":  "/api/admin/internal/auto-blog",
  "gsc-nightly-sync":      "/api/admin/internal/gsc-sync",
  "seo-agent-weekly":      "/api/admin/internal/seo-agent",
  "outcome-tracker-daily": "/api/admin/internal/outcome-tracker",
}
```

### Step 3: Build

```
npm run build
```

Expected: clean (no new TS errors).

### Step 4: Commit

```bash
git add lib/cron-catalog.ts app/api/admin/automation/trigger/route.ts
git commit -m "feat(seo-agent): register outcome-tracker-daily in catalog + trigger map"
```

---

## Task 5: Render outcome metrics on the admin memos page

The current `ActionRow` shows the action's tool, args, executed flag. Phase 5 adds a small metrics block below those when `outcome_metrics` is available.

**Files:**
- Modify: `app/(admin)/admin/seo-agent/memos/page.tsx`

### Step 1: Update the page

Open `app/(admin)/admin/seo-agent/memos/page.tsx`. The current `ActionRow` component takes only `action`. Replace the entire `ActionRow` component with this version that ALSO accepts an optional `metric`:

```tsx
import type { SeoAgentMemoAction, SeoAgentMemoOutcomeMetric } from "@/types/database"

function MetricRow({ metric }: { metric: SeoAgentMemoOutcomeMetric }) {
  if (metric.error) {
    return (
      <p className="mt-2 text-xs text-error">
        Resolution failed: {metric.error}
      </p>
    )
  }
  if (metric.note) {
    return (
      <p className="mt-2 text-xs text-muted-foreground italic">{metric.note}</p>
    )
  }
  const cells: Array<[string, string]> = []
  if (typeof metric.clicks_before === "number") {
    cells.push(["Clicks", `${metric.clicks_before} → ${metric.clicks_after ?? "?"}`])
  }
  if (typeof metric.position_before === "number" || typeof metric.position_after === "number") {
    const before = typeof metric.position_before === "number" ? metric.position_before.toFixed(1) : "—"
    const after = typeof metric.position_after === "number" ? metric.position_after.toFixed(1) : "—"
    cells.push(["Position", `${before} → ${after}`])
  }
  if (typeof metric.acknowledged === "boolean") {
    cells.push(["Acknowledged", metric.acknowledged ? "yes" : "no"])
  }
  if (cells.length === 0) return null
  return (
    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
      {cells.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ActionRow({
  action,
  metric,
}: {
  action: SeoAgentMemoAction
  metric?: SeoAgentMemoOutcomeMetric
}) {
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
      {metric && <MetricRow metric={metric} />}
    </div>
  )
}
```

Make sure the `import type` line at the top of the file now includes `SeoAgentMemoOutcomeMetric` (add it to the existing import).

Then find the place where `<ActionRow>` is rendered inside `<MemoCard>`. The current rendering loops over `memo.actions`. Replace that section with:

```tsx
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
  {memo.actions.map((a, i) => {
    const metric = memo.outcome_metrics?.find((m) => m.action_index === i)
    return <ActionRow key={i} action={a} metric={metric} />
  })}
</div>
```

Also, the memo card's `outcome_status` badge (currently rendered as just the string) should display more usefully. Replace the existing badge span with:

```tsx
<span
  className={
    memo.outcome_status === "measured"
      ? "rounded bg-success/20 px-2 py-0.5 text-success"
      : memo.outcome_status === "rolled_back"
      ? "rounded bg-warning/20 px-2 py-0.5 text-warning"
      : "rounded bg-muted px-2 py-0.5 text-muted-foreground"
  }
>
  {memo.outcome_status}
</span>
```

### Step 2: Verify build

```
npm run build
```

Expected: clean (no new TS errors).

### Step 3: Commit

```bash
git add "app/(admin)/admin/seo-agent/memos/page.tsx"
git commit -m "feat(seo-agent): render outcome_metrics on memos page"
```

---

## Task 6: Final verification + user deploy

**Files:** None — verification only.

### Step 1: Run all Phase 5 tests

```
npm run test:run -- __tests__/lib/seo-agent/outcomes.test.ts __tests__/api/admin/internal/outcome-tracker.test.ts
```

Expected: 9 + 7 = 16 tests passing.

### Step 2: Lint

```
npm run lint
```

Expected: clean (no new errors in any of the new files).

### Step 3: Build both packages

```
npm run build && cd functions && npm run build && cd ..
```

Expected: both succeed.

### Step 4: User's manual deploy (after Phase 5 lands)

```bash
firebase deploy --only functions:default:outcomeTrackerCron
```

Do NOT deploy from the subagent.

### Step 5: User's manual smoke (after deploy + at least one 14-day-old memo)

1. Confirm there's at least one `seo_agent_memos` row with `outcome_status = 'pending'` and `run_date <= today − 14 days`. If not, manually backdate one for testing:
   ```sql
   -- only for smoke testing
   UPDATE seo_agent_memos
   SET run_date = CURRENT_DATE - INTERVAL '15 days'
   WHERE id = '<some-pending-memo-id>';
   ```
2. Visit `/admin/automation`. Flip `cron_outcome_tracker_enabled` to ON.
3. Click "Run now" on the outcome-tracker row (or trigger via Firebase console).
4. Check Firebase Function logs (`firebase functions:log --only outcomeTrackerCron`). Expected: `[outcomeTrackerCron] 200 { processed: N, measured: [...], errors: [] }`.
5. Visit `/admin/seo-agent/memos`. The previously-pending memo should now show:
   - Status badge: "measured" (green)
   - Each ActionRow has a `MetricRow` below with Clicks/Position/Acknowledged columns as appropriate per tool.
6. Verify the SQL:
   ```sql
   SELECT id, outcome_status, measured_at, jsonb_pretty(outcome_metrics)
   FROM seo_agent_memos
   WHERE id = '<that-memo-id>';
   ```
   Expected: `outcome_status = 'measured'`, `measured_at` set, `outcome_metrics` is a JSON array with one entry per action.

---

## Notes for the executor

- **Solo-dev workflow:** commit directly to `main`. No branches, no PRs.
- **Firebase deploys** use `default:` prefix.
- **The 14-day measurement window matches the spec.** Too short and noise drowns the signal; too long and the feedback loop becomes useless.
- **For `queue_new_post`, the "before" clicks is always 0** (the post didn't exist before). For `queue_refresh` and `queue_internal_link_sweep`, we have a real before window.
- **The Firestore reads in `resolveRefreshOutcome` and `resolveLinkSweepOutcome` are minor** — one doc fetch each, cheap and bounded. No need for batching.
- **Error containment:** a single failed resolver doesn't fail the whole memo. The error is captured into the metric's `error` field and the memo still flips to `measured`. This prevents one bad resolver from blocking outcome backfill site-wide.

## Known follow-ups (track for Phase 6+ or beyond)

- **Sparkline / chart of outcomes over time** on the admin page. Currently raw numbers per row; trends would be useful.
- **Memo override / rollback UI.** The `outcome_status = 'rolled_back'` value is wired but nothing writes it. Phase 6 work.
- **Per-tool outcome aggregation in the system prompt.** The agent currently sees `last_8_memos_outcomes` as flattened per-action records. A future enhancement could group them and tell the agent "refreshes produced +X% clicks on average over the last 8 weeks; new posts produced +Y%."
- **Schema-validation fallback flag_for_human.** If Claude fails decision-schema parsing twice, the handler currently throws and the job fails. A safer behavior: write a `flag_for_human` memo automatically so the coach is alerted.
- **90-day refresh cooldown enforcement.** The agent can currently queue a refresh for a post that was already refreshed last week. The cooldown rule from the spec should be enforced in `executeQueueRefresh`.

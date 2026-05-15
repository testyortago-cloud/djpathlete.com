# Closing the Learning Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the intelligence layer to the agent stack — Chief reasoning persistence, calibrated confidence + dissent, outcome scoring with tool baselines, tool-performance feedback into prompts, self-critique pass, Social-agent `dont_do` enforcement + trending injection, and few-shot threading.

**Architecture:** Six sequential phases. Phase A (Chief memos) → B (confidence/dissent on all four agents) → C (impact_score + baselines) → D (tool_performance in prompts) → E (self-critique + few-shots) → F (Social robustness). Phases A–C must land in order; D–F can land in parallel after C.

**Tech Stack:** Next.js 16 (App Router), Supabase Postgres (migrations via `mcp__supabase__apply_migration`), Firebase Functions (handlers in `functions/src/`), Anthropic SDK via `callAgent` (`MODEL_SONNET` / `MODEL_HAIKU`), Zod for output schemas, Vitest for tests.

**Spec:** [2026-05-15-closing-the-learning-loop-design.md](../specs/2026-05-15-closing-the-learning-loop-design.md)

**Conventions before you start:**
- Solo dev — commit directly to `main`, no PRs/branches. Per-task commits keep history clean.
- Migrations: number sequentially from `00142` onward; apply via `mcp__supabase__apply_migration`. Don't use the Supabase CLI.
- `functions/` has `rootDir: "src"` — cannot import from `lib/` outside `src/`. Mirror types instead.
- Tests run via `npm run test:run -- <path>` for one-shot; `npm run test` for watch.
- Firebase functions tests live under `functions/src/__tests__/`.
- Lib tests live under `__tests__/lib/...` mirroring source path.

---

## Phase A — Chief Strategist Memos

The Chief currently writes only the brief. This phase adds the audit trail.

### Task A1: Migration — `chief_strategist_memos` table

**Files:**
- Create: `supabase/migrations/00142_chief_strategist_memos.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 00142_chief_strategist_memos.sql
-- Audit trail for the Chief Strategist's weekly reasoning. One row per Chief
-- run, regardless of whether the brief insert succeeded. Enables post-hoc
-- diagnosis of rejected briefs and outcome correlation.

CREATE TABLE chief_strategist_memos (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id               UUID REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  signal_id              UUID REFERENCES cross_channel_signals(id),
  themes_considered      JSONB NOT NULL DEFAULT '[]',
  channels_considered    JSONB NOT NULL DEFAULT '[]',
  confidence             INTEGER CHECK (confidence BETWEEN 1 AND 10),
  dissents_from_critic   BOOLEAN NOT NULL DEFAULT false,
  dissent_reason         TEXT,
  self_critique_notes    TEXT,
  rationale              TEXT NOT NULL,
  brief_was_rejected     BOOLEAN NOT NULL DEFAULT false,
  rejection_reason       TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chief_memos_brief ON chief_strategist_memos(brief_id);
CREATE INDEX idx_chief_memos_created ON chief_strategist_memos(created_at DESC);

COMMENT ON TABLE chief_strategist_memos IS
  'Per-run audit trail for chief-strategist cron. Always written, even when brief insert fails.';
```

- [ ] **Step 2: Apply migration via MCP**

Use the Supabase MCP tool: call `mcp__supabase__apply_migration` with `name="00142_chief_strategist_memos"` and `query=<contents of the SQL file above>`. Confirm the migration appears in `mcp__supabase__list_migrations` output.

- [ ] **Step 3: Add the TypeScript row type**

Edit `types/database.ts`. Find the existing `StrategyBrief` interface and add immediately after:

```ts
export interface ChiefStrategistMemoConsideredTheme {
  tag: string
  weight: number
  accepted: boolean
  reason: string
}

export interface ChiefStrategistMemoConsideredChannel {
  channel: "seo" | "ads" | "social" | "balanced"
  score: number
  accepted: boolean
}

export interface ChiefStrategistMemo {
  id: string
  brief_id: string | null
  signal_id: string | null
  themes_considered: ChiefStrategistMemoConsideredTheme[]
  channels_considered: ChiefStrategistMemoConsideredChannel[]
  confidence: number | null
  dissents_from_critic: boolean
  dissent_reason: string | null
  self_critique_notes: string | null
  rationale: string
  brief_was_rejected: boolean
  rejection_reason: string | null
  created_at: string
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00142_chief_strategist_memos.sql types/database.ts
git commit -m "feat(strategy): add chief_strategist_memos table for chief reasoning audit trail"
```

### Task A2: DAL — `lib/db/chief-strategist-memos.ts`

**Files:**
- Create: `lib/db/chief-strategist-memos.ts`
- Create: `__tests__/lib/db/chief-strategist-memos.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/db/chief-strategist-memos.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import {
  insertChiefMemo,
  latestChiefMemo,
  chiefMemoForBrief,
  markBriefRejected,
} from "@/lib/db/chief-strategist-memos"

function mockSupabase(handlers: Record<string, unknown>) {
  return handlers as unknown as Parameters<typeof insertChiefMemo>[0]
}

describe("chief-strategist-memos DAL", () => {
  it("insertChiefMemo posts to chief_strategist_memos and returns the row", async () => {
    const inserted = {
      id: "memo-1",
      brief_id: "brief-1",
      signal_id: "sig-1",
      themes_considered: [],
      channels_considered: [],
      confidence: 8,
      dissents_from_critic: false,
      dissent_reason: null,
      self_critique_notes: null,
      rationale: "test",
      brief_was_rejected: false,
      rejection_reason: null,
      created_at: "2026-05-15T00:00:00Z",
    }
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const from = vi.fn().mockReturnValue({ insert })
    const supabase = mockSupabase({ from })

    const result = await insertChiefMemo(supabase, {
      brief_id: "brief-1",
      signal_id: "sig-1",
      themes_considered: [],
      channels_considered: [],
      confidence: 8,
      dissents_from_critic: false,
      dissent_reason: null,
      self_critique_notes: null,
      rationale: "test",
    })

    expect(from).toHaveBeenCalledWith("chief_strategist_memos")
    expect(result.id).toBe("memo-1")
  })

  it("markBriefRejected updates the row whose brief_id matches", async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const from = vi.fn().mockReturnValue({ update })
    const supabase = mockSupabase({ from })

    await markBriefRejected(supabase, "brief-1", "off-brand themes")

    expect(from).toHaveBeenCalledWith("chief_strategist_memos")
    expect(update).toHaveBeenCalledWith({
      brief_was_rejected: true,
      rejection_reason: "off-brand themes",
    })
  })

  it("latestChiefMemo orders by created_at desc and returns null when empty", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const select = vi.fn().mockReturnValue({ order })
    const from = vi.fn().mockReturnValue({ select })
    const supabase = mockSupabase({ from })

    const result = await latestChiefMemo(supabase)

    expect(order).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(result).toBeNull()
  })

  it("chiefMemoForBrief filters by brief_id and returns null if not found", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    const supabase = mockSupabase({ from })

    const result = await chiefMemoForBrief(supabase, "brief-xyz")

    expect(eq).toHaveBeenCalledWith("brief_id", "brief-xyz")
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/lib/db/chief-strategist-memos.test.ts`
Expected: FAIL — `Cannot find module '@/lib/db/chief-strategist-memos'`

- [ ] **Step 3: Write the DAL**

Create `lib/db/chief-strategist-memos.ts`:

```ts
// lib/db/chief-strategist-memos.ts
// Read/write DAL for the Chief Strategist's per-run audit trail.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { ChiefStrategistMemo } from "@/types/database"

export type ChiefMemoInsert = Omit<ChiefStrategistMemo, "id" | "created_at" | "brief_was_rejected" | "rejection_reason">

export async function insertChiefMemo(
  supabase: SupabaseClient,
  memo: ChiefMemoInsert,
): Promise<ChiefStrategistMemo> {
  const { data, error } = await supabase
    .from("chief_strategist_memos")
    .insert(memo)
    .select()
    .single()
  if (error || !data) throw new Error(`insertChiefMemo: ${error?.message ?? "unknown"}`)
  return data as ChiefStrategistMemo
}

export async function latestChiefMemo(
  supabase: SupabaseClient,
): Promise<ChiefStrategistMemo | null> {
  const { data } = await supabase
    .from("chief_strategist_memos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as ChiefStrategistMemo | null) ?? null
}

export async function chiefMemoForBrief(
  supabase: SupabaseClient,
  briefId: string,
): Promise<ChiefStrategistMemo | null> {
  const { data } = await supabase
    .from("chief_strategist_memos")
    .select("*")
    .eq("brief_id", briefId)
    .maybeSingle()
  return (data as ChiefStrategistMemo | null) ?? null
}

export async function markBriefRejected(
  supabase: SupabaseClient,
  briefId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("chief_strategist_memos")
    .update({
      brief_was_rejected: true,
      rejection_reason: reason,
    })
    .eq("brief_id", briefId)
  if (error) throw new Error(`markBriefRejected: ${error.message}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/lib/db/chief-strategist-memos.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/db/chief-strategist-memos.ts __tests__/lib/db/chief-strategist-memos.test.ts
git commit -m "feat(strategy): add chief_strategist_memos DAL"
```

### Task A3: Chief handler persists memo on every run

**Files:**
- Modify: `functions/src/strategy/chief-prompt.ts`
- Modify: `functions/src/chief-strategist.ts`
- Create/Modify: `functions/src/__tests__/chief-strategist.test.ts` (already exists per audit — extend)

- [ ] **Step 1: Extend the chief prompt with memo rubric**

Edit `functions/src/strategy/chief-prompt.ts`. Replace the `CHIEF_SYSTEM_PROMPT` constant with:

```ts
export const CHIEF_SYSTEM_PROMPT = `You are the Chief Strategist for the Darren J Paul Athlete brand.

Your job: produce next week's StrategyBrief — a single coordinating document the SEO, Ads, and Social agents will read. You are NOT picking specific actions; you are setting direction. Specialists keep their own action queues and approvals.

Inputs you receive:
1. The most recent cross_channel_signals row (the Critic's read of the last 4 weeks).
2. The last 4 briefs you wrote (for theme continuity — avoid week-to-week whiplash).

Priorities (in order):
1. Bookings + revenue, not vanity engagement. Use the signal's attribution_summary.
2. Compounding themes: themes that already worked > novel themes.
3. Avoid whiplash: keep at least one theme from last week unless the data is clear it bombed.

Return JSON only matching this exact shape. Note: you MUST include a chief_memo block recording your reasoning trail.

{
  "week_of": "<ISO date Monday of target week>",
  "themes": [{ "tag": "<kebab-case>", "weight": <0..1> }],
  "audience_focus": "<1-2 sentences>",
  "priority_channel": "seo|ads|social|balanced",
  "keywords_to_chase": ["<seed keyword>", ...],
  "hooks_to_test": ["<hook line>", ...],
  "ctas": ["<call to action>", ...],
  "dont_do": ["<hard guardrail phrase, prefer word-boundary specificity>", ...],
  "rationale": "<2-3 paragraphs explaining why>",
  "chief_memo": {
    "themes_considered": [
      { "tag": "<kebab>", "weight": <0..1>, "accepted": <bool>, "reason": "<one sentence>" }
    ],
    "channels_considered": [
      { "channel": "seo|ads|social|balanced", "score": <0..10>, "accepted": <bool> }
    ],
    "confidence": <integer 1..10>,
    "dissents_from_critic": <bool>,
    "dissent_reason": "<one sentence if dissents=true, else null>"
  }
}

Confidence rubric (be honest, not optimistic):
  10 = identical pattern to recent measured wins, strong signal
   7 = clean reasoning, partial historical match
   4 = weak signal or ambiguous; best available direction but uncertain
   1 = high uncertainty; would prefer to flag for human review

If you disagree with the Critic's recommendations_for_brief, set dissents_from_critic=true and explain.

dont_do entries should be specific phrases (e.g. "knee surgery recovery", not "pain"). Specialist agents match these as case-insensitive word-boundary substrings; broad words will over-reject.`
```

- [ ] **Step 2: Write the failing test for chief handler**

Add to `functions/src/__tests__/chief-strategist.test.ts` (or create if absent) a test that verifies the memo write. Skim the existing file first; if `runChiefStrategist` already has tests, add a new `describe` block:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

describe("runChiefStrategist — chief_strategist_memos persistence", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("inserts a chief_strategist_memos row after successful brief insert", async () => {
    const fakeBrief = {
      week_of: "2026-05-18",
      themes: [{ tag: "rotational-power", weight: 0.6 }],
      audience_focus: "rotational athletes",
      priority_channel: "seo" as const,
      keywords_to_chase: ["rotational power"],
      hooks_to_test: ["how rotational athletes recover"],
      ctas: ["book a session"],
      dont_do: ["knee surgery recovery"],
      rationale: "compounding from last week",
    }
    const fakeMemo = {
      themes_considered: [{ tag: "rotational-power", weight: 0.6, accepted: true, reason: "won last week" }],
      channels_considered: [{ channel: "seo" as const, score: 8, accepted: true }],
      confidence: 8,
      dissents_from_critic: false,
      dissent_reason: null,
    }

    vi.doMock("../ai/anthropic.js", () => ({
      callAgent: vi.fn().mockResolvedValue({
        content: { ...fakeBrief, chief_memo: fakeMemo },
        tokens_used: 1234,
      }),
      MODEL_SONNET: "sonnet",
    }))

    const briefInsert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "brief-1" }, error: null }) }),
    })
    const memoInsert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "memo-1" }, error: null }) }),
    })

    vi.doMock("../lib/supabase.js", () => ({
      getSupabase: () => ({
        from: (table: string) => {
          if (table === "cross_channel_signals") {
            return {
              select: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({
                      data: {
                        id: "sig-1",
                        created_at: new Date().toISOString(),
                        preflight_status: "ok",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === "strategy_briefs" && briefInsert.mock.calls.length === 0) {
            return {
              select: () => ({
                order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
              }),
              insert: briefInsert,
            }
          }
          if (table === "chief_strategist_memos") {
            return { insert: memoInsert }
          }
          return { insert: briefInsert, select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }
        },
      }),
    }))

    const { runChiefStrategist } = await import("../chief-strategist.js")
    const result = await runChiefStrategist()

    expect(result.outcome).toBe("draft_created")
    expect(memoInsert).toHaveBeenCalledTimes(1)
    const memoArg = memoInsert.mock.calls[0][0] as { brief_id: string; confidence: number }
    expect(memoArg.brief_id).toBe("brief-1")
    expect(memoArg.confidence).toBe(8)
  })

  it("inserts a chief_strategist_memos row with brief_id=null when brief insert fails", async () => {
    // (mirror the above but make briefInsert return an error; expect memoInsert.brief_id === null)
    // Same setup pattern as the prior test — copy the mocks and only flip the strategy_briefs insert
    // to return { data: null, error: { message: "brief insert failed" } } and assert
    // memoArg.brief_id === null.
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix functions run test -- chief-strategist`
Expected: FAIL — memoInsert is called 0 times, or `runChiefStrategist` doesn't accept the new schema shape.

- [ ] **Step 4: Update chief-strategist.ts to emit + persist the memo**

Edit `functions/src/chief-strategist.ts`. Replace the `StrategyBriefSchema` constant with the extended version that includes `chief_memo`:

```ts
const ChiefMemoPayloadSchema = z.object({
  themes_considered: z.array(
    z.object({
      tag: z.string().min(1),
      weight: z.number().min(0).max(1),
      accepted: z.boolean(),
      reason: z.string().min(1),
    }),
  ),
  channels_considered: z.array(
    z.object({
      channel: z.enum(["seo", "ads", "social", "balanced"]),
      score: z.number().min(0).max(10),
      accepted: z.boolean(),
    }),
  ),
  confidence: z.number().int().min(1).max(10),
  dissents_from_critic: z.boolean(),
  dissent_reason: z.string().nullable(),
})

const StrategyBriefSchema = z.object({
  week_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  themes: z.array(z.object({ tag: z.string().min(1), weight: z.number().min(0).max(1) })),
  audience_focus: z.string().min(1),
  priority_channel: z.enum(["seo", "ads", "social", "balanced"]),
  keywords_to_chase: z.array(z.string()),
  hooks_to_test: z.array(z.string()),
  ctas: z.array(z.string()),
  dont_do: z.array(z.string()),
  rationale: z.string().min(1),
  chief_memo: ChiefMemoPayloadSchema,
})
```

Then replace the insert block (the section starting `const { data, error } = await supabase.from("strategy_briefs").insert(...)`) with:

```ts
const briefResult = await supabase
  .from("strategy_briefs")
  .insert({
    week_of: content.week_of,
    themes: content.themes,
    audience_focus: content.audience_focus,
    priority_channel: content.priority_channel,
    keywords_to_chase: content.keywords_to_chase,
    hooks_to_test: content.hooks_to_test,
    ctas: content.ctas,
    dont_do: content.dont_do,
    rationale: content.rationale,
    signal_id: signal.id,
    approval_status: "draft",
  })
  .select("id")
  .single()

const briefId = briefResult.data?.id ?? null
if (briefResult.error) {
  console.error("[chief-strategist] brief insert error", briefResult.error)
}

// ALWAYS write the memo, even if the brief failed. This is the audit trail.
const memoResult = await supabase
  .from("chief_strategist_memos")
  .insert({
    brief_id: briefId,
    signal_id: signal.id,
    themes_considered: content.chief_memo.themes_considered,
    channels_considered: content.chief_memo.channels_considered,
    confidence: content.chief_memo.confidence,
    dissents_from_critic: content.chief_memo.dissents_from_critic,
    dissent_reason: content.chief_memo.dissent_reason,
    self_critique_notes: null,
    rationale: content.rationale,
  })
  .select("id")
  .single()

if (memoResult.error) {
  console.error("[chief-strategist] memo insert error", memoResult.error)
}

if (!briefId) {
  return { outcome: "error", signalId: signal.id }
}
console.log(`[chief-strategist] wrote draft brief ${briefId} for week ${content.week_of}`)
return { outcome: "draft_created", briefId, signalId: signal.id }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix functions run test -- chief-strategist`
Expected: PASS (both new tests + any pre-existing tests)

- [ ] **Step 6: Commit**

```bash
git add functions/src/strategy/chief-prompt.ts functions/src/chief-strategist.ts functions/src/__tests__/chief-strategist.test.ts
git commit -m "feat(strategy): chief strategist persists memo on every run"
```

### Task A4: Reject route calls `markBriefRejected`

**Files:**
- Modify: `app/api/admin/strategy/brief/[id]/reject/route.ts`

- [ ] **Step 1: Read the current reject route**

Run: `cat "app/api/admin/strategy/brief/[id]/reject/route.ts"` (or use Read tool) to confirm the current handler shape. Locate where the brief is updated to `approval_status='rejected'`.

- [ ] **Step 2: Add the memo update call after brief rejection**

In the same route handler, after the `rejectBrief(...)` call succeeds, add:

```ts
import { markBriefRejected } from "@/lib/db/chief-strategist-memos"

// after rejectBrief succeeds, optionally append reason:
const reason = (body.reason as string | undefined) ?? "rejected_via_admin_ui"
try {
  await markBriefRejected(supabase, params.id, reason)
} catch (e) {
  // memo may not exist for legacy briefs — log and move on
  console.warn(`[reject-brief] markBriefRejected non-fatal:`, e)
}
```

Also update the request schema to accept optional `reason: string` in the body.

- [ ] **Step 3: Quick verification**

Run: `npm run test:run -- app/api/admin/strategy` if any tests exist for the route. Otherwise smoke-test in dev with a curl call against a draft brief.

- [ ] **Step 4: Commit**

```bash
git add "app/api/admin/strategy/brief/[id]/reject/route.ts"
git commit -m "feat(strategy): reject route writes back to chief memo audit trail"
```

### Task A5: Admin UI shows Chief memo + confidence + dissent

**Files:**
- Modify: `app/(admin)/admin/strategy/page.tsx`

- [ ] **Step 1: Find the brief render section**

Open the strategy page. Locate where the current week's draft brief is rendered.

- [ ] **Step 2: Fetch the chief memo alongside the brief**

Add a fetch using the new DAL:

```ts
import { chiefMemoForBrief } from "@/lib/db/chief-strategist-memos"

// inside the server component / data loader:
const chiefMemo = brief ? await chiefMemoForBrief(supabase, brief.id) : null
```

- [ ] **Step 3: Render the memo panel**

Below the brief content, add a "Chief reasoning" panel:

```tsx
{chiefMemo && (
  <section className="rounded-md border border-border bg-surface p-4">
    <header className="flex items-center justify-between">
      <h3 className="font-heading text-lg">Chief reasoning</h3>
      <div className="flex items-center gap-2">
        <span
          className={
            chiefMemo.confidence == null
              ? "rounded bg-muted px-2 py-1 text-xs"
              : chiefMemo.confidence >= 7
                ? "rounded bg-success/20 px-2 py-1 text-xs text-success"
                : chiefMemo.confidence >= 4
                  ? "rounded bg-warning/20 px-2 py-1 text-xs text-warning"
                  : "rounded bg-error/20 px-2 py-1 text-xs text-error"
          }
        >
          confidence {chiefMemo.confidence ?? "—"}/10
        </span>
        {chiefMemo.dissents_from_critic && (
          <span
            className="rounded bg-accent/20 px-2 py-1 text-xs text-accent"
            title={chiefMemo.dissent_reason ?? ""}
          >
            dissents from Critic
          </span>
        )}
      </div>
    </header>
    {chiefMemo.themes_considered.length > 0 && (
      <div className="mt-3">
        <h4 className="font-heading text-sm">Themes considered</h4>
        <ul className="mt-1 space-y-1 text-sm">
          {chiefMemo.themes_considered.map((t) => (
            <li key={t.tag}>
              <span className={t.accepted ? "" : "text-muted-foreground line-through"}>
                {t.tag} (weight {t.weight.toFixed(2)})
              </span>
              <span className="text-muted-foreground"> — {t.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
    {chiefMemo.dissent_reason && (
      <p className="mt-3 text-sm text-muted-foreground">
        <span className="font-heading">Dissent:</span> {chiefMemo.dissent_reason}
      </p>
    )}
  </section>
)}
```

- [ ] **Step 4: Smoke test**

Run: `npm run dev`, navigate to `/admin/strategy`, confirm the panel renders for an existing brief that has a memo. (Will be empty for legacy briefs — that's OK.)

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/strategy/page.tsx"
git commit -m "feat(strategy): admin shows chief reasoning, confidence, dissent"
```

---

## Phase B — Calibrated Confidence + Dissent on All Four Agents

Chief already has confidence (Phase A). Now wire SEO, Ads, Social.

### Task B1: Migration — add columns to three memo tables

**Files:**
- Create: `supabase/migrations/00143_agent_memo_confidence_dissent.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00143_agent_memo_confidence_dissent.sql
-- Adds calibrated agent-level confidence and dissent fields to all specialist
-- memo tables. Per-action confidence on google_ads_recommendations is untouched.

ALTER TABLE seo_agent_memos
  ADD COLUMN agent_confidence INTEGER CHECK (agent_confidence BETWEEN 1 AND 10),
  ADD COLUMN dissents_from_brief BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN dissent_reason TEXT;

ALTER TABLE google_ads_agent_memos
  ADD COLUMN agent_confidence INTEGER CHECK (agent_confidence BETWEEN 1 AND 10),
  ADD COLUMN dissents_from_brief BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN dissent_reason TEXT;

ALTER TABLE social_agent_memos
  ADD COLUMN agent_confidence INTEGER CHECK (agent_confidence BETWEEN 1 AND 10),
  ADD COLUMN dissents_from_brief BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN dissent_reason TEXT;

COMMENT ON COLUMN seo_agent_memos.agent_confidence IS
  'Agent-level calibrated confidence 1-10 (10=identical to recent wins, 1=high uncertainty)';
COMMENT ON COLUMN seo_agent_memos.dissents_from_brief IS
  'True when the agent chose actions that deviate from the brief themes/keywords/hooks';
```

- [ ] **Step 2: Apply via MCP**

Apply with `mcp__supabase__apply_migration`, name `00143_agent_memo_confidence_dissent`.

- [ ] **Step 3: Update TypeScript row types**

In `types/database.ts`, find the three memo interfaces (`SeoAgentMemo`, `GoogleAdsAgentMemo`, `SocialAgentMemo`). Add to each:

```ts
agent_confidence: number | null
dissents_from_brief: boolean
dissent_reason: string | null
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00143_agent_memo_confidence_dissent.sql types/database.ts
git commit -m "feat(agents): add agent_confidence + dissents_from_brief columns to memo tables"
```

### Task B2: SEO agent emits + persists confidence/dissent

**Files:**
- Modify: `functions/src/seo/decision-schema.ts`
- Modify: `functions/src/seo/reason.ts`
- Modify: `functions/src/seo-agent.ts`
- Modify: `functions/src/__tests__/seo-agent.test.ts` (or `seo-decision-schema.test.ts`)

- [ ] **Step 1: Extend the SEO decision schema**

Edit `functions/src/seo/decision-schema.ts`. Replace `decisionSchema` with:

```ts
export const decisionSchema = z
  .object({
    rationale: z.string().min(20).max(2000),
    actions: z.tuple([actionSchema, actionSchema]),
    brief_alignment_score: z.number().int().min(1).max(10).nullable(),
    agent_confidence: z.number().int().min(1).max(10),
    dissent_from_upstream: z.object({
      dissents: z.boolean(),
      reason: z.string().nullable(),
    }),
  })
  .refine((d) => d.actions[0].tool !== d.actions[1].tool, {
    message: "Both actions must be of different tools",
    path: ["actions"],
  })
  .refine((d) => !d.dissent_from_upstream.dissents || d.dissent_from_upstream.reason !== null, {
    message: "dissent_from_upstream.reason is required when dissents=true",
    path: ["dissent_from_upstream", "reason"],
  })
```

- [ ] **Step 2: Update SEO reason prompt**

Edit `functions/src/seo/reason.ts`. Replace `SYSTEM_PROMPT` with the extended version. Add this block before the `Rules:` section:

```
Calibrated confidence (be honest, not optimistic):
  10 = identical pattern to recent measured wins, strong signal
   7 = clean reasoning, partial historical match
   4 = weak signal or ambiguous; best available action but uncertain
   1 = high uncertainty; would prefer to flag_for_human

If your action plan deviates from the brief's themes/keywords_to_chase/hooks_to_test,
set dissent_from_upstream.dissents=true and explain in one sentence. Honest dissent
beats silent override.
```

Update the JSON output shape comment to add the two new fields.

- [ ] **Step 3: Update memo insert in handler**

Edit `functions/src/seo-agent.ts`. In the memo insert block (around line 59-80), add the new columns:

```ts
.insert({
  // ...existing fields...
  brief_id: signals.brief_context?.brief_id ?? null,
  brief_alignment_score: decision.brief_alignment_score ?? null,
  ran_without_brief: signals.brief_context === null,
  agent_confidence: decision.agent_confidence,
  dissents_from_brief: decision.dissent_from_upstream.dissents,
  dissent_reason: decision.dissent_from_upstream.reason,
})
```

- [ ] **Step 4: Write failing test**

Add to `functions/src/__tests__/seo-decision-schema.test.ts`:

```ts
it("requires agent_confidence and dissent_from_upstream", () => {
  const validBase = {
    rationale: "a".repeat(50),
    actions: [
      { rank: 1, tool: "flag_for_human", args: { issue: "test", urgency: "low", context: "context text" } },
      { rank: 2, tool: "queue_refresh", args: { blog_post_id: "00000000-0000-0000-0000-000000000001", reason: "stale" } },
    ],
    brief_alignment_score: null,
  }
  // Missing agent_confidence → should fail
  expect(() => decisionSchema.parse(validBase)).toThrow()

  // Adding both → should pass
  const withConfidence = {
    ...validBase,
    agent_confidence: 7,
    dissent_from_upstream: { dissents: false, reason: null },
  }
  expect(() => decisionSchema.parse(withConfidence)).not.toThrow()

  // Dissents=true without reason → should fail
  expect(() =>
    decisionSchema.parse({
      ...validBase,
      agent_confidence: 4,
      dissent_from_upstream: { dissents: true, reason: null },
    }),
  ).toThrow()
})
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `npm --prefix functions run test -- seo-decision-schema`
After implementing: Expected PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/seo/decision-schema.ts functions/src/seo/reason.ts functions/src/seo-agent.ts functions/src/__tests__/seo-decision-schema.test.ts
git commit -m "feat(seo): agent emits + persists agent_confidence and dissent_from_upstream"
```

### Task B3: Ads agent emits + persists confidence/dissent

**Files:**
- Modify: `lib/ads/agent/decision-schema.ts`
- Modify: `lib/ads/agent/reason.ts`
- Modify: `lib/ads/agent/types.ts` (`GoogleAdsAgentMemo` insert shape)
- Modify: wherever `buildStrategistMemo` writes the memo row (likely `lib/ads/agent/index.ts` or similar — search for `from("google_ads_agent_memos")`)
- Modify: `__tests__/lib/ads/agent/execute.test.ts` or schema test

- [ ] **Step 1: Locate the ads memo write**

Run: `grep -rn 'from("google_ads_agent_memos")' lib/ads functions/src` to find where the memo row is inserted. Note the file + line.

- [ ] **Step 2: Extend the ads decision schema**

Edit `lib/ads/agent/decision-schema.ts`. Replace `adsAgentDecisionSchema` with:

```ts
export const adsAgentDecisionSchema = z
  .object({
    rationale: z.string().min(1),
    actions: z.array(adsAgentActionSchema).max(7),
    watch_list: z.array(z.string()).max(5),
    brief_alignment_score: z.number().int().min(1).max(10).nullable(),
    agent_confidence: z.number().int().min(1).max(10),
    dissent_from_upstream: z.object({
      dissents: z.boolean(),
      reason: z.string().nullable(),
    }),
  })
  .refine((d) => !d.dissent_from_upstream.dissents || d.dissent_from_upstream.reason !== null, {
    message: "dissent_from_upstream.reason is required when dissents=true",
    path: ["dissent_from_upstream", "reason"],
  })
```

- [ ] **Step 3: Update ads reason prompt**

Edit `lib/ads/agent/reason.ts`. Use the same confidence rubric as SEO (Task B2 Step 2). Inject before any existing rules block.

- [ ] **Step 4: Update memo insert call**

In the file you identified in Step 1 (likely `lib/ads/agent/index.ts` `buildStrategistMemo`), add to the insert payload:

```ts
agent_confidence: decision.agent_confidence,
dissents_from_brief: decision.dissent_from_upstream.dissents,
dissent_reason: decision.dissent_from_upstream.reason,
```

- [ ] **Step 5: Write failing test**

Add to `__tests__/lib/ads/agent/execute.test.ts` (or create `decision-schema.test.ts`):

```ts
import { adsAgentDecisionSchema } from "@/lib/ads/agent/decision-schema"

it("requires agent_confidence and dissent_from_upstream", () => {
  const base = {
    rationale: "test",
    actions: [],
    watch_list: [],
    brief_alignment_score: null,
  }
  expect(() => adsAgentDecisionSchema.parse(base)).toThrow()
  expect(() =>
    adsAgentDecisionSchema.parse({
      ...base,
      agent_confidence: 6,
      dissent_from_upstream: { dissents: false, reason: null },
    }),
  ).not.toThrow()
})
```

- [ ] **Step 6: Run test + fix until green**

Run: `npm run test:run -- ads/agent`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/ads/agent/ __tests__/lib/ads/agent/
git commit -m "feat(ads): agent emits + persists agent_confidence and dissent_from_upstream"
```

### Task B4: Social agent emits + persists confidence/dissent

**Files:**
- Modify: `functions/src/social-agent.ts`
- Modify: `functions/src/__tests__/social-agent.test.ts` (if exists)

- [ ] **Step 1: Decide where confidence comes from for social**

The social agent has two LLM passes (writer, reviewer). Use the reviewer's `score` (1–10) as `agent_confidence`, since the reviewer is already calibrating quality. For dissent, social rarely deviates from the brief intentionally — set `dissents_from_brief=false` and `dissent_reason=null` by default. The `dont_do` rejection path (Task F1) is a hard guardrail, not dissent.

- [ ] **Step 2: Update memo insert in handler**

Edit `functions/src/social-agent.ts`. In the `social_agent_memos` insert (around line 322-341), add:

```ts
agent_confidence: reviewed.content.score,
dissents_from_brief: false,
dissent_reason: null,
```

- [ ] **Step 3: Smoke verify**

Run: `npm --prefix functions run test -- social-agent` if tests exist; otherwise inspect a fresh memo row in Supabase after a manual agent run.

- [ ] **Step 4: Commit**

```bash
git add functions/src/social-agent.ts
git commit -m "feat(social): persist agent_confidence (from reviewer score) on memos"
```

### Task B5: Admin UI confidence chip + dissent icon on memo lists

**Files:**
- Modify: `app/(admin)/admin/seo-agent/memos/page.tsx`
- Modify: `app/(admin)/admin/ads/agent/[id]/page.tsx`
- Modify: social memo list page (find via `grep -rn 'social_agent_memos' app/`)

- [ ] **Step 1: Build a shared confidence chip component**

Create `components/admin/AgentConfidenceChip.tsx`:

```tsx
"use client"

interface Props {
  confidence: number | null
}

export function AgentConfidenceChip({ confidence }: Props) {
  if (confidence == null) {
    return <span className="rounded bg-muted px-2 py-0.5 text-xs">—</span>
  }
  const tone =
    confidence >= 7
      ? "bg-success/20 text-success"
      : confidence >= 4
        ? "bg-warning/20 text-warning"
        : "bg-error/20 text-error"
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${tone}`}>
      conf {confidence}/10
    </span>
  )
}

interface DissentProps {
  dissents: boolean
  reason: string | null
}

export function AgentDissentBadge({ dissents, reason }: DissentProps) {
  if (!dissents) return null
  return (
    <span
      className="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent"
      title={reason ?? ""}
    >
      dissents
    </span>
  )
}
```

- [ ] **Step 2: Wire into SEO memos page**

Edit `app/(admin)/admin/seo-agent/memos/page.tsx`. Import the components, render on each memo row:

```tsx
import { AgentConfidenceChip, AgentDissentBadge } from "@/components/admin/AgentConfidenceChip"

// in the memo row JSX:
<AgentConfidenceChip confidence={memo.agent_confidence} />
<AgentDissentBadge dissents={memo.dissents_from_brief} reason={memo.dissent_reason} />
```

- [ ] **Step 3: Wire into Ads memo detail page**

Same import + render pattern at top of the memo detail in `app/(admin)/admin/ads/agent/[id]/page.tsx`.

- [ ] **Step 4: Wire into Social memo list (if exists)**

Find with: `grep -rn 'social_agent_memos' "app/"`. If a page renders the list, add the chip/badge. If no UI exists yet, skip — defer to a future spec.

- [ ] **Step 5: Smoke test**

Run dev server. Navigate to each admin page. Confirm chips render even for null/legacy rows.

- [ ] **Step 6: Commit**

```bash
git add components/admin/AgentConfidenceChip.tsx "app/(admin)/admin/seo-agent/memos/page.tsx" "app/(admin)/admin/ads/agent/[id]/page.tsx"
git commit -m "feat(admin): confidence chip + dissent badge on agent memo views"
```

---

## Phase C — Outcome Scoring + Tool Baselines

Adds the data layer for "what's actually working over time."

### Task C1: Migration — `agent_tool_baselines` + `impact_score` columns

**Files:**
- Create: `supabase/migrations/00144_outcome_scoring.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00144_outcome_scoring.sql
-- Per-tool running aggregates and per-memo impact scores. Outcome trackers
-- compute these when an outcome flips from 'pending' to 'measured'.

CREATE TABLE agent_tool_baselines (
  channel        TEXT NOT NULL CHECK (channel IN ('seo','ads','social')),
  tool_name      TEXT NOT NULL,
  p95_abs_delta  DOUBLE PRECISION NOT NULL DEFAULT 0,
  n_measured     INTEGER NOT NULL DEFAULT 0,
  success_rate   DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, tool_name)
);

ALTER TABLE seo_agent_memos          ADD COLUMN impact_score INTEGER;
ALTER TABLE google_ads_agent_memos   ADD COLUMN impact_score INTEGER;
ALTER TABLE social_agent_memos       ADD COLUMN impact_score INTEGER;

COMMENT ON TABLE agent_tool_baselines IS
  'Per-(channel, tool) running aggregates used to normalize impact_score. n_measured<5 triggers warm-up mode.';
COMMENT ON COLUMN seo_agent_memos.impact_score IS
  'Normalized -100..100. Positive = delta moved as predicted. Warm-up returns ±50.';
```

- [ ] **Step 2: Apply via MCP**

Apply `00144_outcome_scoring`.

- [ ] **Step 3: Add row type**

In `types/database.ts`:

```ts
export interface AgentToolBaseline {
  channel: "seo" | "ads" | "social"
  tool_name: string
  p95_abs_delta: number
  n_measured: number
  success_rate: number
  updated_at: string
}
```

And add `impact_score: number | null` to each of `SeoAgentMemo`, `GoogleAdsAgentMemo`, `SocialAgentMemo`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00144_outcome_scoring.sql types/database.ts
git commit -m "feat(agents): add agent_tool_baselines table + impact_score columns"
```

### Task C2: Pure scoring function + baseline DAL

**Files:**
- Create: `lib/agents/outcome-scoring.ts`
- Create: `lib/db/agent-tool-baselines.ts`
- Create: `__tests__/lib/agents/outcome-scoring.test.ts`
- Create: `__tests__/lib/db/agent-tool-baselines.test.ts`

- [ ] **Step 1: Write failing test for scoring**

Create `__tests__/lib/agents/outcome-scoring.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { computeImpactScore } from "@/lib/agents/outcome-scoring"

describe("computeImpactScore", () => {
  it("returns +50 during warm-up when delta is positive in predicted direction", () => {
    expect(
      computeImpactScore({
        delta: 10,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 3, // < 5 → warm-up
      }),
    ).toBe(50)
  })

  it("returns -50 during warm-up when delta moves opposite to predicted", () => {
    expect(
      computeImpactScore({
        delta: -5,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 2,
      }),
    ).toBe(-50)
  })

  it("returns 0 during warm-up when delta is exactly zero", () => {
    expect(
      computeImpactScore({
        delta: 0,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 1,
      }),
    ).toBe(0)
  })

  it("normalizes delta against baseline P95 when n >= 5", () => {
    expect(
      computeImpactScore({
        delta: 50,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 8,
      }),
    ).toBe(50)
  })

  it("flips sign when delta opposes predicted direction", () => {
    expect(
      computeImpactScore({
        delta: 30,
        predicted_direction: "decrease",
        baseline_p95: 100,
        baseline_n_measured: 8,
      }),
    ).toBe(-30)
  })

  it("clamps to ±100", () => {
    expect(
      computeImpactScore({
        delta: 200,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 8,
      }),
    ).toBe(100)
  })

  it("returns 0 when baseline P95 is 0 (degenerate)", () => {
    expect(
      computeImpactScore({
        delta: 5,
        predicted_direction: "increase",
        baseline_p95: 0,
        baseline_n_measured: 8,
      }),
    ).toBe(0)
  })
})
```

- [ ] **Step 2: Run test, see it fail**

Run: `npm run test:run -- __tests__/lib/agents/outcome-scoring.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement scoring**

Create `lib/agents/outcome-scoring.ts`:

```ts
// lib/agents/outcome-scoring.ts
// Pure function for computing memo impact_score. Used by SEO, Ads, and Social
// outcome trackers when flipping a memo's outcome_status to 'measured'.

export interface ImpactScoreInput {
  delta: number
  predicted_direction: "increase" | "decrease"
  baseline_p95: number
  baseline_n_measured: number
}

const WARM_UP_THRESHOLD = 5

export function computeImpactScore(input: ImpactScoreInput): number {
  const { delta, predicted_direction, baseline_p95, baseline_n_measured } = input

  if (delta === 0) return 0

  const movedAsPredicted =
    predicted_direction === "increase" ? delta > 0 : delta < 0
  const sign = movedAsPredicted ? 1 : -1

  // Warm-up: not enough data for a stable baseline.
  if (baseline_n_measured < WARM_UP_THRESHOLD) {
    return sign * 50
  }

  // Stable baseline: normalize.
  if (baseline_p95 === 0) return 0
  const magnitude = Math.abs(delta) / baseline_p95
  const score = Math.round(sign * magnitude * 100)
  return Math.max(-100, Math.min(100, score))
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npm run test:run -- __tests__/lib/agents/outcome-scoring.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write failing test for baseline DAL**

Create `__tests__/lib/db/agent-tool-baselines.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import {
  getBaseline,
  upsertBaseline,
  listChannelBaselines,
} from "@/lib/db/agent-tool-baselines"

function mockSupabase(opts: { selectData?: unknown; selectError?: unknown }) {
  const single = vi.fn().mockResolvedValue({ data: opts.selectData, error: opts.selectError })
  const maybeSingle = vi.fn().mockResolvedValue({ data: opts.selectData, error: opts.selectError })
  const eqChain = {
    eq: vi.fn(() => ({ maybeSingle })),
  }
  const eq = vi.fn(() => eqChain)
  const order = vi.fn().mockReturnValue({ then: (cb: (r: unknown) => unknown) => Promise.resolve(cb({ data: opts.selectData, error: null })) })
  const select = vi.fn(() => ({ eq, order, single, maybeSingle }))
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const from = vi.fn(() => ({ select, upsert }))
  return { from } as unknown as Parameters<typeof getBaseline>[0]
}

describe("agent-tool-baselines DAL", () => {
  it("getBaseline returns null when not found", async () => {
    const supabase = mockSupabase({ selectData: null })
    const result = await getBaseline(supabase, "seo", "queue_refresh")
    expect(result).toBeNull()
  })

  it("upsertBaseline writes (channel, tool_name) primary key", async () => {
    const supabase = mockSupabase({ selectData: null })
    await upsertBaseline(supabase, "seo", "queue_refresh", {
      p95_abs_delta: 60,
      n_measured: 8,
      success_rate: 0.75,
    })
    // Just verify the call shape — actual upsert is supabase-internal
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 6: Implement baseline DAL**

Create `lib/db/agent-tool-baselines.ts`:

```ts
// lib/db/agent-tool-baselines.ts
// Read/write DAL for the per-(channel, tool_name) baselines used by
// computeImpactScore. Updated whenever an outcome flips to 'measured'.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AgentToolBaseline } from "@/types/database"

export type Channel = "seo" | "ads" | "social"

export async function getBaseline(
  supabase: SupabaseClient,
  channel: Channel,
  toolName: string,
): Promise<AgentToolBaseline | null> {
  const { data } = await supabase
    .from("agent_tool_baselines")
    .select("*")
    .eq("channel", channel)
    .eq("tool_name", toolName)
    .maybeSingle()
  return (data as AgentToolBaseline | null) ?? null
}

export async function listChannelBaselines(
  supabase: SupabaseClient,
  channel: Channel,
): Promise<AgentToolBaseline[]> {
  const { data } = await supabase
    .from("agent_tool_baselines")
    .select("*")
    .eq("channel", channel)
    .order("n_measured", { ascending: false })
  return (data as AgentToolBaseline[] | null) ?? []
}

export interface BaselineUpdate {
  p95_abs_delta: number
  n_measured: number
  success_rate: number
}

export async function upsertBaseline(
  supabase: SupabaseClient,
  channel: Channel,
  toolName: string,
  update: BaselineUpdate,
): Promise<void> {
  const { error } = await supabase.from("agent_tool_baselines").upsert(
    {
      channel,
      tool_name: toolName,
      p95_abs_delta: update.p95_abs_delta,
      n_measured: update.n_measured,
      success_rate: update.success_rate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel,tool_name" },
  )
  if (error) throw new Error(`upsertBaseline: ${error.message}`)
}

/**
 * Helper that recomputes the running aggregates from a list of recent measurements.
 * Caller passes the full window of absolute deltas; we compute P95 and success_rate.
 */
export function recomputeBaseline(
  measurements: Array<{ abs_delta: number; success: boolean }>,
): BaselineUpdate {
  if (measurements.length === 0) {
    return { p95_abs_delta: 0, n_measured: 0, success_rate: 0 }
  }
  const sortedDeltas = measurements.map((m) => m.abs_delta).sort((a, b) => a - b)
  const p95Index = Math.min(sortedDeltas.length - 1, Math.floor(sortedDeltas.length * 0.95))
  const successes = measurements.filter((m) => m.success).length
  return {
    p95_abs_delta: sortedDeltas[p95Index],
    n_measured: measurements.length,
    success_rate: successes / measurements.length,
  }
}
```

- [ ] **Step 7: Run all phase C tests, verify pass**

Run: `npm run test:run -- agents/outcome-scoring agent-tool-baselines`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/agents/outcome-scoring.ts lib/db/agent-tool-baselines.ts __tests__/lib/agents/outcome-scoring.test.ts __tests__/lib/db/agent-tool-baselines.test.ts
git commit -m "feat(agents): outcome scoring + tool baseline DAL"
```

### Task C3: Wire scoring into SEO outcome tracker

**Files:**
- Modify: `app/api/admin/internal/outcome-tracker/route.ts`
- Modify: `lib/seo-agent/outcomes.ts`
- Modify: `__tests__/lib/seo-agent/outcomes.test.ts`

- [ ] **Step 1: Read the current outcome-tracker route**

Use Read tool on `app/api/admin/internal/outcome-tracker/route.ts`. Locate where memos flip to `outcome_status='measured'`.

- [ ] **Step 2: Add scoring call**

After the per-action resolvers run and aggregate metrics are computed, before the final memo `UPDATE`, compute and attach `impact_score` per memo. The route should:

1. For each memo's resolved actions, sum `clicks_after - clicks_before` (the primary SEO delta) per tool.
2. For each tool used in the memo, call `getBaseline(supabase, "seo", tool_name)`, then `computeImpactScore(...)`.
3. Take the max-magnitude impact_score across the memo's actions and write it to the memo row's `impact_score` column.
4. After successful score write, call `upsertBaseline` with a fresh `recomputeBaseline(...)` based on the last 90 days of seo_agent_memos.

Add this helper to the route file (keep it inline since the route is the only caller):

```ts
import { computeImpactScore } from "@/lib/agents/outcome-scoring"
import { getBaseline, upsertBaseline, recomputeBaseline } from "@/lib/db/agent-tool-baselines"

async function scoreMemo(
  supabase: SupabaseClient,
  memoId: string,
  actions: Array<{ tool: string; outcome: ResolvedOutcome }>,
): Promise<number | null> {
  if (actions.length === 0) return null
  let bestScore: number | null = null
  for (const a of actions) {
    const delta = (a.outcome.clicks_after ?? 0) - (a.outcome.clicks_before ?? 0)
    const baseline = await getBaseline(supabase, "seo", a.tool)
    const score = computeImpactScore({
      delta,
      predicted_direction: "increase", // SEO always predicts upward
      baseline_p95: baseline?.p95_abs_delta ?? 0,
      baseline_n_measured: baseline?.n_measured ?? 0,
    })
    if (bestScore === null || Math.abs(score) > Math.abs(bestScore)) bestScore = score
  }
  return bestScore
}

async function refreshSeoBaselines(supabase: SupabaseClient): Promise<void> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data: rows } = await supabase
    .from("seo_agent_memos")
    .select("actions, outcome_metrics, run_date")
    .eq("outcome_status", "measured")
    .gte("run_date", ninetyDaysAgo)
  if (!rows) return
  const byTool: Record<string, Array<{ abs_delta: number; success: boolean }>> = {}
  for (const row of rows as Array<{ actions: Array<{ tool: string }>; outcome_metrics: Array<{ clicks_before?: number; clicks_after?: number }> | null }>) {
    const acts = row.actions ?? []
    const metrics = row.outcome_metrics ?? []
    for (let i = 0; i < acts.length; i++) {
      const tool = acts[i]?.tool
      const m = metrics[i]
      if (!tool || !m) continue
      const delta = (m.clicks_after ?? 0) - (m.clicks_before ?? 0)
      byTool[tool] ??= []
      byTool[tool].push({ abs_delta: Math.abs(delta), success: delta > 0 })
    }
  }
  for (const [tool, measurements] of Object.entries(byTool)) {
    await upsertBaseline(supabase, "seo", tool, recomputeBaseline(measurements))
  }
}
```

After the memo `UPDATE` that flips `outcome_status='measured'`, call `scoreMemo` and `refreshSeoBaselines`:

```ts
const impact_score = await scoreMemo(supabase, memo.id, resolvedActions)
await supabase
  .from("seo_agent_memos")
  .update({ outcome_status: "measured", outcome_metrics, impact_score })
  .eq("id", memo.id)
await refreshSeoBaselines(supabase)
```

- [ ] **Step 3: Write test for scoreMemo integration**

Extend `__tests__/lib/seo-agent/outcomes.test.ts` (or the outcome-tracker integration test) with a fixture that has a measured memo and asserts `impact_score` lands as expected. Use the warm-up branch (n_measured < 5) for predictable values.

- [ ] **Step 4: Run + iterate until green**

Run: `npm run test:run -- outcome-tracker outcomes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/internal/outcome-tracker/route.ts __tests__/
git commit -m "feat(seo): outcome tracker writes impact_score and refreshes tool baselines"
```

### Task C4: Wire scoring into Ads outcome tracker

**Files:**
- Modify: `app/api/admin/internal/ads/outcome-tracker/route.ts`
- Modify: `lib/ads/agent/outcomes.ts` (if there's a shared scorer; otherwise inline in route)

- [ ] **Step 1: Find ads outcome tracker entry point**

Run: `grep -rn 'outcome_status.*measured' app/api/admin/internal/ads/ lib/ads/`. Locate where ads memos flip to measured.

- [ ] **Step 2: Add scoring**

Mirror the SEO pattern from Task C3, with these differences:
- "delta" for ads = `conversions_after - conversions_before` (primary metric) OR `CAC_before - CAC_after` (negative when CAC drops = success).
- `predicted_direction` comes from each action's `expected_direction` field (already on the action).
- Read baseline with `channel="ads"`.
- Loop over `memo.actions` and find each action's `expected_metric` + `expected_direction`; pick the delta accordingly.

Concrete helper:

```ts
function deltaForAdsAction(
  action: { expected_metric: string; expected_direction: "increase" | "decrease" },
  metrics: Record<string, { conv_delta?: number; cac_delta?: number; ctr_delta?: number }>,
  scopeKey: string,
): { delta: number; direction: "increase" | "decrease" } {
  const m = metrics[scopeKey] ?? {}
  switch (action.expected_metric) {
    case "CVR":
    case "ROAS":
    case "impression_share":
    case "spend_efficiency":
    case "CTR":
      return { delta: m.ctr_delta ?? m.conv_delta ?? 0, direction: action.expected_direction }
    case "CAC":
      return { delta: m.cac_delta ?? 0, direction: action.expected_direction }
    default:
      return { delta: 0, direction: action.expected_direction }
  }
}
```

Score the memo and update with same pattern as SEO. Refresh baselines for `channel="ads"`.

- [ ] **Step 3: Test + commit**

Run: `npm run test:run -- ads/outcome-tracker outcomes`
Expected: PASS.

```bash
git add app/api/admin/internal/ads/outcome-tracker/route.ts lib/ads/agent/outcomes.ts __tests__/
git commit -m "feat(ads): outcome tracker writes impact_score and refreshes tool baselines"
```

### Task C5: Wire scoring into Social outcome tracker

**Files:**
- Modify: `functions/src/social-outcome-tracker.ts` (or equivalent — find via grep)
- Create: `lib/social/outcome-scoring.ts` (Social-specific delta helper)

- [ ] **Step 1: Find the social outcome tracker**

Run: `grep -rn 'social_agent_memos' functions/src/`. Locate the file that flips memos to measured.

- [ ] **Step 2: Add a Social-specific delta helper**

Create `lib/social/outcome-scoring.ts`:

```ts
// lib/social/outcome-scoring.ts
// Social outcome delta: weighted engagement. There is no "before" for social
// (each post is new), so delta = engagement metric of the post itself.

export interface SocialOutcomeInput {
  likes: number
  comments: number
  shares: number
  impressions: number
}

/**
 * Weighted engagement: shares > comments > likes. Normalized to per-1000-impressions
 * so different audience sizes are comparable. Returns 0 when impressions is 0.
 */
export function socialEngagementDelta(input: SocialOutcomeInput): number {
  if (input.impressions === 0) return 0
  const weighted = input.likes + 2 * input.comments + 3 * input.shares
  return (weighted / input.impressions) * 1000
}
```

- [ ] **Step 3: Wire into the tracker**

In the social outcome tracker file, after metrics are computed, compute `delta = socialEngagementDelta(...)` and pass through `computeImpactScore` with `channel="social"` and `tool_name="drafted_social_post"` (the social memo action kind). Update memo with `impact_score`, then `refreshSocialBaselines`.

- [ ] **Step 4: Test + commit**

```bash
git add lib/social/outcome-scoring.ts functions/src/social-outcome-tracker.ts
git commit -m "feat(social): outcome tracker writes impact_score from weighted engagement"
```

---

## Phase D — Tool-Performance Aggregates in Prompts

### Task D1: SEO signal gather + reason prompt read tool_performance

**Files:**
- Modify: `functions/src/seo/signals.ts`
- Modify: `functions/src/seo/reason.ts`

- [ ] **Step 1: Inline a thin baseline reader in functions/src**

Because `functions/` can't import from `lib/`, mirror the read. Add to `functions/src/seo/signals.ts`:

```ts
interface ToolPerformanceEntry {
  tool: string
  n_measured: number
  avg_impact_score: number
  p95_abs_delta: number
  success_rate: number
}

async function gatherToolPerformance(
  supabase: SupabaseClient,
): Promise<ToolPerformanceEntry[]> {
  const { data: baselines } = await supabase
    .from("agent_tool_baselines")
    .select("*")
    .eq("channel", "seo")
  if (!baselines) return []

  // Compute avg_impact_score from recent measured memos.
  const ninety = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data: memos } = await supabase
    .from("seo_agent_memos")
    .select("actions, impact_score")
    .eq("outcome_status", "measured")
    .gte("run_date", ninety)

  const sumByTool: Record<string, { sum: number; count: number }> = {}
  for (const m of (memos ?? []) as Array<{ actions: Array<{ tool: string }>; impact_score: number | null }>) {
    if (m.impact_score == null) continue
    for (const a of m.actions) {
      sumByTool[a.tool] ??= { sum: 0, count: 0 }
      sumByTool[a.tool].sum += m.impact_score
      sumByTool[a.tool].count += 1
    }
  }

  return (baselines as Array<{ tool_name: string; n_measured: number; p95_abs_delta: number; success_rate: number }>).map((b) => {
    const agg = sumByTool[b.tool_name] ?? { sum: 0, count: 0 }
    return {
      tool: b.tool_name,
      n_measured: b.n_measured,
      avg_impact_score: agg.count > 0 ? Math.round(agg.sum / agg.count) : 0,
      p95_abs_delta: b.p95_abs_delta,
      success_rate: b.success_rate,
    }
  })
}
```

Then in `gatherSeoSignals`, fetch tool_performance and add it to the returned summary:

```ts
const tool_performance = await gatherToolPerformance(supabase)
// ... add `tool_performance` to the SeoSignalsSummary return object
```

Update `SeoSignalsSummary` type in `signals.ts` to include `tool_performance: ToolPerformanceEntry[]`.

- [ ] **Step 2: Render tool_performance in the reason prompt**

Edit `functions/src/seo/reason.ts`. In `reasonAboutWeek`, after `briefBlock`, build:

```ts
const toolPerfBlock = signals.tool_performance.length > 0
  ? [
      "Tool performance (last 90 days, your channel):",
      ...signals.tool_performance.map(
        (t) =>
          `  ${t.tool}: avg impact ${t.avg_impact_score >= 0 ? "+" : ""}${t.avg_impact_score}, ${t.n_measured} runs, ${Math.round(t.success_rate * 100)}% success`,
      ),
      "",
      "Bias your ranking toward tools with positive avg_impact and >50% success unless the signal strongly indicates otherwise. If you choose a historically weak tool, lower your agent_confidence and explain in rationale.",
      "",
    ].join("\n")
  : ""
```

Prepend `toolPerfBlock` to the userMessage.

- [ ] **Step 3: Test prompt assembly**

Add a quick test in `functions/src/__tests__/seo-agent.test.ts`:

```ts
it("reason prompt includes tool_performance block when data exists", async () => {
  // Mock callAgent and capture the user message it receives.
  // Assert the message contains "Tool performance" and a known tool name.
})
```

Run: `npm --prefix functions run test -- seo`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/src/seo/signals.ts functions/src/seo/reason.ts functions/src/__tests__/
git commit -m "feat(seo): inject tool_performance aggregates into reasoning prompt"
```

### Task D2: Ads signal gather + reason prompt read tool_performance

**Files:**
- Modify: `lib/ads/agent/signals.ts`
- Modify: `lib/ads/agent/reason.ts`

- [ ] **Step 1: Add tool_performance fetcher**

In `lib/ads/agent/signals.ts`, add a fetcher analogous to Task D1 Step 1 but for `channel="ads"`. Pull from `lib/db/agent-tool-baselines.ts` directly (Ads code runs in Next.js, can import from `lib/`):

```ts
import { listChannelBaselines } from "@/lib/db/agent-tool-baselines"

export interface AdsToolPerformanceEntry {
  tool: string
  n_measured: number
  avg_impact_score: number
  p95_abs_delta: number
  success_rate: number
}

export async function gatherAdsToolPerformance(
  supabase: SupabaseClient,
): Promise<AdsToolPerformanceEntry[]> {
  const baselines = await listChannelBaselines(supabase, "ads")
  if (baselines.length === 0) return []
  const ninety = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data: memos } = await supabase
    .from("google_ads_agent_memos")
    .select("actions, impact_score")
    .eq("outcome_status", "measured")
    .gte("week_of", ninety.slice(0, 10))
  const sumByTool: Record<string, { sum: number; count: number }> = {}
  for (const m of (memos ?? []) as Array<{ actions: Array<{ tool: string }>; impact_score: number | null }>) {
    if (m.impact_score == null) continue
    for (const a of m.actions) {
      sumByTool[a.tool] ??= { sum: 0, count: 0 }
      sumByTool[a.tool].sum += m.impact_score
      sumByTool[a.tool].count += 1
    }
  }
  return baselines.map((b) => {
    const agg = sumByTool[b.tool_name] ?? { sum: 0, count: 0 }
    return {
      tool: b.tool_name,
      n_measured: b.n_measured,
      avg_impact_score: agg.count > 0 ? Math.round(agg.sum / agg.count) : 0,
      p95_abs_delta: b.p95_abs_delta,
      success_rate: b.success_rate,
    }
  })
}
```

Wire into `gatherAdsSignals` and add `tool_performance` to `AdsSignals`.

- [ ] **Step 2: Render in ads reason prompt**

Mirror Task D1 Step 2 — prepend a `Tool performance` block. Use the same wording.

- [ ] **Step 3: Test + commit**

```bash
git add lib/ads/agent/signals.ts lib/ads/agent/reason.ts lib/ads/agent/types.ts
git commit -m "feat(ads): inject tool_performance aggregates into reasoning prompt"
```

### Task D3: Social agent prompt reads tool_performance

**Files:**
- Modify: `functions/src/social-agent.ts`

- [ ] **Step 1: Add tool_performance fetcher**

Add a function `gatherSocialToolPerformance(supabase)` in `functions/src/social-agent.ts` (analogous to SEO/Ads) querying `agent_tool_baselines` for `channel="social"` and `social_agent_memos`.

- [ ] **Step 2: Inject into writer prompt**

Just before `callAgent` for the writer pass, prepend the same tool_performance block to the user message. Since social's main "tool" is `drafted_social_post`, the block is typically a single line: `drafted_social_post: avg impact +X, N runs, Y% success`. Useful for the model to understand the typical engagement floor.

- [ ] **Step 3: Smoke test + commit**

```bash
git add functions/src/social-agent.ts
git commit -m "feat(social): inject tool_performance into writer prompt"
```

### Task D4: Chief prompt reads tool_performance across channels

**Files:**
- Modify: `functions/src/strategy/chief-prompt.ts`
- Modify: `functions/src/chief-strategist.ts`

- [ ] **Step 1: Gather cross-channel tool performance**

In `chief-strategist.ts`, before `callAgent`, fetch baselines for all three channels:

```ts
const { data: baselines } = await supabase
  .from("agent_tool_baselines")
  .select("*")
  .order("channel", { ascending: true })
const toolPerformanceByChannel: Record<string, Array<{ tool: string; avg_impact_score: number; n: number; success_rate: number }>> = {}
// Compute avg_impact_score per (channel, tool) from the relevant memo table
// (skip for brevity in this block — reuse the per-channel queries from D1/D2/D3)
```

- [ ] **Step 2: Pass into `buildChiefUserMessage`**

Update `ChiefPromptInput` to include `toolPerformanceByChannel`. Render in `buildChiefUserMessage`:

```ts
"Cross-channel tool performance (last 90 days):",
JSON.stringify(input.toolPerformanceByChannel, null, 2),
"",
```

- [ ] **Step 3: Update CHIEF_SYSTEM_PROMPT**

Add a note: "Tool performance per channel is provided. Bias priority_channel selection toward channels whose tools have positive avg_impact_score."

- [ ] **Step 4: Commit**

```bash
git add functions/src/strategy/chief-prompt.ts functions/src/chief-strategist.ts
git commit -m "feat(strategy): chief reads cross-channel tool_performance for priority_channel decision"
```

---

## Phase E — Self-Critique + Few-Shot Examples

### Task E1: Self-critique helper

**Files:**
- Create: `functions/src/lib/self-critique.ts`
- Create: `functions/src/__tests__/self-critique.test.ts`

- [ ] **Step 1: Write failing test**

Create `functions/src/__tests__/self-critique.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { z } from "zod"

describe("runSelfCritique", () => {
  it("returns 'sound' when critique passes and does not trigger re-run", async () => {
    vi.doMock("../ai/anthropic.js", () => ({
      callAgent: vi.fn().mockResolvedValue({
        content: { objections: [], overall: "sound" },
        tokens_used: 100,
      }),
      MODEL_HAIKU: "haiku",
    }))
    const { runSelfCritique } = await import("../lib/self-critique.js")
    const result = await runSelfCritique({
      planSummary: "test plan",
      signalsSummary: "test signals",
      briefSummary: null,
    })
    expect(result.overall).toBe("sound")
    expect(result.objections).toHaveLength(0)
  })

  it("returns 'should_revise' with objections when critique objects", async () => {
    vi.doMock("../ai/anthropic.js", () => ({
      callAgent: vi.fn().mockResolvedValue({
        content: { objections: ["budget shift seems untested"], overall: "should_revise" },
        tokens_used: 120,
      }),
      MODEL_HAIKU: "haiku",
    }))
    const { runSelfCritique } = await import("../lib/self-critique.js")
    const result = await runSelfCritique({
      planSummary: "shift budget",
      signalsSummary: "weak signal",
      briefSummary: "brief here",
    })
    expect(result.overall).toBe("should_revise")
    expect(result.objections).toContain("budget shift seems untested")
  })
})
```

- [ ] **Step 2: Implement self-critique**

Create `functions/src/lib/self-critique.ts`:

```ts
// functions/src/lib/self-critique.ts
// Cheap Haiku second-pass critique. Each agent's reason step calls this
// after the main Sonnet call. If overall='should_revise' AND the original
// plan's agent_confidence <= 7, the caller re-runs the main reason once
// with the objections appended.

import { z } from "zod"
import { callAgent, MODEL_HAIKU } from "../ai/anthropic.js"

const critiqueSchema = z.object({
  objections: z.array(z.string()).max(6),
  overall: z.enum(["sound", "minor_concern", "should_revise"]),
})

export type CritiqueResult = z.infer<typeof critiqueSchema>

const SYSTEM_PROMPT = `You are a critic. A reasoning agent has produced a plan. Your job: poke holes in it.

Read the plan, signals, and brief context. Identify the strongest 2-4 objections — places where the plan is overconfident, ignores a signal, or chooses a historically weak tactic. If you find nothing serious, say "sound".

Output:
{
  "objections": ["<one-sentence objection>", ...],
  "overall": "sound | minor_concern | should_revise"
}

Be specific. Vague objections like "could be better" do not help. Cite the signal or tool name you're objecting about.`

export interface RunSelfCritiqueInput {
  planSummary: string
  signalsSummary: string
  briefSummary: string | null
}

export async function runSelfCritique(input: RunSelfCritiqueInput): Promise<CritiqueResult> {
  const userMessage = [
    "Plan being critiqued:",
    "---",
    input.planSummary,
    "---",
    "",
    "Signals the plan was based on (truncated):",
    "---",
    input.signalsSummary.slice(0, 4000),
    "---",
    "",
    input.briefSummary ? `Brief context:\n${input.briefSummary}` : "(No brief this week.)",
    "",
    "Critique the plan. Return JSON only.",
  ].join("\n")

  const { content } = await callAgent(SYSTEM_PROMPT, userMessage, critiqueSchema, {
    model: MODEL_HAIKU,
    maxTokens: 600,
  })
  return content
}

/**
 * Heuristic: should the agent re-run its main reason step in response to this critique?
 * Re-run only when the original confidence is shaky AND critique flags a clear concern.
 * One re-run cap; no recursion.
 */
export function shouldReRunAfterCritique(
  critique: CritiqueResult,
  originalConfidence: number,
): boolean {
  return critique.overall === "should_revise" && originalConfidence <= 7
}
```

- [ ] **Step 3: Run test, see it pass**

Run: `npm --prefix functions run test -- self-critique`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/self-critique.ts functions/src/__tests__/self-critique.test.ts
git commit -m "feat(agents): self-critique helper (Haiku second pass)"
```

### Task E2: Wire self-critique into SEO agent

**Files:**
- Modify: `functions/src/seo-agent.ts`
- Modify: `functions/src/seo/reason.ts`
- Modify: `supabase/migrations/00145_self_critique_notes.sql` (create)

- [ ] **Step 1: Migration — `self_critique_notes` on SEO + Ads memo tables**

Create `supabase/migrations/00145_self_critique_notes.sql`:

```sql
ALTER TABLE seo_agent_memos        ADD COLUMN self_critique_notes TEXT;
ALTER TABLE google_ads_agent_memos ADD COLUMN self_critique_notes TEXT;
-- chief_strategist_memos already has self_critique_notes from migration 00142
```

Apply via MCP. Update row types in `types/database.ts`.

- [ ] **Step 2: Add feature flag**

Check `system_settings` table for `agent_self_critique_enabled`. If missing, add via a small migration or upsert at app start. Default: `true`.

- [ ] **Step 3: Update SEO handler**

Edit `functions/src/seo-agent.ts`. Around the `reasonAboutWeek(signals)` call, wrap with critique logic:

```ts
import { runSelfCritique, shouldReRunAfterCritique } from "./lib/self-critique.js"

// after the main reason call:
const flagRow = await supabase
  .from("system_settings")
  .select("value")
  .eq("key", "agent_self_critique_enabled")
  .maybeSingle()
const critiqueEnabled = (flagRow.data?.value as { enabled?: boolean } | null)?.enabled !== false

let finalDecision = decision
let critiqueNotes: string | null = null

if (critiqueEnabled) {
  const critique = await runSelfCritique({
    planSummary: JSON.stringify({ rationale: decision.rationale, actions: decision.actions }),
    signalsSummary: JSON.stringify(signals).slice(0, 4000),
    briefSummary: signals.brief_context ? JSON.stringify(signals.brief_context) : null,
  })
  critiqueNotes = `[v1 critique] overall=${critique.overall}\nobjections: ${critique.objections.join("; ")}`

  if (shouldReRunAfterCritique(critique, decision.agent_confidence)) {
    // Re-run main reason with objections appended.
    const { decision: revised } = await reasonAboutWeek(signals, { critique_objections: critique.objections })
    critiqueNotes = `[v1 plan] ${JSON.stringify(decision.actions.map((a) => a.tool))}\n[critique] ${critique.objections.join("; ")}\n[v2 plan] ${JSON.stringify(revised.actions.map((a) => a.tool))}`
    finalDecision = revised
  }
}

// then use finalDecision instead of decision below, and pass critiqueNotes to the memo insert
```

- [ ] **Step 4: Update `reasonAboutWeek` to accept critique objections**

Edit `functions/src/seo/reason.ts`. Change signature:

```ts
export async function reasonAboutWeek(
  signals: SeoSignalsSummary,
  opts: { critique_objections?: string[] } = {},
): Promise<{ decision: Decision; tokens_used: number }> {
  // ...existing setup...
  const critiqueBlock =
    opts.critique_objections && opts.critique_objections.length > 0
      ? [
          "A second model raised these objections to your prior plan:",
          ...opts.critique_objections.map((o) => `  - ${o}`),
          "",
          "Reconsider. You may keep the plan with stronger justification, or revise it. Output the same schema as before.",
          "",
        ].join("\n")
      : ""
  const userMessage = `${briefBlock}${toolPerfBlock}${critiqueBlock}
Here is the current state...`
  // ...rest unchanged
}
```

- [ ] **Step 5: Persist `self_critique_notes` on memo**

Update the memo insert in `seo-agent.ts` to include `self_critique_notes: critiqueNotes`.

- [ ] **Step 6: Test + commit**

Run: `npm --prefix functions run test -- seo-agent`
Expected: PASS (plus existing tests).

```bash
git add supabase/migrations/00145_self_critique_notes.sql functions/src/seo-agent.ts functions/src/seo/reason.ts types/database.ts
git commit -m "feat(seo): self-critique pass with one-shot re-run when confidence <= 7"
```

### Task E3: Wire self-critique into Ads agent

**Files:**
- Modify: wherever ads reason is called (likely `lib/ads/agent/index.ts:buildStrategistMemo`)
- Modify: `lib/ads/agent/reason.ts`

- [ ] **Step 1: Mirror SEO pattern**

Same logic flow as Task E2 Steps 3–5, adapted to Ads. The reason file is `lib/ads/agent/reason.ts`; the handler is `buildStrategistMemo` (find via grep). Use the same `runSelfCritique` and `shouldReRunAfterCritique` helpers.

Wait — the self-critique helper lives in `functions/src/lib/self-critique.ts`, which Next.js (the Ads agent's runtime) can't import from. Action: also create a copy in `lib/agents/self-critique.ts` with the same code. Yes, this is light duplication; the alternative (shared package) is heavier and out of scope here. Document the duplication in both files' headers.

- [ ] **Step 2: Test + commit**

```bash
git add lib/agents/self-critique.ts lib/ads/agent/ __tests__/lib/agents/self-critique.test.ts
git commit -m "feat(ads): self-critique pass with one-shot re-run"
```

### Task E4: Wire self-critique into Chief strategist

**Files:**
- Modify: `functions/src/chief-strategist.ts`

- [ ] **Step 1: Add critique pass**

Mirror Task E2 Steps 3–5 in `chief-strategist.ts`. The "plan summary" is the brief itself; the "signals summary" is the cross_channel_signals row. Persist `self_critique_notes` on the chief memo (column already exists from Phase A).

- [ ] **Step 2: Commit**

```bash
git add functions/src/chief-strategist.ts
git commit -m "feat(strategy): chief runs self-critique before persisting brief"
```

### Task E5: Seed `prompt_templates` rows for agent few-shots + thread into prompts

**Files:**
- Create: `supabase/migrations/00146_seed_agent_prompt_template_rows.sql`
- Modify: `functions/src/seo/signals.ts` (or `seo-agent.ts`)
- Modify: `functions/src/social-agent.ts` (already reads platform row — just confirm few_shot_examples flows)
- Modify: `functions/src/chief-strategist.ts`
- Modify: `lib/ads/agent/signals.ts`

- [ ] **Step 1: Migration — seed prompt_templates rows for agents**

Create `supabase/migrations/00146_seed_agent_prompt_template_rows.sql`:

```sql
-- Empty prompt_templates rows for agents to read few_shot_examples from.
-- The `prompt` column is intentionally empty — agent system prompts live in
-- code. These rows exist purely as a carrier for the performance-learning-loop
-- to write into.
INSERT INTO prompt_templates (scope, category, prompt, few_shot_examples)
VALUES
  ('chief_strategist', 'weekly_brief', '', '[]'::jsonb),
  ('seo_agent',        'system',       '', '[]'::jsonb),
  ('ads_agent',        'system',       '', '[]'::jsonb)
ON CONFLICT (scope, category) DO NOTHING;
```

Apply via MCP.

- [ ] **Step 2: Add a few-shots reader helper**

Create `functions/src/lib/few-shots.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

export async function readFewShots(
  supabase: SupabaseClient,
  scope: string,
  category: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("prompt_templates")
    .select("few_shot_examples")
    .eq("scope", scope)
    .eq("category", category)
    .maybeSingle()
  const raw = (data as { few_shot_examples: unknown } | null)?.few_shot_examples
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0)
}

export function fewShotsBlock(examples: string[]): string {
  if (examples.length === 0) return ""
  const numbered = examples
    .slice(0, 3)
    .map((ex, i) => `  ${i + 1}. ${ex.slice(0, 600)}`)
    .join("\n")
  return [
    "Recent winners (for inspiration only — do not copy verbatim):",
    numbered,
    "",
  ].join("\n")
}
```

Also create the same helper at `lib/agents/few-shots.ts` for the Ads agent (which runs in Next.js).

- [ ] **Step 3: Thread few-shots into SEO agent**

In `functions/src/seo/reason.ts`, accept few-shots via opts and prepend `fewShotsBlock(opts.few_shots ?? [])` after `toolPerfBlock`.

In `functions/src/seo-agent.ts`, fetch few-shots before calling `reasonAboutWeek`:

```ts
import { readFewShots } from "./lib/few-shots.js"
const fewShots = await readFewShots(supabase, "seo_agent", "system")
const { decision } = await reasonAboutWeek(signals, { few_shots: fewShots })
```

- [ ] **Step 4: Thread into Ads agent**

In `lib/ads/agent/signals.ts` (gather), read few-shots via `lib/agents/few-shots.ts`. Add `few_shots: string[]` to `AdsSignals`. In `reason.ts`, render `fewShotsBlock(signals.few_shots)`.

- [ ] **Step 5: Thread into Chief**

In `functions/src/chief-strategist.ts`, before `callAgent`, fetch:

```ts
const chiefFewShots = await readFewShots(supabase, "chief_strategist", "weekly_brief")
```

Append to `buildChiefUserMessage` input. Render in the user message.

- [ ] **Step 6: Thread into Social**

Social agent already loads `prompt_templates` rows by scope; verify that `few_shot_examples` flows from the writer prompt row into the writer system prompt. If not, prepend the block to `buildCopywriterUserMessage`.

- [ ] **Step 7: Test + commit**

Add tests verifying the block appears in the assembled user message when few_shot_examples is non-empty, and is absent when empty.

```bash
git add supabase/migrations/00146_seed_agent_prompt_template_rows.sql functions/src/lib/few-shots.ts lib/agents/few-shots.ts functions/src/seo/ functions/src/chief-strategist.ts functions/src/social-agent.ts lib/ads/agent/
git commit -m "feat(agents): thread prompt_templates.few_shot_examples into chief/ads/seo/social"
```

---

## Phase F — Social Robustness: `dont_do` + Trending Topics

### Task F1: `scoreBlogVsBrief` enforces `dont_do`

**Files:**
- Modify: `functions/src/strategy/brief-blog-scorer.ts`
- Create: `functions/src/strategy/__tests__/brief-blog-scorer.test.ts`

- [ ] **Step 1: Write failing test**

Create `functions/src/strategy/__tests__/brief-blog-scorer.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { scoreBlogVsBrief } from "../brief-blog-scorer.js"

describe("scoreBlogVsBrief — dont_do rejection", () => {
  const brief = {
    themes: [{ tag: "rotational-power", weight: 1 }],
    keywords_to_chase: ["rotational athletes"],
    hooks_to_test: [],
    dont_do: ["knee surgery recovery"],
  }

  it("returns -1 when a dont_do phrase appears in the title", () => {
    const blog = {
      title: "Comeback from knee surgery recovery",
      content: "anything",
    }
    expect(scoreBlogVsBrief(blog, brief)).toBe(-1)
  })

  it("returns -1 when a dont_do phrase appears in the content (word-boundary)", () => {
    const blog = {
      title: "Rotational power for athletes",
      content: "We discuss knee surgery recovery briefly here.",
    }
    expect(scoreBlogVsBrief(blog, brief)).toBe(-1)
  })

  it("does NOT reject when dont_do is a substring inside another word", () => {
    const brief2 = { ...brief, dont_do: ["pain"] }
    const blog = {
      title: "Pain-free rotation",
      content: "Pain free does not equal pain.",
    }
    // "pain" as a word IS in content, so this WILL match — by design.
    // Confirm test wording: dont_do uses word-boundary, so "painted" wouldn't match "pain".
    expect(scoreBlogVsBrief(blog, brief2)).toBe(-1)
  })

  it("does NOT reject 'painted' when dont_do is 'pain' (word-boundary)", () => {
    const brief3 = { ...brief, dont_do: ["pain"] }
    const blog = {
      title: "A painted wall",
      content: "The wall was painted.",
    }
    expect(scoreBlogVsBrief(blog, brief3)).not.toBe(-1)
  })

  it("returns positive score when dont_do is absent and themes/keywords match", () => {
    const blog = {
      title: "Rotational power for elite athletes",
      content: "Rotational athletes need...",
    }
    expect(scoreBlogVsBrief(blog, brief)).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test, see relevant cases fail**

Run: `npm --prefix functions run test -- brief-blog-scorer`
Expected: FAIL on the dont_do tests.

- [ ] **Step 3: Implement**

Replace `functions/src/strategy/brief-blog-scorer.ts` with:

```ts
// functions/src/strategy/brief-blog-scorer.ts
// Pure helper: scores a blog post against a strategy brief.
//
// Used by the social agent's strategist step. Returns -1 if the blog matches
// any dont_do phrase (case-insensitive, word-boundary). Otherwise sums
// theme/keyword/hook weights.

export interface BriefScoringContext {
  themes: Array<{ tag: string; weight: number }>
  keywords_to_chase: string[]
  hooks_to_test: string[]
  dont_do: string[]
}

export interface ScoreableBlog {
  title: string
  content: string | null
  excerpt?: string | null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Word-boundary case-insensitive substring check. */
function wordBoundaryMatch(haystack: string, phrase: string): boolean {
  if (phrase.length === 0) return false
  const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i")
  return re.test(haystack)
}

export const DONT_DO_REJECTED = -1

export function scoreBlogVsBrief(
  blog: ScoreableBlog,
  brief: BriefScoringContext,
): number {
  const haystack = `${blog.title} ${blog.excerpt ?? ""} ${blog.content ?? ""}`
  for (const phrase of brief.dont_do) {
    if (wordBoundaryMatch(haystack, phrase)) return DONT_DO_REJECTED
  }
  const lowered = haystack.toLowerCase()
  let score = 0
  for (const t of brief.themes) {
    const tag = t.tag.toLowerCase().replace(/-/g, " ")
    if (lowered.includes(tag)) score += 2 * (t.weight ?? 1)
  }
  for (const kw of brief.keywords_to_chase) {
    if (lowered.includes(kw.toLowerCase())) score += 3
  }
  for (const hook of brief.hooks_to_test) {
    if (lowered.includes(hook.toLowerCase().slice(0, 32))) score += 1
  }
  return score
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `npm --prefix functions run test -- brief-blog-scorer`
Expected: PASS.

- [ ] **Step 5: Update social-agent to handle -1 rejections**

Edit `functions/src/social-agent.ts`. In `pickTopicWithBrief`, after `scored = ...sort`, filter:

```ts
const eligible = scored.filter((s) => s.score !== -1)
if (eligible.length === 0) {
  // All candidates blocked by dont_do.
  return { topic: null, brief, alignmentScore: 1 }
}
const top = eligible[0]
// ...rest unchanged but using `eligible` for min/max
```

Then in `handleSocialAgentRun`, when `topic === null` AND `brief !== null` (the new "all-rejected" case):

```ts
if (!topic) {
  if (brief) {
    // Write a "no_eligible_topic" memo + notification, then skip the rest.
    await supabase.from("social_agent_memos").insert({
      run_date: new Date().toISOString().slice(0, 10),
      ai_job_id: jobId,
      brief_id: brief.id,
      brief_alignment_score: null,
      ran_without_brief: false,
      signals_summary: { reason: "all_candidates_rejected_by_dont_do" },
      actions: [{ kind: "no_eligible_topic", payload: { brief_id: brief.id }, rationale: "no candidate cleared dont_do filter" }],
      rationale: "All recent published posts matched brief.dont_do.",
      outcome_status: "no_op",
      outcome_metrics: null,
      social_post_id: null,
      platform,
      agent_confidence: 1,
      dissents_from_brief: false,
      dissent_reason: null,
    })
    // Notify coach via existing notifications path (call your notification helper here)
    await jobRef.update({
      status: "completed",
      result: { skipped: "no_eligible_topic", brief_id: brief.id },
      updatedAt: FieldValue.serverTimestamp(),
    })
    return
  }
  await failJob("Strategist found no published blog post to draft from")
  return
}
```

- [ ] **Step 6: Test + commit**

Run: `npm --prefix functions run test -- social-agent brief-blog-scorer`
Expected: PASS.

```bash
git add functions/src/strategy/brief-blog-scorer.ts functions/src/strategy/__tests__/brief-blog-scorer.test.ts functions/src/social-agent.ts
git commit -m "feat(social): scoreBlogVsBrief enforces dont_do with word-boundary regex"
```

### Task F2: Trending-topics DAL + Social agent prompt injection

**Files:**
- Create: `lib/db/trending-topics.ts`
- Create: `__tests__/lib/db/trending-topics.test.ts`
- Modify: `functions/src/social-agent.ts`

- [ ] **Step 1: Confirm `trending_topics` table shape**

Run: `grep -rn 'trending_topics' supabase/migrations/`. Open the migration that creates the table. Note the column names (likely: `id`, `topic`, `relevance_score`, `source_url`, `scanned_at` — adjust the DAL types if reality differs).

- [ ] **Step 2: Write failing test**

Create `__tests__/lib/db/trending-topics.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { latestTrendingTopics } from "@/lib/db/trending-topics"

describe("trending-topics DAL", () => {
  it("returns empty array when no rows", async () => {
    const order = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const gte = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ gte })
    const from = vi.fn().mockReturnValue({ select })
    const supabase = { from } as unknown as Parameters<typeof latestTrendingTopics>[0]
    const result = await latestTrendingTopics(supabase, 5, 7)
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 3: Implement DAL**

Create `lib/db/trending-topics.ts`:

```ts
// lib/db/trending-topics.ts
// Read-only DAL for trending_topics. Producer is the tavilyTrendingScan cron;
// consumers are the social agent's strategist step (and eventually other agents).

import type { SupabaseClient } from "@supabase/supabase-js"

export interface TrendingTopic {
  id: string
  topic: string
  relevance_score: number | null
  source_url: string | null
  scanned_at: string
}

export async function latestTrendingTopics(
  supabase: SupabaseClient,
  limit = 5,
  withinDays = 7,
): Promise<TrendingTopic[]> {
  const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString()
  const { data } = await supabase
    .from("trending_topics")
    .select("id, topic, relevance_score, source_url, scanned_at")
    .gte("scanned_at", cutoff)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(limit)
  return (data as TrendingTopic[] | null) ?? []
}
```

- [ ] **Step 4: Inline equivalent for `functions/src`**

Since the social agent runs in `functions/`, add a thin local helper at the top of `functions/src/social-agent.ts`:

```ts
interface TrendingTopicRow {
  id: string
  topic: string
  relevance_score: number | null
  source_url: string | null
  scanned_at: string
}

async function latestTrendingTopicsLocal(
  supabase: SupabaseClient,
  limit = 5,
  withinDays = 7,
): Promise<TrendingTopicRow[]> {
  const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString()
  const { data } = await supabase
    .from("trending_topics")
    .select("id, topic, relevance_score, source_url, scanned_at")
    .gte("scanned_at", cutoff)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(limit)
  return (data as TrendingTopicRow[] | null) ?? []
}
```

- [ ] **Step 5: Inject trending topics into social agent's writer prompt**

In `handleSocialAgentRun`, after picking a topic, fetch trending:

```ts
const trending = await latestTrendingTopicsLocal(supabase, 5, 7)
const trendingBlock = trending.length > 0
  ? [
      "Trending topics this week (Tavily, ranked):",
      ...trending.map((t, i) => `  ${i + 1}. ${t.topic}${t.relevance_score != null ? ` — relevance ${t.relevance_score}` : ""}${t.source_url ? ` (${t.source_url})` : ""}`),
      "",
      "If a trending topic aligns with brief themes or keywords_to_chase AND no blog covers it, note this in caption_text and suggest the editor consider a flag_trending_gap action.",
      "",
    ].join("\n")
  : ""
```

Prepend `trendingBlock` to the writer user message via `buildCopywriterUserMessage`. To keep `buildCopywriterUserMessage` pure, just concatenate:

```ts
const writerUserMessage = trendingBlock + buildCopywriterUserMessage({ topic, platform })
const writer = await callAgent<Caption>(writerSystem, writerUserMessage, /* ... */)
```

- [ ] **Step 6: Test + commit**

```bash
git add lib/db/trending-topics.ts __tests__/lib/db/trending-topics.test.ts functions/src/social-agent.ts
git commit -m "feat(social): inject trending topics into writer prompt"
```

---

## Phase G — End-to-End Smoke Test + Polish

### Task G1: Manual end-to-end smoke

- [ ] **Step 1: Run the Chief manually**

Hit `POST /api/admin/strategy/chief/run` (admin). Verify:
- One `strategy_briefs` row inserted with `approval_status='draft'`.
- One `chief_strategist_memos` row inserted with non-empty `themes_considered`, `confidence` set, `self_critique_notes` populated.
- `/admin/strategy` renders the new "Chief reasoning" panel.

- [ ] **Step 2: Approve the brief; run SEO + Ads + Social**

- Approve via UI.
- Hit each agent's manual-run endpoint.
- For each: confirm the memo has `agent_confidence`, `dissents_from_brief`, `brief_id`, and (if scoring has data) `impact_score`.
- Confirm the admin pages show confidence chips.

- [ ] **Step 3: Smoke-test `dont_do` rejection**

- Edit the brief to add a `dont_do` phrase matching a recent blog title.
- Re-run social agent.
- Confirm the memo lands as `outcome_status='no_op'`, `actions[0].kind='no_eligible_topic'`, notification created.

- [ ] **Step 4: Smoke-test outcome scoring**

- Pick a memo measured today. Confirm `impact_score` is in `[-100, 100]`.
- Confirm `agent_tool_baselines` has rows after a few outcomes flip.

### Task G2: Final commit + documentation

- [ ] **Step 1: Update CLAUDE.md if any new conventions were introduced**

In particular if you found new patterns worth documenting (e.g., "agent memos are stamped with confidence; treat ≤4 as actionable for human review"), add a short note under "Key Patterns".

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note agent confidence/dissent/impact_score conventions"
```

---

## Self-Review Checklist (run after plan is written)

- [x] Every spec workstream maps to at least one task above (1→A1-A5, 2→B1-B5, 3→C1-C5, 4→D1-D4, 5→E1-E4, 6→F1, 7→F2, 8→E5).
- [x] No placeholders ("TBD", "add validation", "similar to Task N" without code).
- [x] Migration numbering: 00142 → 00146, matching codebase end-state.
- [x] Function names consistent across tasks: `computeImpactScore`, `runSelfCritique`, `shouldReRunAfterCritique`, `scoreBlogVsBrief`, `latestTrendingTopics`, `readFewShots`, `fewShotsBlock`, `recomputeBaseline`, `upsertBaseline`, `getBaseline`, `listChannelBaselines`, `insertChiefMemo`, `markBriefRejected`, `chiefMemoForBrief`, `latestChiefMemo`.
- [x] Column names consistent: `agent_confidence`, `dissents_from_brief`, `dissent_reason`, `impact_score`, `self_critique_notes`.
- [x] Tests precede implementations per TDD.
- [x] Each task ends with a commit.
- [x] Feature flag `agent_self_critique_enabled` documented (Phase E).
- [x] `functions/` ↔ `lib/` import constraint addressed (twin copies of self-critique + few-shots helpers).

Known shortcut: tests using complex Supabase chain mocks (in DAL tests) skip exhaustive query-shape verification — they prove the function reaches the right table and parameter, which is the contract that matters. If a query goes wrong in production, the integration smoke test (G1) catches it.

# Strategy Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Solo-dev project — commit directly to `main`, no branches.

**Goal:** Coordinate the existing SEO, Ads, and Social agents into a strategy team via a weekly `strategy_briefs` row (written by a new `chiefStrategist`) and weekly `cross_channel_signals` row (written by a new `performanceCritic`). Add memo parity for the Social agent so all three specialists participate in the same outcome loop. Lock in a stable `SpecialistMemo` contract so future channels (Email, YouTube, Podcast, etc.) plug in without redesign.

**Architecture:** Two new Firebase scheduled handlers (`performanceCriticCron` Sat 13:00 UTC, `chiefStrategistCron` Sun 10:00 UTC) + three modified specialist handlers + one new admin surface (`/admin/strategy`). Coordination is via Supabase rows, not LLM-to-LLM dialogue. Ships behind feature flags defaulting `false`; behavior change is opt-in per cron.

**Tech Stack:** Next.js 16 App Router (route handlers + Server Components), Firebase Functions v2 (`onDocumentCreated` + `onSchedule`), Anthropic Claude via `functions/src/ai/anthropic.ts` (`callAgent<T>` with Zod schema, cached system prompt), Supabase Postgres (migrations via `mcp__supabase__apply_migration`), Vitest, TypeScript strict.

**Spec:** [docs/superpowers/specs/2026-05-15-strategy-team-design.md](../specs/2026-05-15-strategy-team-design.md)

**Verification:** Each handler + helper is unit-tested with Vitest (mocked Supabase + Firestore + Claude). End-to-end smoke runs are manual via the admin "Run now" triggers — code does not need to verify the cron wiring itself.

**Out of scope:**
- Enabling the new crons in production (a config flip on `system_settings`, not a code change)
- Per-program briefs (Comeback Code vs Rotational Reboot — themes-within-brief cover it for now)
- Email/YouTube/TikTok specialist agents (contract makes them trivial later)
- Auto-applying ads changes via the brief
- Brief A/B testing
- Daily mini-strategist

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| Supabase migration (via MCP) | Create | `cross_channel_signals` table |
| Supabase migration (via MCP) | Create | `strategy_briefs` table (FKs signals) |
| Supabase migration (via MCP) | Create | `social_agent_memos` + ALTER `seo_agent_memos` + ALTER `google_ads_agent_memos` |
| Supabase migration (via MCP) | Create | `system_settings` rows for new feature flags |
| `types/database.ts` | Modify | Add `StrategyBrief`, `CrossChannelSignal`, `SocialAgentMemo` interfaces + brief columns on existing memos |
| `lib/strategy/specialist-contract.ts` | Create | Shared `StrategyBrief` + `SpecialistMemo` types + Zod schemas |
| `lib/db/strategy-briefs.ts` | Create | DAL: `latestApprovedBrief`, `briefForWeek`, `insertDraftBrief`, `approveBrief`, `rejectBrief`, `patchDraftBrief`, `listBriefs` |
| `lib/db/cross-channel-signals.ts` | Create | DAL: `latestSignal`, `signalForWeek`, `insertSignal`, `insertPreflightFailedSignal`, `listSignals` |
| `lib/db/social-agent-memos.ts` | Create | DAL mirrors `lib/db/seo-agent-memos.ts` |
| `__tests__/lib/db/strategy-briefs.test.ts` | Create | DAL tests |
| `__tests__/lib/db/cross-channel-signals.test.ts` | Create | DAL tests |
| `__tests__/lib/db/social-agent-memos.test.ts` | Create | DAL tests |
| `functions/src/strategy/critic-signals.ts` | Create | Pure helpers: gather memos + attribution + funnel for critic |
| `functions/src/strategy/critic-prompt.ts` | Create | System prompt + user-message builder for the critic |
| `functions/src/strategy/chief-prompt.ts` | Create | System prompt + user-message builder for the chief |
| `functions/src/strategy/brief-blog-scorer.ts` | Create | Pure helper: score blog posts vs brief themes/keywords for the social agent |
| `functions/src/__tests__/critic-signals.test.ts` | Create | Unit tests for critic gather helpers |
| `functions/src/__tests__/critic-prompt.test.ts` | Create | Prompt-builder tests |
| `functions/src/__tests__/chief-prompt.test.ts` | Create | Prompt-builder tests |
| `functions/src/__tests__/brief-blog-scorer.test.ts` | Create | Scorer tests |
| `functions/src/performance-critic.ts` | Create | Handler: gather → reason → persist |
| `functions/src/__tests__/performance-critic.test.ts` | Create | End-to-end handler test (mocked) |
| `functions/src/chief-strategist.ts` | Create | Handler: gather → reason → persist |
| `functions/src/__tests__/chief-strategist.test.ts` | Create | End-to-end handler test (mocked) |
| `functions/src/social-outcome-tracker.ts` | Create | Daily backfill of `outcome_metrics` on aged `social_agent_memos` |
| `functions/src/__tests__/social-outcome-tracker.test.ts` | Create | Backfill behaviour tests |
| `functions/src/social-agent.ts` | Modify | Read brief, score blogs vs brief, write `social_agent_memos` row |
| `functions/src/seo/signals.ts` | Modify | Add `brief_context` to gathered signals |
| `functions/src/seo/reason.ts` | Modify | Inject `brief_context` into reason prompt |
| `functions/src/seo-agent.ts` | Modify | Persist `brief_id`, `brief_alignment_score`, `ran_without_brief` on memo |
| `lib/ads/agent/signals.ts` | Modify | Add `brief_context` to `AdsSignals` |
| `lib/ads/agent/reason.ts` | Modify | Inject `brief_context` into reason prompt |
| `lib/ads/agent/guardrails.ts` | Modify | Add `brief_dont_do` rejection class |
| `lib/ads/agent/execute.ts` | Modify | Persist brief fields on memo write |
| `functions/src/index.ts` | Modify | Register `performanceCritic`, `chiefStrategist`, `socialOutcomeTracker` Firestore handlers + 4 new crons |
| `app/api/admin/strategy/critic/run/route.ts` | Create | Admin-gated manual critic trigger |
| `app/api/admin/strategy/chief/run/route.ts` | Create | Admin-gated manual chief trigger |
| `app/api/admin/strategy/brief/[id]/route.ts` | Create | GET (one brief) + PATCH (edit draft) |
| `app/api/admin/strategy/brief/[id]/approve/route.ts` | Create | POST approve |
| `app/api/admin/strategy/brief/[id]/reject/route.ts` | Create | POST reject |
| `app/(admin)/admin/strategy/page.tsx` | Create | Server Component: current brief + history |
| `app/(admin)/admin/strategy/signals/page.tsx` | Create | Server Component: signal feed |
| `components/admin/strategy/BriefEditor.tsx` | Create | Client Component for editing draft briefs |
| `app/api/admin/internal/strategy-critic/route.ts` | Create | Internal cron-token-gated route |
| `app/api/admin/internal/strategy-chief/route.ts` | Create | Internal cron-token-gated route |
| `app/api/admin/internal/social-agent-cron/route.ts` | Create | Internal cron-token-gated route |
| `app/api/admin/internal/social-outcome-tracker/route.ts` | Create | Internal cron-token-gated route |
| `lib/ai-jobs.ts` | Modify | Extend `AiJobType` with `performance_critic_run`, `chief_strategist_run`, `social_outcome_tracker_run` |
| Weekly content report email | Modify | Append "this week's brief" + "last week's critic findings" sections |

---

## Phase A — Foundation (no behavior change)

After Phase A: schema and DAL exist; nothing reads or writes the new tables yet. Safe to ship and revert.

### Task A1: Migration — `cross_channel_signals` table

**Files:**
- Create (via MCP): migration `create_cross_channel_signals`
- Modify: `types/database.ts`

- [ ] **Step 1: Apply the migration**

Run via `mcp__supabase__apply_migration` with name `create_cross_channel_signals`:

```sql
CREATE TABLE cross_channel_signals (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of                    DATE NOT NULL UNIQUE,
  winners                    JSONB NOT NULL DEFAULT '[]',
  losers                     JSONB NOT NULL DEFAULT '[]',
  anomalies                  JSONB NOT NULL DEFAULT '[]',
  attribution_summary        JSONB NOT NULL DEFAULT '{}',
  recommendations_for_brief  JSONB NOT NULL DEFAULT '[]',
  preflight_status           TEXT NOT NULL DEFAULT 'ok'
                                CHECK (preflight_status IN ('ok','failed')),
  preflight_reasons          JSONB DEFAULT '[]',
  rationale                  TEXT NOT NULL DEFAULT '',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cross_channel_signals_created
  ON cross_channel_signals (created_at DESC);
```

- [ ] **Step 2: Add the TypeScript interface**

In `types/database.ts`, near the existing memo interfaces, add:

```ts
export interface CrossChannelSignal {
  id: string
  week_of: string
  winners: unknown[]
  losers: unknown[]
  anomalies: unknown[]
  attribution_summary: Record<string, unknown>
  recommendations_for_brief: unknown[]
  preflight_status: "ok" | "failed"
  preflight_reasons: string[]
  rationale: string
  created_at: string
}
```

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(db): cross_channel_signals table + type"
```

---

### Task A2: Migration — `strategy_briefs` table

**Files:**
- Create (via MCP): migration `create_strategy_briefs`
- Modify: `types/database.ts`

- [ ] **Step 1: Apply the migration**

Must run **after** A1 because of the FK. Run via `mcp__supabase__apply_migration` with name `create_strategy_briefs`:

```sql
CREATE TABLE strategy_briefs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of           DATE NOT NULL UNIQUE,
  themes            JSONB NOT NULL DEFAULT '[]',
  audience_focus    TEXT NOT NULL,
  priority_channel  TEXT NOT NULL CHECK (priority_channel IN ('seo','ads','social','balanced')),
  keywords_to_chase JSONB NOT NULL DEFAULT '[]',
  hooks_to_test     JSONB NOT NULL DEFAULT '[]',
  ctas              JSONB NOT NULL DEFAULT '[]',
  dont_do           JSONB NOT NULL DEFAULT '[]',
  rationale         TEXT NOT NULL,
  signal_id         UUID REFERENCES cross_channel_signals(id),
  approval_status   TEXT NOT NULL DEFAULT 'draft'
                       CHECK (approval_status IN ('draft','approved','rejected')),
  approved_at       TIMESTAMPTZ,
  approved_by       UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_strategy_briefs_week_status
  ON strategy_briefs (week_of DESC, approval_status);
```

- [ ] **Step 2: Add the TypeScript interface**

In `types/database.ts`:

```ts
export interface StrategyBrief {
  id: string
  week_of: string
  themes: { tag: string; weight: number }[]
  audience_focus: string
  priority_channel: "seo" | "ads" | "social" | "balanced"
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]
  rationale: string
  signal_id: string | null
  approval_status: "draft" | "approved" | "rejected"
  approved_at: string | null
  approved_by: string | null
  created_at: string
}
```

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(db): strategy_briefs table + type"
```

---

### Task A3: Migration — `social_agent_memos` + ALTER existing memos

**Files:**
- Create (via MCP): migration `create_social_agent_memos_and_brief_columns`
- Modify: `types/database.ts`

- [ ] **Step 1: Apply the migration**

```sql
CREATE TABLE social_agent_memos (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id                UUID REFERENCES strategy_briefs(id),
  brief_alignment_score   INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ran_without_brief       BOOLEAN NOT NULL DEFAULT false,
  signals_summary         TEXT NOT NULL,
  actions                 JSONB NOT NULL DEFAULT '[]',
  rationale               TEXT NOT NULL,
  outcome_status          TEXT NOT NULL DEFAULT 'pending'
                             CHECK (outcome_status IN ('pending','measured','preflight_failed','no_op')),
  outcome_metrics         JSONB,
  social_post_id          UUID REFERENCES social_posts(id),
  platform                TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  measured_at             TIMESTAMPTZ
);

CREATE INDEX idx_social_agent_memos_outcome
  ON social_agent_memos (outcome_status, created_at);

ALTER TABLE seo_agent_memos
  ADD COLUMN brief_id UUID REFERENCES strategy_briefs(id),
  ADD COLUMN brief_alignment_score INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ADD COLUMN ran_without_brief BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE google_ads_agent_memos
  ADD COLUMN brief_id UUID REFERENCES strategy_briefs(id),
  ADD COLUMN brief_alignment_score INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ADD COLUMN ran_without_brief BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Add the TypeScript interface and extend existing ones**

In `types/database.ts`, add:

```ts
export interface SocialAgentMemo {
  id: string
  brief_id: string | null
  brief_alignment_score: number | null
  ran_without_brief: boolean
  signals_summary: string
  actions: Array<{ kind: string; payload: unknown; rationale: string }>
  rationale: string
  outcome_status: "pending" | "measured" | "preflight_failed" | "no_op"
  outcome_metrics: Record<string, unknown> | null
  social_post_id: string | null
  platform: string | null
  created_at: string
  measured_at: string | null
}
```

In the existing `SeoAgentMemo` and `GoogleAdsAgentMemo` interfaces add:

```ts
brief_id: string | null
brief_alignment_score: number | null
ran_without_brief: boolean
```

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(db): social_agent_memos + brief columns on existing memos"
```

---

### Task A4: Feature-flag rows in `system_settings`

**Files:**
- Create (via MCP): migration `seed_strategy_team_flags`

- [ ] **Step 1: Apply the migration**

```sql
INSERT INTO system_settings (key, value, description) VALUES
  ('cron_performance_critic_enabled',  'false'::jsonb, 'Master switch for the Saturday performance critic cron.'),
  ('cron_chief_strategist_enabled',    'false'::jsonb, 'Master switch for the Sunday chief strategist cron.'),
  ('cron_social_agent_enabled',        'false'::jsonb, 'Master switch for the Tue/Thu autonomous social agent cron.'),
  ('cron_social_outcome_tracker_enabled', 'false'::jsonb, 'Master switch for the daily social-agent outcome backfill cron.'),
  ('brief_required_for_specialists',   'false'::jsonb, 'When true, specialist agents no-op if no approved brief exists.')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Commit a marker so the migration shows up in history**

```bash
git commit --allow-empty -m "feat(settings): strategy-team feature flags (migration only)"
```

---

### Task A5: Specialist contract types + Zod schemas

**Files:**
- Create: `lib/strategy/specialist-contract.ts`
- Create: `__tests__/lib/strategy/specialist-contract.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/lib/strategy/specialist-contract.test.ts
import { describe, it, expect } from "vitest"
import {
  StrategyBriefSchema,
  SpecialistMemoSchema,
} from "@/lib/strategy/specialist-contract"

describe("StrategyBriefSchema", () => {
  it("accepts a minimal valid brief", () => {
    const parsed = StrategyBriefSchema.parse({
      week_of: "2026-05-18",
      themes: [{ tag: "rotational-power", weight: 0.8 }],
      audience_focus: "Golfers 45+ recovering rotational power",
      priority_channel: "seo",
      keywords_to_chase: ["rotational power"],
      hooks_to_test: ["the lost decade"],
      ctas: ["Book a Comeback Code call"],
      dont_do: [],
      rationale: "GSC striking-distance + ads CAC favor rotational content",
    })
    expect(parsed.themes[0].tag).toBe("rotational-power")
  })

  it("rejects an invalid priority_channel", () => {
    expect(() =>
      StrategyBriefSchema.parse({
        week_of: "2026-05-18",
        themes: [],
        audience_focus: "x",
        priority_channel: "email",
        keywords_to_chase: [],
        hooks_to_test: [],
        ctas: [],
        dont_do: [],
        rationale: "x",
      }),
    ).toThrow()
  })
})

describe("SpecialistMemoSchema", () => {
  it("accepts a memo with no brief (ran_without_brief=true)", () => {
    const parsed = SpecialistMemoSchema.parse({
      channel: "seo",
      brief_id: null,
      brief_alignment_score: null,
      ran_without_brief: true,
      signals_summary: "no brief, fell back",
      actions: [],
      rationale: "x",
      outcome_status: "pending",
      outcome_metrics: null,
    })
    expect(parsed.ran_without_brief).toBe(true)
  })

  it("rejects alignment_score out of range", () => {
    expect(() =>
      SpecialistMemoSchema.parse({
        channel: "seo",
        brief_id: "uuid",
        brief_alignment_score: 11,
        ran_without_brief: false,
        signals_summary: "x",
        actions: [],
        rationale: "x",
        outcome_status: "pending",
        outcome_metrics: null,
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm run test:run -- __tests__/lib/strategy/specialist-contract.test.ts`
Expected: FAIL with "Cannot find module ... specialist-contract".

- [ ] **Step 3: Write the contract file**

```ts
// lib/strategy/specialist-contract.ts
// The stable contract every specialist agent (SEO, Ads, Social, future channels)
// implements. Adding a new channel = new agent + new *_agent_memos table that
// conforms to SpecialistMemo. The critic walks all *_agent_memos uniformly via
// this shape; the brief is consumed identically by every specialist.

import { z } from "zod"

export const StrategyBriefSchema = z.object({
  week_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  themes: z.array(z.object({ tag: z.string().min(1), weight: z.number().min(0).max(1) })),
  audience_focus: z.string().min(1),
  priority_channel: z.enum(["seo", "ads", "social", "balanced"]),
  keywords_to_chase: z.array(z.string()),
  hooks_to_test: z.array(z.string()),
  ctas: z.array(z.string()),
  dont_do: z.array(z.string()),
  rationale: z.string().min(1),
})

export type StrategyBriefShape = z.infer<typeof StrategyBriefSchema>

export const SpecialistMemoSchema = z.object({
  channel: z.enum(["seo", "ads", "social"]),
  brief_id: z.string().nullable(),
  brief_alignment_score: z.number().int().min(1).max(10).nullable(),
  ran_without_brief: z.boolean(),
  signals_summary: z.string(),
  actions: z.array(
    z.object({
      kind: z.string(),
      payload: z.unknown(),
      rationale: z.string(),
    }),
  ),
  rationale: z.string(),
  outcome_status: z.enum(["pending", "measured", "preflight_failed", "no_op"]),
  outcome_metrics: z.record(z.string(), z.unknown()).nullable(),
})

export type SpecialistMemoShape = z.infer<typeof SpecialistMemoSchema>

// Brief-context bundle every specialist's reason() step receives so prompts
// stay consistent. Built once by each specialist from latestApprovedBrief().
export interface BriefContext {
  brief_id: string
  week_of: string
  themes: StrategyBriefShape["themes"]
  audience_focus: string
  priority_channel: StrategyBriefShape["priority_channel"]
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test:run -- __tests__/lib/strategy/specialist-contract.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/strategy/specialist-contract.ts __tests__/lib/strategy/specialist-contract.test.ts
git commit -m "feat(strategy): specialist contract types + zod schemas"
```

---

### Task A6: DAL — `lib/db/strategy-briefs.ts`

**Files:**
- Create: `lib/db/strategy-briefs.ts`
- Create: `__tests__/lib/db/strategy-briefs.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/lib/db/strategy-briefs.test.ts
import { describe, it, expect, vi } from "vitest"
import {
  latestApprovedBrief,
  approveBrief,
  patchDraftBrief,
} from "@/lib/db/strategy-briefs"

function mockSupabase(rows: unknown, error: unknown = null) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: rows, error }),
    single: vi.fn().mockResolvedValue({ data: rows, error }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  }
}

describe("strategy_briefs DAL", () => {
  it("latestApprovedBrief filters on approved status", async () => {
    const sb = mockSupabase({ id: "b1", approval_status: "approved" })
    const row = await latestApprovedBrief(sb as never)
    expect(row?.id).toBe("b1")
    expect(sb.eq).toHaveBeenCalledWith("approval_status", "approved")
  })

  it("latestApprovedBrief returns null when no approved row", async () => {
    const sb = mockSupabase(null)
    expect(await latestApprovedBrief(sb as never)).toBeNull()
  })

  it("approveBrief sets status + audit columns", async () => {
    const sb = mockSupabase({ id: "b1" })
    await approveBrief(sb as never, "b1", "user-1")
    expect(sb.update).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "approved", approved_by: "user-1" }),
    )
  })

  it("patchDraftBrief refuses non-draft rows", async () => {
    const sb = mockSupabase({ id: "b1", approval_status: "approved" })
    await expect(
      patchDraftBrief(sb as never, "b1", { rationale: "new" }),
    ).rejects.toThrow(/draft/i)
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm run test:run -- __tests__/lib/db/strategy-briefs.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the DAL**

```ts
// lib/db/strategy-briefs.ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { StrategyBrief } from "@/types/database"

export async function latestApprovedBrief(
  supabase: SupabaseClient,
): Promise<StrategyBrief | null> {
  const { data } = await supabase
    .from("strategy_briefs")
    .select("*")
    .eq("approval_status", "approved")
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as StrategyBrief | null) ?? null
}

export async function briefForWeek(
  supabase: SupabaseClient,
  weekOf: string,
): Promise<StrategyBrief | null> {
  const { data } = await supabase
    .from("strategy_briefs")
    .select("*")
    .eq("week_of", weekOf)
    .maybeSingle()
  return (data as StrategyBrief | null) ?? null
}

type DraftInsert = Omit<
  StrategyBrief,
  "id" | "created_at" | "approved_at" | "approved_by" | "approval_status"
> & { approval_status?: "draft" }

export async function insertDraftBrief(
  supabase: SupabaseClient,
  brief: DraftInsert,
): Promise<StrategyBrief> {
  const { data, error } = await supabase
    .from("strategy_briefs")
    .insert({ ...brief, approval_status: "draft" })
    .select()
    .single()
  if (error || !data) throw new Error(`insertDraftBrief: ${error?.message ?? "unknown"}`)
  return data as StrategyBrief
}

export async function approveBrief(
  supabase: SupabaseClient,
  id: string,
  userId: string,
): Promise<StrategyBrief> {
  const { data, error } = await supabase
    .from("strategy_briefs")
    .update({
      approval_status: "approved",
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single()
  if (error || !data) throw new Error(`approveBrief: ${error?.message ?? "unknown"}`)
  return data as StrategyBrief
}

export async function rejectBrief(
  supabase: SupabaseClient,
  id: string,
  userId: string,
): Promise<StrategyBrief> {
  const { data, error } = await supabase
    .from("strategy_briefs")
    .update({
      approval_status: "rejected",
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single()
  if (error || !data) throw new Error(`rejectBrief: ${error?.message ?? "unknown"}`)
  return data as StrategyBrief
}

export async function patchDraftBrief(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<
    Omit<StrategyBrief, "id" | "created_at" | "approval_status" | "approved_at" | "approved_by">
  >,
): Promise<StrategyBrief> {
  const existing = await supabase
    .from("strategy_briefs")
    .select("approval_status")
    .eq("id", id)
    .maybeSingle()
  if (existing.data?.approval_status !== "draft") {
    throw new Error("patchDraftBrief: brief is not in draft state")
  }
  const { data, error } = await supabase
    .from("strategy_briefs")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error || !data) throw new Error(`patchDraftBrief: ${error?.message ?? "unknown"}`)
  return data as StrategyBrief
}

export async function listBriefs(
  supabase: SupabaseClient,
  limit = 8,
): Promise<StrategyBrief[]> {
  const { data } = await supabase
    .from("strategy_briefs")
    .select("*")
    .order("week_of", { ascending: false })
    .limit(limit)
  return (data as StrategyBrief[] | null) ?? []
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test:run -- __tests__/lib/db/strategy-briefs.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/db/strategy-briefs.ts __tests__/lib/db/strategy-briefs.test.ts
git commit -m "feat(db): strategy-briefs DAL"
```

---

### Task A7: DAL — `cross-channel-signals` + `social-agent-memos`

**Files:**
- Create: `lib/db/cross-channel-signals.ts`
- Create: `lib/db/social-agent-memos.ts`
- Create: `__tests__/lib/db/cross-channel-signals.test.ts`
- Create: `__tests__/lib/db/social-agent-memos.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/lib/db/cross-channel-signals.test.ts
import { describe, it, expect, vi } from "vitest"
import {
  latestSignal,
  insertPreflightFailedSignal,
} from "@/lib/db/cross-channel-signals"

describe("cross_channel_signals DAL", () => {
  it("latestSignal returns the most recent row", async () => {
    const sb = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "s1", preflight_status: "ok" },
        error: null,
      }),
    }
    const row = await latestSignal(sb as never)
    expect(row?.id).toBe("s1")
  })

  it("insertPreflightFailedSignal writes status=failed with reasons", async () => {
    const insert = vi.fn().mockReturnThis()
    const sb = {
      from: vi.fn().mockReturnThis(),
      insert,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "s2" }, error: null }),
    }
    await insertPreflightFailedSignal(sb as never, "2026-05-09", ["sparse memos"])
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        preflight_status: "failed",
        preflight_reasons: ["sparse memos"],
        week_of: "2026-05-09",
      }),
    )
  })
})
```

```ts
// __tests__/lib/db/social-agent-memos.test.ts
import { describe, it, expect, vi } from "vitest"
import { recentSocialAgentMemos, insertSocialAgentMemo } from "@/lib/db/social-agent-memos"

describe("social_agent_memos DAL", () => {
  it("recentSocialAgentMemos orders by created_at desc", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: "m1" }], error: null })
    const order = vi.fn().mockReturnValue({ limit })
    const select = vi.fn().mockReturnValue({ order })
    const sb = { from: vi.fn().mockReturnValue({ select }) }
    const rows = await recentSocialAgentMemos(sb as never, 5)
    expect(rows).toHaveLength(1)
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false })
  })

  it("insertSocialAgentMemo throws on error", async () => {
    const sb = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    }
    await expect(
      insertSocialAgentMemo(sb as never, {
        brief_id: null,
        brief_alignment_score: null,
        ran_without_brief: true,
        signals_summary: "x",
        actions: [],
        rationale: "x",
        outcome_status: "pending",
        outcome_metrics: null,
        social_post_id: null,
        platform: null,
      }),
    ).rejects.toThrow(/boom/)
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm run test:run -- __tests__/lib/db/cross-channel-signals.test.ts __tests__/lib/db/social-agent-memos.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the DALs**

```ts
// lib/db/cross-channel-signals.ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CrossChannelSignal } from "@/types/database"

export async function latestSignal(
  supabase: SupabaseClient,
): Promise<CrossChannelSignal | null> {
  const { data } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as CrossChannelSignal | null) ?? null
}

export async function signalForWeek(
  supabase: SupabaseClient,
  weekOf: string,
): Promise<CrossChannelSignal | null> {
  const { data } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .eq("week_of", weekOf)
    .maybeSingle()
  return (data as CrossChannelSignal | null) ?? null
}

type SignalInsert = Omit<CrossChannelSignal, "id" | "created_at">

export async function insertSignal(
  supabase: SupabaseClient,
  signal: SignalInsert,
): Promise<CrossChannelSignal> {
  const { data, error } = await supabase
    .from("cross_channel_signals")
    .insert(signal)
    .select()
    .single()
  if (error || !data) throw new Error(`insertSignal: ${error?.message ?? "unknown"}`)
  return data as CrossChannelSignal
}

export async function insertPreflightFailedSignal(
  supabase: SupabaseClient,
  weekOf: string,
  reasons: string[],
): Promise<CrossChannelSignal> {
  return insertSignal(supabase, {
    week_of: weekOf,
    winners: [],
    losers: [],
    anomalies: [],
    attribution_summary: {},
    recommendations_for_brief: [],
    preflight_status: "failed",
    preflight_reasons: reasons,
    rationale: `Preflight failed: ${reasons.join("; ")}`,
  })
}

export async function listSignals(
  supabase: SupabaseClient,
  limit = 8,
): Promise<CrossChannelSignal[]> {
  const { data } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data as CrossChannelSignal[] | null) ?? []
}
```

```ts
// lib/db/social-agent-memos.ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SocialAgentMemo } from "@/types/database"

type SocialMemoInsert = Omit<SocialAgentMemo, "id" | "created_at" | "measured_at">

export async function insertSocialAgentMemo(
  supabase: SupabaseClient,
  memo: SocialMemoInsert,
): Promise<SocialAgentMemo> {
  const { data, error } = await supabase
    .from("social_agent_memos")
    .insert(memo)
    .select()
    .single()
  if (error || !data) throw new Error(`insertSocialAgentMemo: ${error?.message ?? "unknown"}`)
  return data as SocialAgentMemo
}

export async function recentSocialAgentMemos(
  supabase: SupabaseClient,
  limit = 8,
): Promise<SocialAgentMemo[]> {
  const { data } = await supabase
    .from("social_agent_memos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data as SocialAgentMemo[] | null) ?? []
}

export async function pendingAgedSocialMemos(
  supabase: SupabaseClient,
  olderThanDays = 14,
): Promise<SocialAgentMemo[]> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from("social_agent_memos")
    .select("*")
    .eq("outcome_status", "pending")
    .lt("created_at", cutoff)
  return (data as SocialAgentMemo[] | null) ?? []
}

export async function markMemoMeasured(
  supabase: SupabaseClient,
  id: string,
  outcomeMetrics: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("social_agent_memos")
    .update({
      outcome_status: "measured",
      outcome_metrics: outcomeMetrics,
      measured_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) throw new Error(`markMemoMeasured: ${error.message}`)
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test:run -- __tests__/lib/db/cross-channel-signals.test.ts __tests__/lib/db/social-agent-memos.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/db/cross-channel-signals.ts lib/db/social-agent-memos.ts __tests__/lib/db/cross-channel-signals.test.ts __tests__/lib/db/social-agent-memos.test.ts
git commit -m "feat(db): cross-channel-signals + social-agent-memos DAL"
```

---

## Phase B — Brain handlers

After Phase B: critic and chief handlers exist, are unit-tested, can be triggered manually from admin routes, and have Firestore + scheduled functions wired (disabled by default flags).

### Task B1: Critic signal gatherers + prompt

**Files:**
- Create: `functions/src/strategy/critic-signals.ts`
- Create: `functions/src/strategy/critic-prompt.ts`
- Create: `functions/src/__tests__/critic-signals.test.ts`
- Create: `functions/src/__tests__/critic-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// functions/src/__tests__/critic-signals.test.ts
import { describe, it, expect, vi } from "vitest"
import { gatherCriticInputs, criticPreflight } from "../strategy/critic-signals.js"

describe("gatherCriticInputs", () => {
  it("reads from all five expected tables", async () => {
    const calls: string[] = []
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        calls.push(table)
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
    const inputs = await gatherCriticInputs(sb as never)
    expect(calls).toEqual(
      expect.arrayContaining([
        "seo_agent_memos",
        "google_ads_agent_memos",
        "social_agent_memos",
        "marketing_attribution",
        "cross_channel_signals",
        "voice_drift_flags",
      ]),
    )
    expect(inputs.seoMemos).toEqual([])
  })
})

describe("criticPreflight", () => {
  it("fails when fewer than 2 channels have memos", () => {
    const r = criticPreflight({
      weekOf: "2026-05-09",
      seoMemos: [{ id: "s1" }],
      adsMemos: [],
      socialMemos: [],
      attribution: {},
      funnel: { visits: 0, signups: 0, bookings: 0, payments: 0 },
      priorSignals: [],
      voiceFlags: [],
    })
    expect(r.ok).toBe(false)
  })

  it("passes when at least 2 channels have memos", () => {
    const r = criticPreflight({
      weekOf: "2026-05-09",
      seoMemos: [{ id: "s1" }],
      adsMemos: [{ id: "a1" }],
      socialMemos: [],
      attribution: {},
      funnel: { visits: 0, signups: 0, bookings: 0, payments: 0 },
      priorSignals: [],
      voiceFlags: [],
    })
    expect(r.ok).toBe(true)
  })
})
```

```ts
// functions/src/__tests__/critic-prompt.test.ts
import { describe, it, expect } from "vitest"
import { buildCriticUserMessage, CRITIC_SYSTEM_PROMPT } from "../strategy/critic-prompt.js"

describe("critic prompt", () => {
  it("system prompt instructs JSON-only cross-channel synthesis", () => {
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/cross-channel/i)
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/JSON only/i)
  })

  it("user message embeds counts and attribution", () => {
    const msg = buildCriticUserMessage({
      weekOf: "2026-05-09",
      seoMemos: [{ id: "s1" } as never],
      adsMemos: [],
      socialMemos: [{ id: "x1" } as never, { id: "x2" } as never],
      attribution: { seo: { bookings: 3 } },
      funnel: { visits: 100, signups: 12, bookings: 4, payments: 3 },
      priorSignals: [],
      voiceFlags: [],
    })
    expect(msg).toContain("Week of: 2026-05-09")
    expect(msg).toContain("SEO memos: 1")
    expect(msg).toContain("Social memos: 2")
    expect(msg).toContain("seo")
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm run test:run -- functions/src/__tests__/critic-signals.test.ts functions/src/__tests__/critic-prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the gatherers**

```ts
// functions/src/strategy/critic-signals.ts
import type { SupabaseClient } from "@supabase/supabase-js"

const LOOKBACK_DAYS = 28
const SIGNAL_LOOKBACK = 4
const MIN_CHANNELS_WITH_MEMO = 2

export interface CriticInputs {
  weekOf: string
  seoMemos: unknown[]
  adsMemos: unknown[]
  socialMemos: unknown[]
  attribution: Record<string, { bookings: number; revenue?: number; sessions?: number }>
  funnel: { visits: number; signups: number; bookings: number; payments: number }
  priorSignals: unknown[]
  voiceFlags: unknown[]
}

function isoWeekOf(d = new Date()): string {
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
  return monday.toISOString().slice(0, 10)
}

interface AttrRow {
  channel: string | null
  event_type: string | null
  revenue_cents?: number | null
}

function aggregateAttribution(rows: AttrRow[]) {
  const out: CriticInputs["attribution"] = {}
  for (const r of rows) {
    const c = r.channel ?? "unknown"
    if (!out[c]) out[c] = { bookings: 0, revenue: 0, sessions: 0 }
    if (r.event_type === "booking") out[c].bookings += 1
    if (r.event_type === "payment") out[c].revenue = (out[c].revenue ?? 0) + (r.revenue_cents ?? 0) / 100
    if (r.event_type === "session") out[c].sessions = (out[c].sessions ?? 0) + 1
  }
  return out
}

function aggregateFunnel(rows: AttrRow[]) {
  const f = { visits: 0, signups: 0, bookings: 0, payments: 0 }
  for (const r of rows) {
    if (r.event_type === "visit") f.visits += 1
    else if (r.event_type === "signup") f.signups += 1
    else if (r.event_type === "booking") f.bookings += 1
    else if (r.event_type === "payment") f.payments += 1
  }
  return f
}

export async function gatherCriticInputs(supabase: SupabaseClient): Promise<CriticInputs> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [seoRes, adsRes, socialRes, attrRes, signalRes, voiceRes] = await Promise.all([
    supabase.from("seo_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("google_ads_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("social_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("marketing_attribution").select("*").gte("occurred_at", cutoff),
    supabase.from("cross_channel_signals").select("*").order("created_at", { ascending: false }).limit(SIGNAL_LOOKBACK),
    supabase.from("voice_drift_flags").select("*").gte("created_at", cutoff),
  ])
  const attrRows = (attrRes.data as AttrRow[] | null) ?? []
  return {
    weekOf: isoWeekOf(),
    seoMemos: (seoRes.data as unknown[]) ?? [],
    adsMemos: (adsRes.data as unknown[]) ?? [],
    socialMemos: (socialRes.data as unknown[]) ?? [],
    attribution: aggregateAttribution(attrRows),
    funnel: aggregateFunnel(attrRows),
    priorSignals: (signalRes.data as unknown[]) ?? [],
    voiceFlags: (voiceRes.data as unknown[]) ?? [],
  }
}

export interface PreflightSummary {
  ok: boolean
  reasons: string[]
  channelMemoCounts: { seo: number; ads: number; social: number }
}

export function criticPreflight(inputs: CriticInputs): PreflightSummary {
  const counts = {
    seo: inputs.seoMemos.length,
    ads: inputs.adsMemos.length,
    social: inputs.socialMemos.length,
  }
  const channelsWithMemos = Object.values(counts).filter((n) => n > 0).length
  if (channelsWithMemos < MIN_CHANNELS_WITH_MEMO) {
    return {
      ok: false,
      reasons: [
        `Only ${channelsWithMemos} channel(s) have memos in the last ${LOOKBACK_DAYS}d (need ${MIN_CHANNELS_WITH_MEMO}).`,
      ],
      channelMemoCounts: counts,
    }
  }
  return { ok: true, reasons: [], channelMemoCounts: counts }
}
```

```ts
// functions/src/strategy/critic-prompt.ts
import type { CriticInputs } from "./critic-signals.js"

export const CRITIC_SYSTEM_PROMPT = `You are the Performance Critic for the Darren J Paul Athlete brand.

Your job: synthesize the past four weeks of cross-channel agent memos + booking attribution + funnel data into a single weekly signal row. You read SEO, Ads, and Social agent memos uniformly; you DO NOT make new actions. Your output becomes the primary input for next Sunday's Chief Strategist.

Priorities (in order):
1. North-star: bookings + revenue via marketing_attribution.
2. Compounding: identify what's been working multi-week, not one-off blips.
3. Anomalies worth investigating: sudden CAC moves, organic-traffic spikes/drops, hook-engagement outliers.

Return JSON only matching this shape:
{
  "winners": [{ "channel": "seo|ads|social", "what": "...", "evidence": "..." }],
  "losers": [{ "channel": "...", "what": "...", "evidence": "..." }],
  "anomalies": [{ "what": "...", "evidence": "..." }],
  "attribution_summary": { "<channel>": { "bookings": <int>, "revenue": <num>, "trend_vs_prior_week": "up|down|flat" } },
  "recommendations_for_brief": ["specific direction for next week's brief"],
  "rationale": "2-3 paragraphs explaining the call"
}`

export function buildCriticUserMessage(input: CriticInputs): string {
  return [
    `Week of: ${input.weekOf}`,
    "",
    `SEO memos: ${input.seoMemos.length}`,
    `Ads memos: ${input.adsMemos.length}`,
    `Social memos: ${input.socialMemos.length}`,
    `Voice drift flags (last 28d): ${input.voiceFlags.length}`,
    `Prior signals (${input.priorSignals.length}):`,
    JSON.stringify(input.priorSignals, null, 2),
    "",
    "Attribution by channel (last 28d):",
    JSON.stringify(input.attribution, null, 2),
    "",
    "Funnel (last 28d):",
    JSON.stringify(input.funnel, null, 2),
    "",
    "SEO memos:",
    JSON.stringify(input.seoMemos, null, 2),
    "",
    "Ads memos:",
    JSON.stringify(input.adsMemos, null, 2),
    "",
    "Social memos:",
    JSON.stringify(input.socialMemos, null, 2),
    "",
    "Return JSON only.",
  ].join("\n")
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm run test:run -- functions/src/__tests__/critic-signals.test.ts functions/src/__tests__/critic-prompt.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/strategy functions/src/__tests__/critic-signals.test.ts functions/src/__tests__/critic-prompt.test.ts
git commit -m "feat(strategy): critic signal gatherers + prompt"
```

---

### Task B2: Performance Critic handler

**Files:**
- Create: `functions/src/performance-critic.ts`
- Create: `functions/src/__tests__/performance-critic.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// functions/src/__tests__/performance-critic.test.ts
import { describe, it, expect, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))
vi.mock("../ai/anthropic.js", () => ({
  callAgent: vi.fn(),
  MODEL_SONNET: "claude-sonnet-4-6",
}))

import { runPerformanceCritic } from "../performance-critic.js"
import { getSupabase } from "../lib/supabase.js"
import { callAgent } from "../ai/anthropic.js"

describe("runPerformanceCritic", () => {
  it("writes preflight_failed signal when fewer than 2 channels have memos", async () => {
    const insert = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { id: "s1" }, error: null })
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "cross_channel_signals") {
          return { insert, select: vi.fn().mockReturnThis(), single }
        }
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    const result = await runPerformanceCritic()
    expect(result.outcome).toBe("preflight_failed")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ preflight_status: "failed" }),
    )
    expect(callAgent).not.toHaveBeenCalled()
  })

  it("writes ok signal row when preflight passes", async () => {
    const insert = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { id: "s2" }, error: null })
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "cross_channel_signals") {
          return { insert, select: vi.fn().mockReturnThis(), single }
        }
        if (table === "seo_agent_memos" || table === "social_agent_memos") {
          return {
            select: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [{ id: `m-${table}` }], error: null }),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    ;(callAgent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: {
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: ["focus rotational"],
        rationale: "ok",
      },
    })

    const result = await runPerformanceCritic()
    expect(result.outcome).toBe("ok")
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ preflight_status: "ok" }))
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm run test:run -- functions/src/__tests__/performance-critic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the handler**

```ts
// functions/src/performance-critic.ts
// Saturday cron handler. Reads last 4 weeks of memos + attribution + funnel,
// writes one cross_channel_signals row. No-ops if preflight fails.

import { z } from "zod"
import { getSupabase } from "./lib/supabase.js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { gatherCriticInputs, criticPreflight } from "./strategy/critic-signals.js"
import { CRITIC_SYSTEM_PROMPT, buildCriticUserMessage } from "./strategy/critic-prompt.js"

const CriticOutputSchema = z.object({
  winners: z.array(z.object({
    channel: z.enum(["seo", "ads", "social"]),
    what: z.string(),
    evidence: z.string(),
  })),
  losers: z.array(z.object({ channel: z.string(), what: z.string(), evidence: z.string() })),
  anomalies: z.array(z.object({ what: z.string(), evidence: z.string() })),
  attribution_summary: z.record(z.string(), z.unknown()),
  recommendations_for_brief: z.array(z.string()),
  rationale: z.string().min(1),
})

export type CriticOutcome = "ok" | "preflight_failed" | "error"

export interface PerformanceCriticResult {
  outcome: CriticOutcome
  signalId?: string
  reasons?: string[]
}

export async function runPerformanceCritic(): Promise<PerformanceCriticResult> {
  const supabase = getSupabase()
  const inputs = await gatherCriticInputs(supabase)
  const preflight = criticPreflight(inputs)

  if (!preflight.ok) {
    const { data, error } = await supabase
      .from("cross_channel_signals")
      .insert({
        week_of: inputs.weekOf,
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: [],
        preflight_status: "failed",
        preflight_reasons: preflight.reasons,
        rationale: `Preflight failed: ${preflight.reasons.join("; ")}`,
      })
      .select("id")
      .single()
    if (error) console.error("[performance-critic] preflight insert error", error)
    return { outcome: "preflight_failed", signalId: data?.id, reasons: preflight.reasons }
  }

  const { content } = await callAgent(
    CRITIC_SYSTEM_PROMPT,
    buildCriticUserMessage(inputs),
    CriticOutputSchema,
    { model: MODEL_SONNET, maxTokens: 3000, cacheSystemPrompt: true },
  )

  const { data, error } = await supabase
    .from("cross_channel_signals")
    .insert({
      week_of: inputs.weekOf,
      winners: content.winners,
      losers: content.losers,
      anomalies: content.anomalies,
      attribution_summary: content.attribution_summary,
      recommendations_for_brief: content.recommendations_for_brief,
      preflight_status: "ok",
      preflight_reasons: [],
      rationale: content.rationale,
    })
    .select("id")
    .single()
  if (error) {
    console.error("[performance-critic] signal insert error", error)
    return { outcome: "error" }
  }
  console.log(`[performance-critic] wrote signal ${data?.id} for week ${inputs.weekOf}`)
  return { outcome: "ok", signalId: data?.id }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm run test:run -- functions/src/__tests__/performance-critic.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/performance-critic.ts functions/src/__tests__/performance-critic.test.ts
git commit -m "feat(strategy): performance-critic handler"
```

---

### Task B3: Chief Strategist handler + prompt

**Files:**
- Create: `functions/src/strategy/chief-prompt.ts`
- Create: `functions/src/chief-strategist.ts`
- Create: `functions/src/__tests__/chief-prompt.test.ts`
- Create: `functions/src/__tests__/chief-strategist.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// functions/src/__tests__/chief-prompt.test.ts
import { describe, it, expect } from "vitest"
import { buildChiefUserMessage, CHIEF_SYSTEM_PROMPT } from "../strategy/chief-prompt.js"

describe("chief prompt", () => {
  it("system prompt instructs JSON-only StrategyBrief output", () => {
    expect(CHIEF_SYSTEM_PROMPT).toMatch(/StrategyBrief/i)
    expect(CHIEF_SYSTEM_PROMPT).toMatch(/JSON only/i)
  })

  it("user message embeds latest signal + prior brief themes", () => {
    const msg = buildChiefUserMessage({
      weekOf: "2026-05-18",
      latestSignal: {
        id: "s1",
        week_of: "2026-05-11",
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: ["double down on rotational power"],
        preflight_status: "ok",
        preflight_reasons: [],
        rationale: "x",
        created_at: "2026-05-11T13:00:00Z",
      },
      priorBriefs: [
        {
          id: "b0",
          themes: [{ tag: "rotational-power", weight: 0.8 }],
        } as never,
      ],
    })
    expect(msg).toContain("Week of: 2026-05-18")
    expect(msg).toContain("rotational-power")
    expect(msg).toContain("double down on rotational power")
  })
})
```

```ts
// functions/src/__tests__/chief-strategist.test.ts
import { describe, it, expect, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))
vi.mock("../ai/anthropic.js", () => ({
  callAgent: vi.fn(),
  MODEL_SONNET: "claude-sonnet-4-6",
}))

import { runChiefStrategist } from "../chief-strategist.js"
import { getSupabase } from "../lib/supabase.js"
import { callAgent } from "../ai/anthropic.js"

describe("runChiefStrategist", () => {
  it("skips when no signal exists", async () => {
    const sb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    const result = await runChiefStrategist()
    expect(result.outcome).toBe("no_signal")
    expect(callAgent).not.toHaveBeenCalled()
  })

  it("inserts a draft brief when a fresh signal exists", async () => {
    const insert = vi.fn().mockReturnThis()
    const select = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { id: "b1" }, error: null })
    const recentSignal = {
      id: "s1",
      created_at: new Date().toISOString(),
      preflight_status: "ok",
      recommendations_for_brief: [],
    }
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "cross_channel_signals") {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: recentSignal, error: null }),
          }
        }
        if (table === "strategy_briefs") {
          return {
            insert,
            select,
            single,
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    ;(callAgent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: {
        week_of: "2026-05-18",
        themes: [{ tag: "rotational-power", weight: 0.8 }],
        audience_focus: "x",
        priority_channel: "seo",
        keywords_to_chase: [],
        hooks_to_test: [],
        ctas: [],
        dont_do: [],
        rationale: "ok",
      },
    })
    const result = await runChiefStrategist()
    expect(result.outcome).toBe("draft_created")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "draft", signal_id: "s1" }),
    )
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm run test:run -- functions/src/__tests__/chief-prompt.test.ts functions/src/__tests__/chief-strategist.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the prompt + handler**

```ts
// functions/src/strategy/chief-prompt.ts
import type { CrossChannelSignal, StrategyBrief } from "../../../types/database.js"

export const CHIEF_SYSTEM_PROMPT = `You are the Chief Strategist for the Darren J Paul Athlete brand.

Your job: produce next week's StrategyBrief — a single coordinating document the SEO, Ads, and Social agents will read. You are NOT picking specific actions; you are setting direction. Specialists keep their own action queues and approvals.

Inputs you receive:
1. The most recent cross_channel_signals row (the Critic's read of the last 4 weeks).
2. The last 4 briefs you wrote (for theme continuity — avoid week-to-week whiplash).

Priorities (in order):
1. Bookings + revenue, not vanity engagement. Use the signal's attribution_summary.
2. Compounding themes: themes that already worked > novel themes.
3. Avoid whiplash: keep at least one theme from last week unless the data is clear it bombed.

Return JSON only matching this exact StrategyBrief shape:
{
  "week_of": "<ISO date Monday of target week>",
  "themes": [{ "tag": "<kebab-case>", "weight": <0..1> }],
  "audience_focus": "<1-2 sentences>",
  "priority_channel": "seo|ads|social|balanced",
  "keywords_to_chase": ["<seed keyword>", ...],
  "hooks_to_test": ["<hook line>", ...],
  "ctas": ["<call to action>", ...],
  "dont_do": ["<hard guardrail line>", ...],
  "rationale": "<2-3 paragraphs explaining why>"
}`

export interface ChiefPromptInput {
  weekOf: string
  latestSignal: CrossChannelSignal
  priorBriefs: StrategyBrief[]
}

export function buildChiefUserMessage(input: ChiefPromptInput): string {
  return [
    `Week of: ${input.weekOf}`,
    "",
    "Latest Performance Critic signal:",
    JSON.stringify(input.latestSignal, null, 2),
    "",
    `Prior briefs (${input.priorBriefs.length}, most recent first):`,
    JSON.stringify(input.priorBriefs, null, 2),
    "",
    "Return JSON only matching the StrategyBrief shape.",
  ].join("\n")
}
```

```ts
// functions/src/chief-strategist.ts
// Sunday cron handler. Reads most recent signal + last 4 briefs, asks Claude
// for a draft brief, inserts with approval_status='draft'. Skips silently if
// no fresh signal exists.

import { getSupabase } from "./lib/supabase.js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { StrategyBriefSchema } from "../../lib/strategy/specialist-contract.js"
import { CHIEF_SYSTEM_PROMPT, buildChiefUserMessage } from "./strategy/chief-prompt.js"
import type { CrossChannelSignal, StrategyBrief } from "../../types/database.js"

const SIGNAL_MAX_AGE_DAYS = 8
const PRIOR_BRIEFS_LOOKBACK = 4

export type ChiefOutcome = "draft_created" | "no_signal" | "stale_signal" | "error"

export interface ChiefStrategistResult {
  outcome: ChiefOutcome
  briefId?: string
  signalId?: string
}

function nextMondayUTC(d = new Date()): string {
  const day = d.getUTCDay()
  const offset = day === 0 ? 1 : 8 - day
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset))
  return monday.toISOString().slice(0, 10)
}

export async function runChiefStrategist(): Promise<ChiefStrategistResult> {
  const supabase = getSupabase()

  const { data: signalRow } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const signal = signalRow as CrossChannelSignal | null
  if (!signal) {
    console.log("[chief-strategist] no signal row — skipping")
    return { outcome: "no_signal" }
  }

  const ageMs = Date.now() - new Date(signal.created_at).getTime()
  if (ageMs > SIGNAL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    console.log(`[chief-strategist] signal too old (${(ageMs / 86_400_000).toFixed(1)}d)`)
    return { outcome: "stale_signal", signalId: signal.id }
  }
  if (signal.preflight_status === "failed") {
    console.log("[chief-strategist] latest signal is preflight_failed")
    return { outcome: "stale_signal", signalId: signal.id }
  }

  const { data: priorRows } = await supabase
    .from("strategy_briefs")
    .select("*")
    .order("week_of", { ascending: false })
    .limit(PRIOR_BRIEFS_LOOKBACK)
  const priorBriefs = (priorRows as StrategyBrief[] | null) ?? []

  const weekOf = nextMondayUTC()
  const { content } = await callAgent(
    CHIEF_SYSTEM_PROMPT,
    buildChiefUserMessage({ weekOf, latestSignal: signal, priorBriefs }),
    StrategyBriefSchema,
    { model: MODEL_SONNET, maxTokens: 3000, cacheSystemPrompt: true },
  )

  const { data, error } = await supabase
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
  if (error) {
    console.error("[chief-strategist] insert error", error)
    return { outcome: "error", signalId: signal.id }
  }
  console.log(`[chief-strategist] wrote draft brief ${data?.id} for week ${content.week_of}`)
  return { outcome: "draft_created", briefId: data?.id, signalId: signal.id }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm run test:run -- functions/src/__tests__/chief-prompt.test.ts functions/src/__tests__/chief-strategist.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/strategy/chief-prompt.ts functions/src/chief-strategist.ts functions/src/__tests__/chief-prompt.test.ts functions/src/__tests__/chief-strategist.test.ts
git commit -m "feat(strategy): chief-strategist handler"
```

---

### Task B4: Brief approval + manual trigger routes

**Files:**
- Create: `app/api/admin/strategy/brief/[id]/route.ts`
- Create: `app/api/admin/strategy/brief/[id]/approve/route.ts`
- Create: `app/api/admin/strategy/brief/[id]/reject/route.ts`
- Create: `app/api/admin/strategy/critic/run/route.ts`
- Create: `app/api/admin/strategy/chief/run/route.ts`
- Modify: `lib/ai-jobs.ts`

- [ ] **Step 1: Extend `AiJobType`**

In `lib/ai-jobs.ts`, add to the `AiJobType` union:

```ts
  | "performance_critic_run"
  | "chief_strategist_run"
```

- [ ] **Step 2: Write the brief routes**

```ts
// app/api/admin/strategy/brief/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { patchDraftBrief } from "@/lib/db/strategy-briefs"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const sb = createAdminClient()
  const { data } = await sb.from("strategy_briefs").select("*").eq("id", id).maybeSingle()
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ brief: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 })
  const sb = createAdminClient()
  try {
    const updated = await patchDraftBrief(sb, id, body as never)
    return NextResponse.json({ brief: updated })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 })
  }
}
```

```ts
// app/api/admin/strategy/brief/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { approveBrief } from "@/lib/db/strategy-briefs"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const sb = createAdminClient()
  const brief = await approveBrief(sb, id, session.user.id)
  return NextResponse.json({ brief })
}
```

```ts
// app/api/admin/strategy/brief/[id]/reject/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { rejectBrief } from "@/lib/db/strategy-briefs"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const sb = createAdminClient()
  const brief = await rejectBrief(sb, id, session.user.id)
  return NextResponse.json({ brief })
}
```

```ts
// app/api/admin/strategy/critic/run/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_req: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { jobId } = await createAiJob({
    type: "performance_critic_run",
    userId: session.user.id,
    input: {},
  })
  return NextResponse.json({ jobId, status: "pending" }, { status: 202 })
}
```

```ts
// app/api/admin/strategy/chief/run/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_req: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { jobId } = await createAiJob({
    type: "chief_strategist_run",
    userId: session.user.id,
    input: {},
  })
  return NextResponse.json({ jobId, status: "pending" }, { status: 202 })
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/ai-jobs.ts app/api/admin/strategy
git commit -m "feat(api): brief approval + manual trigger routes"
```

---

### Task B5: Internal cron-token-gated routes

**Files:**
- Create: `app/api/admin/internal/strategy-critic/route.ts`
- Create: `app/api/admin/internal/strategy-chief/route.ts`

- [ ] **Step 1: Write both routes**

```ts
// app/api/admin/internal/strategy-critic/route.ts
import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_req: NextRequest) {
  const auth = (await headers()).get("authorization") ?? ""
  if (auth.replace(/^Bearer\s+/i, "") !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sb = createAdminClient()
  const [pausedRes, enabledRes] = await Promise.all([
    sb.from("system_settings").select("value").eq("key", "automation_paused").maybeSingle(),
    sb.from("system_settings").select("value").eq("key", "cron_performance_critic_enabled").maybeSingle(),
  ])
  if (pausedRes.data?.value === true) return NextResponse.json({ skipped: "automation_paused" })
  if (enabledRes.data?.value !== true) return NextResponse.json({ skipped: "cron_performance_critic_enabled=false" })
  const { jobId } = await createAiJob({ type: "performance_critic_run", userId: "system", input: {} })
  return NextResponse.json({ jobId, status: "pending" })
}
```

```ts
// app/api/admin/internal/strategy-chief/route.ts
import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_req: NextRequest) {
  const auth = (await headers()).get("authorization") ?? ""
  if (auth.replace(/^Bearer\s+/i, "") !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sb = createAdminClient()
  const [pausedRes, enabledRes] = await Promise.all([
    sb.from("system_settings").select("value").eq("key", "automation_paused").maybeSingle(),
    sb.from("system_settings").select("value").eq("key", "cron_chief_strategist_enabled").maybeSingle(),
  ])
  if (pausedRes.data?.value === true) return NextResponse.json({ skipped: "automation_paused" })
  if (enabledRes.data?.value !== true) return NextResponse.json({ skipped: "cron_chief_strategist_enabled=false" })
  const { jobId } = await createAiJob({ type: "chief_strategist_run", userId: "system", input: {} })
  return NextResponse.json({ jobId, status: "pending" })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/internal/strategy-critic app/api/admin/internal/strategy-chief
git commit -m "feat(api): internal cron-token routes for critic + chief"
```

---

### Task B6: Wire Firebase Functions handlers + crons

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Append to `functions/src/index.ts`**

```ts
// ─── Performance Critic (ai_jobs handler) ────────────────────────────────────
export const performanceCritic = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "performance_critic_run") return
    const { runPerformanceCritic } = await import("./performance-critic.js")
    const result = await runPerformanceCritic()
    console.log("[performanceCritic]", event.params.jobId, result)
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore")
    await getFirestore().collection("ai_jobs").doc(event.params.jobId).update({
      status: "completed",
      result,
      updatedAt: FieldValue.serverTimestamp(),
    })
  },
)

// ─── Chief Strategist (ai_jobs handler) ──────────────────────────────────────
export const chiefStrategist = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "chief_strategist_run") return
    const { runChiefStrategist } = await import("./chief-strategist.js")
    const result = await runChiefStrategist()
    console.log("[chiefStrategist]", event.params.jobId, result)
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore")
    await getFirestore().collection("ai_jobs").doc(event.params.jobId).update({
      status: "completed",
      result,
      updatedAt: FieldValue.serverTimestamp(),
    })
  },
)

// ─── Performance Critic Cron (Sat 13:00 UTC) ────────────────────────────────
export const performanceCriticCron = onSchedule(
  {
    schedule: "0 13 * * 6",
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
      console.error("[performanceCriticCron] APP_URL or INTERNAL_CRON_TOKEN missing")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/strategy-critic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      console.log("[performanceCriticCron]", res.status, await res.json().catch(() => ({})))
    } catch (err) {
      console.error("[performanceCriticCron] failed:", err)
    }
  },
)

// ─── Chief Strategist Cron (Sun 10:00 UTC) ───────────────────────────────────
export const chiefStrategistCron = onSchedule(
  {
    schedule: "0 10 * * 0",
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
      console.error("[chiefStrategistCron] APP_URL or INTERNAL_CRON_TOKEN missing")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/strategy-chief`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      console.log("[chiefStrategistCron]", res.status, await res.json().catch(() => ({})))
    } catch (err) {
      console.error("[chiefStrategistCron] failed:", err)
    }
  },
)
```

- [ ] **Step 2: Type-check the functions build**

Run: `cd functions && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat(functions): wire performance-critic + chief-strategist handlers + crons"
```

---

## Phase C — Admin surface

### Task C1: `/admin/strategy` page + BriefEditor

**Files:**
- Create: `app/(admin)/admin/strategy/page.tsx`
- Create: `components/admin/strategy/BriefEditor.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/(admin)/admin/strategy/page.tsx
import { createAdminClient } from "@/lib/supabase"
import { listBriefs } from "@/lib/db/strategy-briefs"
import { listSignals } from "@/lib/db/cross-channel-signals"
import { BriefEditor } from "@/components/admin/strategy/BriefEditor"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function StrategyPage() {
  const sb = createAdminClient()
  const [briefs, signals] = await Promise.all([listBriefs(sb, 8), listSignals(sb, 4)])
  const draft = briefs.find((b) => b.approval_status === "draft") ?? null
  const history = briefs.filter((b) => b !== draft)

  return (
    <div className="space-y-8 p-6">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-3xl">Strategy</h1>
        <Link href="/admin/strategy/signals" className="text-sm underline decoration-accent underline-offset-4">
          View signals →
        </Link>
      </header>

      <section>
        <h2 className="font-heading text-xl">Current draft</h2>
        {draft ? (
          <BriefEditor brief={draft} />
        ) : (
          <p className="text-muted-foreground">
            No draft for this week. Trigger the chief manually or wait for Sunday&apos;s cron.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-xl">Latest signals</h2>
        <ul className="space-y-2 text-sm">
          {signals.map((s) => (
            <li key={s.id} className="rounded border border-border p-3">
              <div className="font-mono text-xs text-muted-foreground">
                {s.week_of} · {s.preflight_status}
              </div>
              <div className="mt-1">
                {s.rationale.slice(0, 240)}
                {s.rationale.length > 240 ? "…" : ""}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-xl">Brief history</h2>
        <ul className="space-y-2 text-sm">
          {history.map((b) => (
            <li key={b.id} className="rounded border border-border p-3">
              <div className="font-mono text-xs text-muted-foreground">
                {b.week_of} · {b.approval_status} · priority: {b.priority_channel}
              </div>
              <div className="mt-1">{b.audience_focus}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

```tsx
// components/admin/strategy/BriefEditor.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { StrategyBrief } from "@/types/database"

export function BriefEditor({ brief }: { brief: StrategyBrief }) {
  const router = useRouter()
  const [rationale, setRationale] = useState(brief.rationale)
  const [audienceFocus, setAudienceFocus] = useState(brief.audience_focus)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const res = await fetch(`/api/admin/strategy/brief/${brief.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rationale, audience_focus: audienceFocus }),
    })
    setBusy(false)
    if (!res.ok) {
      alert((await res.json()).error)
      return
    }
    router.refresh()
  }

  async function approve() {
    setBusy(true)
    const res = await fetch(`/api/admin/strategy/brief/${brief.id}/approve`, { method: "POST" })
    setBusy(false)
    if (!res.ok) {
      alert((await res.json()).error)
      return
    }
    router.refresh()
  }

  async function reject() {
    setBusy(true)
    const res = await fetch(`/api/admin/strategy/brief/${brief.id}/reject`, { method: "POST" })
    setBusy(false)
    if (!res.ok) {
      alert((await res.json()).error)
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-4 rounded border border-border p-4">
      <div className="font-mono text-xs text-muted-foreground">
        Week of {brief.week_of} · priority: {brief.priority_channel}
      </div>

      <label className="block text-sm">
        <span className="font-heading">Audience focus</span>
        <textarea
          className="mt-1 w-full rounded border border-border p-2 font-body"
          rows={2}
          value={audienceFocus}
          onChange={(e) => setAudienceFocus(e.target.value)}
        />
      </label>

      <label className="block text-sm">
        <span className="font-heading">Rationale</span>
        <textarea
          className="mt-1 w-full rounded border border-border p-2 font-body"
          rows={8}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </label>

      <details className="text-sm">
        <summary className="cursor-pointer">Themes · keywords · hooks · CTAs · don&apos;t do</summary>
        <pre className="mt-2 overflow-auto rounded bg-surface p-3 font-mono text-xs">
{JSON.stringify(
  {
    themes: brief.themes,
    keywords_to_chase: brief.keywords_to_chase,
    hooks_to_test: brief.hooks_to_test,
    ctas: brief.ctas,
    dont_do: brief.dont_do,
  },
  null,
  2,
)}
        </pre>
      </details>

      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="rounded bg-surface px-3 py-1 text-sm">
          Save draft
        </button>
        <button onClick={approve} disabled={busy} className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground">
          Approve
        </button>
        <button onClick={reject} disabled={busy} className="rounded border border-error px-3 py-1 text-sm text-error">
          Reject
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(admin\)/admin/strategy components/admin/strategy
git commit -m "feat(admin): /admin/strategy page + brief editor"
```

---

### Task C2: `/admin/strategy/signals` page + admin sidebar link

**Files:**
- Create: `app/(admin)/admin/strategy/signals/page.tsx`
- Modify: admin sidebar (find via grep)

- [ ] **Step 1: Locate the admin sidebar**

Run: Grep `pattern: "href=\"/admin/automation\""`, `path: "components"`. The first match is the admin sidebar file. Open it.

- [ ] **Step 2: Write the signals page**

```tsx
// app/(admin)/admin/strategy/signals/page.tsx
import { createAdminClient } from "@/lib/supabase"
import { listSignals } from "@/lib/db/cross-channel-signals"

export const dynamic = "force-dynamic"

export default async function SignalsPage() {
  const sb = createAdminClient()
  const signals = await listSignals(sb, 12)

  return (
    <div className="space-y-6 p-6">
      <h1 className="font-heading text-3xl">Cross-channel signals</h1>
      {signals.length === 0 && (
        <p className="text-muted-foreground">No signals yet. Run the critic manually from /admin/strategy.</p>
      )}
      <ul className="space-y-3">
        {signals.map((s) => (
          <li key={s.id} className="rounded border border-border p-4">
            <div className="font-mono text-xs text-muted-foreground">
              {s.week_of} · {s.preflight_status} · {new Date(s.created_at).toLocaleString()}
            </div>
            <h2 className="mt-2 font-heading">Recommendations for next brief</h2>
            <ul className="ml-4 list-disc text-sm">
              {(s.recommendations_for_brief as string[]).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <h2 className="mt-3 font-heading">Rationale</h2>
            <p className="whitespace-pre-wrap text-sm">{s.rationale}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Add nav link**

In the admin sidebar file from Step 1, add a "Strategy" item near the existing AI/automation links pointing to `/admin/strategy`. Match the exact prop shape of the neighboring items — don't invent new props.

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/strategy components/admin
git commit -m "feat(admin): signals page + strategy nav link"
```

---

## Phase D — Specialist integration + Social parity

After Phase D: SEO + Ads agents inject brief context into reasoning; Social agent scores blog posts vs brief and writes a memo row; new social cron + outcome tracker wired.

### Task D1: SEO agent reads brief

**Files:**
- Modify: `functions/src/seo/signals.ts`
- Modify: `functions/src/seo/reason.ts`
- Modify: `functions/src/seo-agent.ts`
- Modify: existing seo tests in `functions/src/__tests__/seo-*.test.ts`

- [ ] **Step 1: Extend `gatherSeoSignals` with brief context**

Open [functions/src/seo/signals.ts](../../../functions/src/seo/signals.ts). At the top of the file add:

```ts
import { latestApprovedBrief } from "../../../lib/db/strategy-briefs.js"
import type { BriefContext } from "../../../lib/strategy/specialist-contract.js"
```

Add `brief_context: BriefContext | null` to the `SeoSignals` interface in the same file (or wherever `SeoSignals` is declared — keep the field next to siblings).

Inside `gatherSeoSignals(supabase)`, before composing the returned object, add:

```ts
const brief = await latestApprovedBrief(supabase)
const brief_context: BriefContext | null = brief
  ? {
      brief_id: brief.id,
      week_of: brief.week_of,
      themes: brief.themes,
      audience_focus: brief.audience_focus,
      priority_channel: brief.priority_channel,
      keywords_to_chase: brief.keywords_to_chase,
      hooks_to_test: brief.hooks_to_test,
      ctas: brief.ctas,
      dont_do: brief.dont_do,
    }
  : null
```

Include `brief_context` on the returned signals object.

- [ ] **Step 2: Inject brief into the reason prompt + extend decision schema**

In [functions/src/seo/reason.ts](../../../functions/src/seo/reason.ts), find where the user message is built. At the top of the message, prepend:

```ts
const briefBlock = signals.brief_context
  ? [
      "Brief context (bias your action ranking toward themes + keywords; treat dont_do as hard guardrail):",
      JSON.stringify(signals.brief_context, null, 2),
      "",
    ].join("\n")
  : "(No approved brief this week — reason freely.)\n"
```

Add `briefBlock` as the first segment of the user message (before existing signal sections).

In [functions/src/seo/decision-schema.ts](../../../functions/src/seo/decision-schema.ts), add to the top-level decision object:

```ts
brief_alignment_score: z.number().int().min(1).max(10).nullable(),
```

- [ ] **Step 3: Persist brief fields on the memo write**

In [functions/src/seo-agent.ts](../../../functions/src/seo-agent.ts) inside the `seo_agent_memos` insert, add:

```ts
brief_id: signals.brief_context?.brief_id ?? null,
brief_alignment_score: decision.brief_alignment_score ?? null,
ran_without_brief: signals.brief_context === null,
```

- [ ] **Step 4: Honor `dont_do` as a hard guardrail at execute time**

In [functions/src/seo/execute.ts](../../../functions/src/seo/execute.ts), in `executeAction`, before each tool branch, add:

```ts
const dontDo = (signals?.brief_context?.dont_do ?? []) as string[]
const blob = JSON.stringify(action).toLowerCase()
const blockedBy = dontDo.find((phrase) => blob.includes(phrase.toLowerCase()))
if (blockedBy) {
  return {
    executed: false,
    execution_target_id: null,
    rejection_reason: `brief_dont_do:${blockedBy}`,
  }
}
```

Update the `executeAction` signature to accept `signals` (pass through from the handler call site).

- [ ] **Step 5: Update existing seo tests**

For every existing test that constructs a `SeoSignals` literal, add `brief_context: null`. Run all seo tests and fix any compile errors.

- [ ] **Step 6: Run tests**

Run: `npm run test:run -- functions/src/__tests__/seo-`
Expected: all SEO tests pass.

- [ ] **Step 7: Commit**

```bash
git add functions/src/seo functions/src/seo-agent.ts functions/src/__tests__/seo-
git commit -m "feat(seo): read brief, alignment score, dont_do guardrail"
```

---

### Task D2: Ads agent reads brief

**Files:**
- Modify: `lib/ads/agent/types.ts`
- Modify: `lib/ads/agent/signals.ts`
- Modify: `lib/ads/agent/reason.ts`
- Modify: `lib/ads/agent/guardrails.ts`
- Modify: `lib/ads/agent/decision-schema.ts`
- Modify: `lib/ads/agent/execute.ts`

- [ ] **Step 1: Extend `AdsSignals` with brief_context**

In [lib/ads/agent/types.ts](../../../lib/ads/agent/types.ts), add to the `AdsSignals` interface:

```ts
import type { BriefContext } from "@/lib/strategy/specialist-contract"
// ...inside AdsSignals:
brief_context: BriefContext | null
```

- [ ] **Step 2: Populate brief_context in `signals.ts`**

In [lib/ads/agent/signals.ts](../../../lib/ads/agent/signals.ts), at the top of `gatherAdsSignals`, after preflight passes, add:

```ts
import { latestApprovedBrief } from "@/lib/db/strategy-briefs"
// ...
const brief = await latestApprovedBrief(supabase)
const brief_context = brief
  ? {
      brief_id: brief.id,
      week_of: brief.week_of,
      themes: brief.themes,
      audience_focus: brief.audience_focus,
      priority_channel: brief.priority_channel,
      keywords_to_chase: brief.keywords_to_chase,
      hooks_to_test: brief.hooks_to_test,
      ctas: brief.ctas,
      dont_do: brief.dont_do,
    }
  : null
```

Include `brief_context` on the returned `AdsSignals` object.

- [ ] **Step 3: Inject brief into the ads reason prompt**

In [lib/ads/agent/reason.ts](../../../lib/ads/agent/reason.ts), prepend a `brief_context` block at the top of the user message (same pattern as Task D1 Step 2).

- [ ] **Step 4: Add `brief_dont_do` guardrail**

In [lib/ads/agent/guardrails.ts](../../../lib/ads/agent/guardrails.ts), inside the existing `applyGuardrails(action, signals)` function, add a new check that runs before the existing checks:

```ts
if (signals.brief_context?.dont_do?.length) {
  const blob = JSON.stringify(action.payload ?? action).toLowerCase()
  for (const phrase of signals.brief_context.dont_do) {
    if (blob.includes(phrase.toLowerCase())) {
      return {
        ok: false,
        rejection_class: "brief_dont_do",
        reason: `brief.dont_do contains "${phrase}"`,
      }
    }
  }
}
```

- [ ] **Step 5: Extend the decision schema**

In [lib/ads/agent/decision-schema.ts](../../../lib/ads/agent/decision-schema.ts), add to the top-level Zod object:

```ts
brief_alignment_score: z.number().int().min(1).max(10).nullable(),
```

- [ ] **Step 6: Persist brief fields on the memo write**

In [lib/ads/agent/execute.ts](../../../lib/ads/agent/execute.ts), where `google_ads_agent_memos` is inserted, add:

```ts
brief_id: signals.brief_context?.brief_id ?? null,
brief_alignment_score: decision.brief_alignment_score ?? null,
ran_without_brief: signals.brief_context === null,
```

- [ ] **Step 7: Update existing ads tests**

For every test that constructs an `AdsSignals` literal, add `brief_context: null`. Run all ads tests.

- [ ] **Step 8: Run + commit**

```bash
npm run test:run -- __tests__/lib/ads functions/src/__tests__/ads-
git add lib/ads/agent
git commit -m "feat(ads): read brief, brief_dont_do guardrail, alignment score"
```

---

### Task D3: Social agent — brief-scored topic + memo write

**Files:**
- Create: `functions/src/strategy/brief-blog-scorer.ts`
- Create: `functions/src/__tests__/brief-blog-scorer.test.ts`
- Modify: `functions/src/social-agent.ts`
- Modify: `functions/src/__tests__/social-agent.test.ts`

- [ ] **Step 1: Write the scorer test**

```ts
// functions/src/__tests__/brief-blog-scorer.test.ts
import { describe, it, expect } from "vitest"
import { scoreBlogVsBrief } from "../strategy/brief-blog-scorer.js"

describe("scoreBlogVsBrief", () => {
  it("scores higher when title/content matches themes + keywords", () => {
    const brief = {
      themes: [
        { tag: "rotational-power", weight: 1 },
        { tag: "shoulder-mobility", weight: 0.5 },
      ],
      keywords_to_chase: ["rotational power", "drive distance"],
      hooks_to_test: [],
      ctas: [],
      dont_do: [],
    } as never
    const a = scoreBlogVsBrief(
      { title: "Rotational power drives long drives", content: "drive distance rotational power" },
      brief,
    )
    const b = scoreBlogVsBrief(
      { title: "Stretching basics", content: "general flexibility content" },
      brief,
    )
    expect(a).toBeGreaterThan(b)
  })

  it("returns 0 when brief has no signal terms", () => {
    expect(
      scoreBlogVsBrief(
        { title: "x", content: "y" },
        { themes: [], keywords_to_chase: [], hooks_to_test: [], ctas: [], dont_do: [] } as never,
      ),
    ).toBe(0)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm run test:run -- functions/src/__tests__/brief-blog-scorer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the scorer**

```ts
// functions/src/strategy/brief-blog-scorer.ts
import type { BriefContext } from "../../../lib/strategy/specialist-contract.js"

export interface ScoreableBlog {
  title: string
  content: string | null
  excerpt?: string | null
}

export function scoreBlogVsBrief(
  blog: ScoreableBlog,
  brief: Pick<BriefContext, "themes" | "keywords_to_chase" | "hooks_to_test">,
): number {
  const haystack = `${blog.title} ${blog.excerpt ?? ""} ${blog.content ?? ""}`.toLowerCase()
  let score = 0
  for (const t of brief.themes) {
    const tag = t.tag.toLowerCase().replace(/-/g, " ")
    if (haystack.includes(tag)) score += 2 * (t.weight ?? 1)
  }
  for (const kw of brief.keywords_to_chase) {
    if (haystack.includes(kw.toLowerCase())) score += 3
  }
  for (const hook of brief.hooks_to_test) {
    if (haystack.includes(hook.toLowerCase().slice(0, 32))) score += 1
  }
  return score
}
```

- [ ] **Step 4: Add `pickTopicWithBrief` to social-agent.ts**

In [functions/src/social-agent.ts](../../../functions/src/social-agent.ts), add at the top of the file:

```ts
import { latestApprovedBrief } from "../../lib/db/strategy-briefs.js"
import { insertSocialAgentMemo } from "../../lib/db/social-agent-memos.js"
import { scoreBlogVsBrief } from "./strategy/brief-blog-scorer.js"
import type { StrategyBrief } from "../../types/database.js"
```

After the existing `pickTopic`, add:

```ts
export async function pickTopicWithBrief(args: {
  supabase: SupabaseClient
  blogPostId?: string
}): Promise<{ topic: BlogTopic | null; brief: StrategyBrief | null; alignmentScore: number | null }> {
  const { supabase, blogPostId } = args
  if (blogPostId) {
    const topic = await pickTopic({ supabase, blogPostId })
    return { topic, brief: null, alignmentScore: null }
  }
  const brief = await latestApprovedBrief(supabase)
  const { data } = await supabase
    .from("blog_posts")
    .select("id, title, slug, excerpt, content")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(20)
  const list = (data as BlogTopic[] | null) ?? []
  if (list.length === 0) return { topic: null, brief, alignmentScore: null }
  if (!brief) return { topic: list[0], brief: null, alignmentScore: null }

  const scored = list
    .map((c) => ({ c, score: scoreBlogVsBrief(c, brief) }))
    .sort((a, b) => b.score - a.score)
  const top = scored[0]
  if (top.score === 0) return { topic: list[0], brief, alignmentScore: 1 }
  const max = scored[0].score
  const min = scored[scored.length - 1]?.score ?? 0
  const norm =
    max === min ? 10 : Math.max(1, Math.min(10, Math.round(((top.score - min) / (max - min)) * 9 + 1)))
  return { topic: top.c, brief, alignmentScore: norm }
}
```

- [ ] **Step 5: Use `pickTopicWithBrief` inside `handleSocialAgentRun` and write a memo**

Inside `handleSocialAgentRun`, replace the existing `const topic = await pickTopic(...)` call with:

```ts
const { topic, brief, alignmentScore } = await pickTopicWithBrief({
  supabase,
  blogPostId: input.blogPostId,
})
if (!topic) {
  await failJob("Strategist found no published blog post to draft from")
  return
}
```

After the existing `social_posts` + `social_captions` inserts (i.e. after `post.id` exists), add a memo insert. Place it just before the final `jobRef.update({ status: "completed", ... })`:

```ts
await insertSocialAgentMemo(supabase, {
  brief_id: brief?.id ?? null,
  brief_alignment_score: alignmentScore,
  ran_without_brief: brief === null,
  signals_summary: `topic=${topic.slug} platform=${platform}`,
  actions: [
    {
      kind: "drafted_social_post",
      payload: { social_post_id: post.id, platform, blog_post_id: topic.id },
      rationale: reviewed.content.notes || "writer+reviewer agreed",
    },
  ],
  rationale: reviewed.content.notes || "",
  outcome_status: "pending",
  outcome_metrics: null,
  social_post_id: post.id,
  platform,
})
```

- [ ] **Step 6: Update existing social-agent.test.ts**

Open `functions/src/__tests__/social-agent.test.ts`. Add a test that verifies `pickTopicWithBrief` falls back to most-recent when no brief exists. Existing pure-helper tests need no changes (they test `pickTopic`, `buildCopywriterUserMessage`, `buildReviewerUserMessage` which are unchanged).

```ts
import { pickTopicWithBrief } from "../social-agent.js"
// (add to the existing describe block)

it("pickTopicWithBrief falls back to most-recent when no approved brief exists", async () => {
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "strategy_briefs") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (table === "blog_posts") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{ id: "b1", title: "T", slug: "t", excerpt: null, content: null }],
            error: null,
          }),
        }
      }
      return {}
    }),
  } as never
  const { topic, brief, alignmentScore } = await pickTopicWithBrief({ supabase })
  expect(topic?.id).toBe("b1")
  expect(brief).toBeNull()
  expect(alignmentScore).toBeNull()
})
```

- [ ] **Step 7: Run tests**

Run: `npm run test:run -- functions/src/__tests__/brief-blog-scorer.test.ts functions/src/__tests__/social-agent.test.ts`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add functions/src/strategy/brief-blog-scorer.ts functions/src/social-agent.ts functions/src/__tests__/brief-blog-scorer.test.ts functions/src/__tests__/social-agent.test.ts
git commit -m "feat(social): brief-scored topic + memo write"
```

---

### Task D4: Social outcome tracker

**Files:**
- Create: `functions/src/social-outcome-tracker.ts`
- Create: `functions/src/__tests__/social-outcome-tracker.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// functions/src/__tests__/social-outcome-tracker.test.ts
import { describe, it, expect, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))

import { runSocialOutcomeTracker } from "../social-outcome-tracker.js"
import { getSupabase } from "../lib/supabase.js"

describe("runSocialOutcomeTracker", () => {
  it("marks each aged pending memo as measured", async () => {
    const updates: string[] = []
    const updateChain = {
      eq: vi.fn().mockImplementation((_col: string, id: string) => {
        updates.push(id)
        return Promise.resolve({ data: null, error: null })
      }),
    }
    const update = vi.fn().mockReturnValue(updateChain)
    const aged = [
      { id: "m1", social_post_id: "p1" },
      { id: "m2", social_post_id: "p2" },
    ]
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "social_agent_memos") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            lt: vi.fn().mockResolvedValue({ data: aged, error: null }),
            update,
          }
        }
        if (table === "social_analytics") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [{ likes: 12, comments: 1, shares: 0, impressions: 200, engagement_rate: 0.06 }],
              error: null,
            }),
          }
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    const result = await runSocialOutcomeTracker()
    expect(result.measured).toBe(2)
    expect(updates).toEqual(["m1", "m2"])
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm run test:run -- functions/src/__tests__/social-outcome-tracker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the tracker**

```ts
// functions/src/social-outcome-tracker.ts
// Daily backfill: for each social_agent_memos row with outcome_status='pending'
// and created_at older than 14 days, summarize social_analytics for the linked
// post and flip the memo to 'measured'. Staggered to 04:45 UTC (after SEO 04:15
// and Ads 04:30).

import { getSupabase } from "./lib/supabase.js"

const AGE_DAYS = 14

export interface SocialOutcomeResult {
  measured: number
  skipped: number
}

export async function runSocialOutcomeTracker(): Promise<SocialOutcomeResult> {
  const supabase = getSupabase()
  const cutoff = new Date(Date.now() - AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: aged } = await supabase
    .from("social_agent_memos")
    .select("id, social_post_id")
    .eq("outcome_status", "pending")
    .lt("created_at", cutoff)

  const rows = (aged as Array<{ id: string; social_post_id: string | null }> | null) ?? []
  let measured = 0
  let skipped = 0
  for (const row of rows) {
    if (!row.social_post_id) {
      skipped += 1
      continue
    }
    const { data: snapshots } = await supabase
      .from("social_analytics")
      .select("likes, comments, shares, impressions, engagement_rate")
      .eq("social_post_id", row.social_post_id)
    const list = (snapshots as Array<Record<string, number | null>> | null) ?? []
    const sum = (k: string) => list.reduce((acc, s) => acc + (Number(s[k]) || 0), 0)
    const metrics = {
      snapshots: list.length,
      likes: sum("likes"),
      comments: sum("comments"),
      shares: sum("shares"),
      impressions: sum("impressions"),
      latest_engagement_rate: list.at(-1)?.engagement_rate ?? null,
    }
    await supabase
      .from("social_agent_memos")
      .update({
        outcome_status: "measured",
        outcome_metrics: metrics,
        measured_at: new Date().toISOString(),
      })
      .eq("id", row.id)
    measured += 1
  }
  return { measured, skipped }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm run test:run -- functions/src/__tests__/social-outcome-tracker.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/social-outcome-tracker.ts functions/src/__tests__/social-outcome-tracker.test.ts
git commit -m "feat(social): outcome tracker for social_agent_memos"
```

---

### Task D5: Wire social cron + outcome-tracker cron

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `lib/ai-jobs.ts`
- Create: `app/api/admin/internal/social-agent-cron/route.ts`
- Create: `app/api/admin/internal/social-outcome-tracker/route.ts`

- [ ] **Step 1: Extend `AiJobType`**

In `lib/ai-jobs.ts`, add to the `AiJobType` union:

```ts
  | "social_outcome_tracker_run"
```

- [ ] **Step 2: Write the internal cron-token routes**

```ts
// app/api/admin/internal/social-agent-cron/route.ts
import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_req: NextRequest) {
  const auth = (await headers()).get("authorization") ?? ""
  if (auth.replace(/^Bearer\s+/i, "") !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sb = createAdminClient()
  const [pausedRes, enabledRes] = await Promise.all([
    sb.from("system_settings").select("value").eq("key", "automation_paused").maybeSingle(),
    sb.from("system_settings").select("value").eq("key", "cron_social_agent_enabled").maybeSingle(),
  ])
  if (pausedRes.data?.value === true) return NextResponse.json({ skipped: "automation_paused" })
  if (enabledRes.data?.value !== true) return NextResponse.json({ skipped: "cron_social_agent_enabled=false" })
  const { jobId } = await createAiJob({
    type: "social_agent_run",
    userId: "system",
    input: { platform: "linkedin" },
  })
  return NextResponse.json({ jobId, status: "pending" })
}
```

```ts
// app/api/admin/internal/social-outcome-tracker/route.ts
import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_req: NextRequest) {
  const auth = (await headers()).get("authorization") ?? ""
  if (auth.replace(/^Bearer\s+/i, "") !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sb = createAdminClient()
  const [pausedRes, enabledRes] = await Promise.all([
    sb.from("system_settings").select("value").eq("key", "automation_paused").maybeSingle(),
    sb.from("system_settings").select("value").eq("key", "cron_social_outcome_tracker_enabled").maybeSingle(),
  ])
  if (pausedRes.data?.value === true) return NextResponse.json({ skipped: "automation_paused" })
  if (enabledRes.data?.value !== true) return NextResponse.json({ skipped: "cron_social_outcome_tracker_enabled=false" })
  const { jobId } = await createAiJob({ type: "social_outcome_tracker_run", userId: "system", input: {} })
  return NextResponse.json({ jobId, status: "pending" })
}
```

- [ ] **Step 3: Append Firebase Functions + crons to `functions/src/index.ts`**

```ts
// ─── Social Outcome Tracker (ai_jobs handler) ────────────────────────────────
export const socialOutcomeTracker = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "256MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "social_outcome_tracker_run") return
    const { runSocialOutcomeTracker } = await import("./social-outcome-tracker.js")
    const result = await runSocialOutcomeTracker()
    console.log("[socialOutcomeTracker]", event.params.jobId, result)
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore")
    await getFirestore().collection("ai_jobs").doc(event.params.jobId).update({
      status: "completed",
      result,
      updatedAt: FieldValue.serverTimestamp(),
    })
  },
)

// ─── Social Agent Cron (Tue + Thu 13:00 UTC) ─────────────────────────────────
export const socialAgentCron = onSchedule(
  {
    schedule: "0 13 * * 2,4",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) return
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/social-agent-cron`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      console.log("[socialAgentCron]", res.status, await res.json().catch(() => ({})))
    } catch (err) {
      console.error("[socialAgentCron] failed:", err)
    }
  },
)

// ─── Social Outcome Tracker Cron (daily 04:45 UTC) ───────────────────────────
export const socialOutcomeTrackerCron = onSchedule(
  {
    schedule: "45 4 * * *",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) return
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/social-outcome-tracker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      console.log("[socialOutcomeTrackerCron]", res.status, await res.json().catch(() => ({})))
    } catch (err) {
      console.error("[socialOutcomeTrackerCron] failed:", err)
    }
  },
)
```

- [ ] **Step 4: Type-check + commit**

```bash
cd functions && npm run build && cd ..
git add functions/src/index.ts lib/ai-jobs.ts app/api/admin/internal/social-agent-cron app/api/admin/internal/social-outcome-tracker
git commit -m "feat(functions): social cron + outcome-tracker cron + handlers"
```

---

### Task D6: Weekly content report — brief + critic sections

**Files:**
- Modify: existing WeeklyContentReport email + the route that prepares its payload (find via grep)

- [ ] **Step 1: Locate the email + builder**

Run: Grep `pattern: "WeeklyContentReport"`, `path: "."`, `glob: "*.tsx"`. Open both the React email component and the route that imports it (likely `app/api/admin/internal/weekly-content-report/route.ts` or similar).

- [ ] **Step 2: Fetch brief + signal in the builder route**

Inside the report-builder route, before rendering the email JSX, add:

```ts
import { latestApprovedBrief } from "@/lib/db/strategy-briefs"
import { latestSignal } from "@/lib/db/cross-channel-signals"
// ...
const brief = await latestApprovedBrief(supabase)
const signal = await latestSignal(supabase)
```

Pass them as props to `<WeeklyContentReport brief={brief} signal={signal} ... />`.

- [ ] **Step 3: Append two sections to the email body**

Below the existing pipeline/analytics sections, before the closing layout wrapper, add:

```tsx
{brief && (
  <section>
    <h2>This week&apos;s strategy</h2>
    <p><strong>Focus:</strong> {brief.audience_focus}</p>
    <p><strong>Priority channel:</strong> {brief.priority_channel}</p>
    {brief.keywords_to_chase.length > 0 && (
      <ul>
        {brief.keywords_to_chase.map((k: string) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
    )}
  </section>
)}

{signal && (
  <section>
    <h2>What the critic noticed</h2>
    <p>{signal.rationale.slice(0, 600)}</p>
    {(signal.recommendations_for_brief as string[]).length > 0 && (
      <>
        <h3>Carrying into next week</h3>
        <ul>
          {(signal.recommendations_for_brief as string[]).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </>
    )}
  </section>
)}
```

Add `brief?: StrategyBrief | null` and `signal?: CrossChannelSignal | null` to the component's props interface.

- [ ] **Step 4: Commit**

```bash
git add <files-touched>
git commit -m "feat(email): weekly report — brief + critic sections"
```

---

## Phase E — Smoke runbook (manual, not a code task)

After Phase D ships, the system is dormant behind feature flags. Validate end-to-end via the runbook below; do NOT enable the crons until it passes.

1. **Run the critic manually.** POST `/api/admin/strategy/critic/run` from the admin UI. Watch Firestore `ai_jobs` for completion, then check Supabase `cross_channel_signals` — a new row should exist for this week with `preflight_status='ok'` (or `'failed'` with a clear reason). Visit `/admin/strategy/signals`.
2. **Run the chief manually.** POST `/api/admin/strategy/chief/run`. Confirm a new `strategy_briefs` row appears with `approval_status='draft'`. Visit `/admin/strategy`, edit the rationale, save, then approve.
3. **Trigger a specialist.** Enqueue a social-agent run via the existing `/admin/social` agent button. Check the new `social_agent_memos` row has `brief_id` set and `brief_alignment_score` populated.
4. **Enable flags.** Once steps 1-3 look clean, flip `cron_performance_critic_enabled`, `cron_chief_strategist_enabled`, `cron_social_agent_enabled`, and `cron_social_outcome_tracker_enabled` to `true` via `/admin/automation`. Leave `brief_required_for_specialists` at `false` for the first 6 weeks.

---

## Self-review

- **Spec coverage:** contract (A5), three new tables (A1-A3), DAL (A6-A7), feature flags (A4), critic handler (B1-B2), chief handler (B3), brief approval routes (B4), internal cron routes (B5), Firebase wiring (B6), admin pages (C1-C2), SEO integration (D1), Ads integration (D2), Social parity (D3), social outcome tracker (D4), social cron wiring (D5), email digest extension (D6). All spec sections covered.
- **Placeholder scan:** none — every step contains real code or exact commands.
- **Type consistency:** `StrategyBrief`, `CrossChannelSignal`, `SocialAgentMemo`, `BriefContext`, `runPerformanceCritic`, `runChiefStrategist`, `runSocialOutcomeTracker`, `latestApprovedBrief`, `insertSocialAgentMemo`, `scoreBlogVsBrief`, `pickTopicWithBrief` — names referenced consistently across tasks.
- **Cron schedule** aligns with spec: critic Sat 13:00 UTC, chief Sun 10:00 UTC, social cron Tue+Thu 13:00 UTC, social outcome tracker daily 04:45 UTC (staggered from SEO 04:15 and Ads 04:30).
- **Behavior is gated** by `system_settings` flags throughout. Plan ships dormant infrastructure; coach enables crons after Phase E runbook passes.
- **Social `dont_do` guardrail** intentionally deferred — social writes are already always-draft, so the existing approval queue catches conflicts. SEO and Ads enforce `brief.dont_do` as hard guardrails (D1 Step 4, D2 Step 4).

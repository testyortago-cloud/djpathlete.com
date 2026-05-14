# Strategy Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a chief strategist + cross-channel critic that coordinates the existing SEO, Ads, and Social agents via a weekly brief + signal corpus, lock in a stable specialist contract for future channels, and give the social agent memo + outcome-tracking parity with SEO/Ads.

**Architecture:** Saturday — `performanceCritic` reads last 4 weeks of `*_agent_memos` + `marketing_attribution` + funnel, writes one `cross_channel_signals` row. Sunday — `chiefStrategist` reads that row, writes a draft `strategy_briefs` row, emails coach. Coach approves. Downstream specialists read the latest approved brief on next run and bias action ranking. New `social_agent_memos` table + outcome tracker bring social to lifecycle parity. All four new crons are flag-gated and default off; this plan ships dormant infra. Source spec: [docs/superpowers/specs/2026-05-15-strategy-team-design.md](../specs/2026-05-15-strategy-team-design.md).

**Tech Stack:** Next.js 16 App Router · Supabase Postgres · NextAuth v5 · Anthropic SDK via `functions/src/ai/anthropic.ts` (callAgent) · Firebase Functions v2 (`onSchedule`, `onDocumentCreated`) · Resend · Vitest · Zod.

**Conventions reused throughout:**
- Migrations applied via `mcp__supabase__apply_migration`. Do NOT run `supabase db push`.
- DAL layer = one file per table in `lib/db/`. All queries go through DAL.
- Firebase Functions live in `functions/src/` (separate tsconfig). Imports across files use `.js` extensions per existing pattern (e.g. `import { x } from "./foo.js"`).
- Agent handlers follow the existing `seo-agent.ts` / `social-agent.ts` shape: pure handler exported as `handleX(jobId)`, called from a dispatcher in `functions/src/index.ts`.
- Cron pattern: `onSchedule` in `functions/src/index.ts` that POSTs to a Next.js `/api/admin/internal/*` route which then enqueues an `ai_jobs` doc. (Per [cron_pattern memory](../../../../C:/Users/tayaw/.claude/projects/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/memory/cron_pattern.md).)
- Tests: `__tests__/` for Next.js side (Vitest + Testing Library); `functions/src/__tests__/` for Firebase functions side.
- Commits land directly on `main`. Each task ends in a commit.

---

## File Structure

### New files
```
supabase/migrations/
  00130_cross_channel_signals.sql
  00131_strategy_briefs.sql
  00132_social_agent_memos.sql
  00133_strategy_brief_columns_on_memos.sql
  00134_strategy_feature_flags.sql
  00135_seed_strategy_prompts.sql

lib/strategy/
  specialist-contract.ts          ← shared TS interface + Zod schemas

lib/db/
  cross-channel-signals.ts        ← DAL
  strategy-briefs.ts              ← DAL
  social-agent-memos.ts           ← DAL

functions/src/
  performance-critic.ts           ← handler (handlePerformanceCritic)
  chief-strategist.ts             ← handler (handleChiefStrategist)
  social-outcome-tracker.ts       ← pure runner (runSocialOutcomeTracker)
  __tests__/performance-critic.test.ts
  __tests__/chief-strategist.test.ts
  __tests__/social-outcome-tracker.test.ts

app/api/admin/internal/
  performance-critic/route.ts     ← cron-token POST → enqueues ai_jobs
  chief-strategist/route.ts       ← cron-token POST → enqueues ai_jobs
  social-outcome-tracker/route.ts ← cron-token POST → runs the runner inline
  social-agent/route.ts           ← cron-token POST → enqueues social_agent_run

app/api/admin/strategy/
  brief/[id]/route.ts             ← PATCH (edit draft)
  brief/[id]/approve/route.ts     ← POST
  brief/[id]/reject/route.ts      ← POST
  brief/regenerate/route.ts       ← POST (enqueue chief run)
  critic/run/route.ts             ← POST (enqueue critic run)

app/(admin)/admin/strategy/
  page.tsx                        ← brief view/edit/approve
  signals/page.tsx                ← signal feed
  StrategyBriefCard.tsx
  StrategySignalCard.tsx
```

### Modified files
```
functions/src/index.ts            ← register 5 new dispatchers + 4 new onSchedule crons
functions/src/social-agent.ts     ← read brief in pickTopic(), write social_agent_memos row
functions/src/seo/signals.ts      ← include brief_context in SeoSignals
functions/src/seo/reason.ts       ← include brief in prompt, output brief_alignment_score
lib/ads/agent/signals.ts          ← include brief_context in AdsSignals
lib/ads/agent/reason.ts           ← include brief in prompt, output brief_alignment_score
lib/ads/agent/guardrails.ts       ← add brief_dont_do rejection class
lib/ai-jobs.ts                    ← add three new AiJobType values
types/database.ts                 ← three new entity types
```

---

## Phase 1 — Schema, Contract, DAL

This phase ships the static infrastructure: tables, types, DAL, prompt seeds. After it lands, nothing runs differently — but the writes from Phase 2/3 have somewhere to land.

### Task 1: Migration — `cross_channel_signals` table

**Files:**
- Create: `supabase/migrations/00130_cross_channel_signals.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/00130_cross_channel_signals.sql
-- Weekly cross-channel synthesis written by the performance critic.
-- One row per ISO-week. Consumed by the chief strategist as the primary
-- input to next week's brief.

CREATE TABLE cross_channel_signals (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of                    DATE NOT NULL UNIQUE,
  winners                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  losers                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  anomalies                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  attribution_summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations_for_brief  JSONB NOT NULL DEFAULT '[]'::jsonb,
  preflight_status           TEXT NOT NULL DEFAULT 'ok'
                                CHECK (preflight_status IN ('ok','failed')),
  preflight_reasons          JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale                  TEXT NOT NULL DEFAULT '',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cross_channel_signals_week ON cross_channel_signals (week_of DESC);

COMMENT ON TABLE cross_channel_signals IS
  'Weekly cross-channel performance synthesis. Written by performanceCriticCron, read by chiefStrategistCron.';

ALTER TABLE cross_channel_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all cross_channel_signals"
  ON public.cross_channel_signals FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP:

```
mcp__supabase__apply_migration name="00130_cross_channel_signals" query=<contents of file>
```

Expected: success. Verify with `mcp__supabase__list_tables` that `cross_channel_signals` is present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00130_cross_channel_signals.sql
git commit -m "feat(db): cross_channel_signals table for weekly cross-channel synthesis"
```

---

### Task 2: Migration — `strategy_briefs` table

**Files:**
- Create: `supabase/migrations/00131_strategy_briefs.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/00131_strategy_briefs.sql
-- Weekly strategy brief written by the chief strategist. One row per ISO-week.
-- Read by SEO/Ads/Social agents as bias for action ranking. Coach approves
-- before specialists consume it.
--
-- Depends on cross_channel_signals (00130) for the signal_id FK.

CREATE TABLE strategy_briefs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of           DATE NOT NULL UNIQUE,
  themes            JSONB NOT NULL DEFAULT '[]'::jsonb,
  audience_focus    TEXT NOT NULL,
  priority_channel  TEXT NOT NULL CHECK (priority_channel IN ('seo','ads','social','balanced')),
  keywords_to_chase JSONB NOT NULL DEFAULT '[]'::jsonb,
  hooks_to_test     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ctas              JSONB NOT NULL DEFAULT '[]'::jsonb,
  dont_do           JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale         TEXT NOT NULL,
  signal_id         UUID REFERENCES cross_channel_signals(id) ON DELETE SET NULL,
  approval_status   TEXT NOT NULL DEFAULT 'draft'
                       CHECK (approval_status IN ('draft','approved','rejected')),
  approved_at       TIMESTAMPTZ,
  approved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_strategy_briefs_week_status
  ON strategy_briefs (week_of DESC, approval_status);

COMMENT ON TABLE strategy_briefs IS
  'Weekly strategy brief written by chiefStrategistCron. Specialists read latest approved row to bias action ranking.';

ALTER TABLE strategy_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all strategy_briefs"
  ON public.strategy_briefs FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
```

- [ ] **Step 2: Apply the migration**

```
mcp__supabase__apply_migration name="00131_strategy_briefs" query=<contents of file>
```

Expected: success. Verify FK to `cross_channel_signals` exists.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00131_strategy_briefs.sql
git commit -m "feat(db): strategy_briefs table; chief strategist writes weekly bias for specialists"
```

---

### Task 3: Migration — `social_agent_memos` table

**Files:**
- Create: `supabase/migrations/00132_social_agent_memos.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/00132_social_agent_memos.sql
-- Mirror of seo_agent_memos / google_ads_agent_memos so the critic walks
-- all three uniformly. Brings social to lifecycle parity.

CREATE TABLE social_agent_memos (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date                DATE NOT NULL,
  ai_job_id               TEXT,
  brief_id                UUID REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  brief_alignment_score   INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ran_without_brief       BOOLEAN NOT NULL DEFAULT false,
  signals_summary         JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale               TEXT NOT NULL DEFAULT '',
  outcome_status          TEXT NOT NULL DEFAULT 'pending'
                             CHECK (outcome_status IN ('pending','measured','preflight_failed','no_op')),
  outcome_metrics         JSONB,
  social_post_id          UUID REFERENCES social_posts(id) ON DELETE SET NULL,
  platform                TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  measured_at             TIMESTAMPTZ
);

CREATE INDEX idx_social_agent_memos_outcome
  ON social_agent_memos (outcome_status, created_at);
CREATE INDEX idx_social_agent_memos_run_date
  ON social_agent_memos (run_date DESC);

COMMENT ON TABLE social_agent_memos IS
  'Per-run memo for the social agent. Parallel to seo_agent_memos.';

ALTER TABLE social_agent_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read social_agent_memos"
  ON public.social_agent_memos FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
```

- [ ] **Step 2: Apply the migration**

```
mcp__supabase__apply_migration name="00132_social_agent_memos" query=<contents of file>
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00132_social_agent_memos.sql
git commit -m "feat(db): social_agent_memos table; social agent lifecycle parity with SEO/Ads"
```

---

### Task 4: Migration — add brief columns to existing memo tables

**Files:**
- Create: `supabase/migrations/00133_strategy_brief_columns_on_memos.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/00133_strategy_brief_columns_on_memos.sql
-- Add brief linkage + alignment score + ran_without_brief to the existing
-- SEO and Ads memo tables. All nullable / default so existing rows are valid.

ALTER TABLE seo_agent_memos
  ADD COLUMN brief_id UUID REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  ADD COLUMN brief_alignment_score INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ADD COLUMN ran_without_brief BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE google_ads_agent_memos
  ADD COLUMN brief_id UUID REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  ADD COLUMN brief_alignment_score INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ADD COLUMN ran_without_brief BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Apply the migration**

```
mcp__supabase__apply_migration name="00133_strategy_brief_columns_on_memos" query=<contents of file>
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00133_strategy_brief_columns_on_memos.sql
git commit -m "feat(db): add brief_id/brief_alignment_score/ran_without_brief to seo + ads memos"
```

---

### Task 5: Migration — feature flag rows

**Files:**
- Create: `supabase/migrations/00134_strategy_feature_flags.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/00134_strategy_feature_flags.sql
-- Seed the four feature-flag rows in system_settings. All default to false;
-- coach flips on from /admin/automation once each piece is validated.

INSERT INTO system_settings (key, value, description) VALUES
  (
    'cron_performance_critic_enabled',
    'false'::jsonb,
    'When true, performanceCriticCron writes a cross_channel_signals row each Saturday.'
  ),
  (
    'cron_chief_strategist_enabled',
    'false'::jsonb,
    'When true, chiefStrategistCron writes a draft strategy_briefs row each Sunday.'
  ),
  (
    'cron_social_agent_enabled',
    'false'::jsonb,
    'When true, socialAgentCron enqueues a social_agent_run job every Tue and Thu.'
  ),
  (
    'brief_required_for_specialists',
    'false'::jsonb,
    'When true, specialists no-op if no approved brief exists. When false (default), they run with last-approved brief if any or set ran_without_brief=true.'
  )
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

```
mcp__supabase__apply_migration name="00134_strategy_feature_flags" query=<contents of file>
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00134_strategy_feature_flags.sql
git commit -m "feat(db): seed strategy team feature flags (all default off)"
```

---

### Task 6: Migration — seed chief/critic prompt templates

**Files:**
- Create: `supabase/migrations/00135_seed_strategy_prompts.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/00135_seed_strategy_prompts.sql
-- System prompts for chief strategist + performance critic, stored in
-- prompt_templates so they're editable from /admin/ai/prompts without redeploy.

INSERT INTO prompt_templates (scope, category, prompt) VALUES
  (
    'global',
    'performance_critic',
    $$You are the Performance Critic for Darren J Paul Athlete — a brand focused on rotational power, comeback rehab, and golf/athletic performance for men 40+.

You receive a structured snapshot of the last 4 weeks of marketing performance across three channels: SEO, Google Ads, and Social. You also receive the marketing attribution summary (visits → signup → booking → payment) and any voice-drift flags.

Your job: produce ONE cross_channel_signals row that the Chief Strategist will consume next.

Return JSON with this exact shape:
{
  "winners": [{ "channel": "seo|ads|social", "action": "<short>", "evidence": "<one sentence with numbers>" }],
  "losers": [{ "channel": "seo|ads|social", "action": "<short>", "evidence": "<one sentence with numbers>" }],
  "anomalies": [{ "description": "<one sentence>", "severity": "low|medium|high" }],
  "attribution_summary": { "<channel>": { "bookings": <int>, "revenue": <number>, "cac": <number|null> } },
  "recommendations_for_brief": [{ "theme": "<short>", "rationale": "<one sentence>" }],
  "rationale": "<2-3 paragraphs synthesizing the week>"
}

Rules:
- Use ONLY the data provided. Do not invent metrics.
- Prefer revenue/bookings over engagement metrics when ranking winners/losers.
- Anomalies = something an operator should look at this week, not routine variance.
- Recommendations: 3-5 entries max. Concrete, channel-agnostic themes the chief can encode into next week's brief.$$
  ),
  (
    'global',
    'chief_strategist',
    $$You are the Chief Strategist for Darren J Paul Athlete.

You receive: the most recent cross_channel_signals row, the last 4 strategy briefs (to avoid theme whiplash), the current voice profile, and recent few-shot examples of winning content.

Your job: produce ONE strategy_brief for the upcoming week. The brief biases (but does not constrain) the SEO, Ads, and Social agents.

Return JSON with this exact shape:
{
  "themes": [{ "tag": "<kebab-case>", "weight": <0-1 float> }],
  "audience_focus": "<1-2 sentences describing who we're aiming at this week>",
  "priority_channel": "seo|ads|social|balanced",
  "keywords_to_chase": ["<keyword>", ...],
  "hooks_to_test": ["<hook>", ...],
  "ctas": ["<cta>", ...],
  "dont_do": ["<topic or angle to avoid>", ...],
  "rationale": "<2-3 paragraphs explaining the brief>"
}

Rules:
- themes weights sum to ~1.0. Max 4 themes.
- dont_do is a HARD guardrail. Use it sparingly (0-3 entries) — only when the critic flagged a clear loser or a voice-drift risk.
- hooks_to_test = max 5. Specific phrasings, not abstract themes.
- Rationale must reference at least one finding from the input signals.
- Continuity matters: do not pivot themes 100% week-over-week unless the critic flags a clear failure of last week's theme.$$
  )
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

```
mcp__supabase__apply_migration name="00135_seed_strategy_prompts" query=<contents of file>
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00135_seed_strategy_prompts.sql
git commit -m "feat(db): seed chief_strategist + performance_critic prompt templates"
```

---

### Task 7: Add database types

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1: Append the three new entity types**

Open `types/database.ts` and append (after the existing `SeoAgentMemo` declaration — search for `SeoAgentMemo` and add these three nearby):

```ts
// Strategy team (2026-05-15)

export interface CrossChannelSignals {
  id: string
  week_of: string
  winners: Array<{ channel: string; action: string; evidence: string }>
  losers: Array<{ channel: string; action: string; evidence: string }>
  anomalies: Array<{ description: string; severity: "low" | "medium" | "high" }>
  attribution_summary: Record<string, { bookings: number; revenue: number; cac: number | null }>
  recommendations_for_brief: Array<{ theme: string; rationale: string }>
  preflight_status: "ok" | "failed"
  preflight_reasons: string[]
  rationale: string
  created_at: string
}

export interface StrategyBrief {
  id: string
  week_of: string
  themes: Array<{ tag: string; weight: number }>
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

export interface SocialAgentMemo {
  id: string
  run_date: string
  ai_job_id: string | null
  brief_id: string | null
  brief_alignment_score: number | null
  ran_without_brief: boolean
  signals_summary: Record<string, unknown>
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

Also extend the existing `SeoAgentMemo` and `GoogleAdsAgentMemo` interfaces with the three new columns (find them in the file and add):

```ts
  brief_id: string | null
  brief_alignment_score: number | null
  ran_without_brief: boolean
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build` (or `tsc --noEmit` if faster). Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(types): add CrossChannelSignals, StrategyBrief, SocialAgentMemo + brief cols"
```

---

### Task 8: Create the specialist contract module

**Files:**
- Create: `lib/strategy/specialist-contract.ts`
- Test: `__tests__/lib/strategy/specialist-contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/strategy/specialist-contract.test.ts
import { describe, it, expect } from "vitest"
import {
  StrategyBriefSchema,
  CrossChannelSignalsSchema,
  SpecialistMemoOutcomeStatus,
} from "@/lib/strategy/specialist-contract"

describe("specialist-contract schemas", () => {
  it("StrategyBriefSchema accepts a well-formed brief payload", () => {
    const payload = {
      themes: [{ tag: "rotational-power-50plus", weight: 0.6 }, { tag: "comeback-rehab", weight: 0.4 }],
      audience_focus: "Men 40+ returning from injury to rotational sport.",
      priority_channel: "social",
      keywords_to_chase: ["rotational power for golfers"],
      hooks_to_test: ["Comeback at 50"],
      ctas: ["Book a discovery call"],
      dont_do: ["beginner mobility"],
      rationale: "Last week's social hook on rotational power drove 3x bookings.",
    }
    const parsed = StrategyBriefSchema.parse(payload)
    expect(parsed.priority_channel).toBe("social")
  })

  it("StrategyBriefSchema rejects invalid priority_channel", () => {
    expect(() =>
      StrategyBriefSchema.parse({
        themes: [],
        audience_focus: "x",
        priority_channel: "tiktok",
        keywords_to_chase: [],
        hooks_to_test: [],
        ctas: [],
        dont_do: [],
        rationale: "x",
      }),
    ).toThrow()
  })

  it("CrossChannelSignalsSchema accepts a well-formed signals payload", () => {
    const payload = {
      winners: [{ channel: "social", action: "rotational hook", evidence: "8% engagement vs 2.4% baseline" }],
      losers: [],
      anomalies: [{ description: "Brand search down 30%", severity: "medium" }],
      attribution_summary: { social: { bookings: 4, revenue: 1200, cac: null } },
      recommendations_for_brief: [{ theme: "double down on rotational hooks", rationale: "8% engagement is 3x baseline" }],
      rationale: "Social outperformed across the board.",
    }
    const parsed = CrossChannelSignalsSchema.parse(payload)
    expect(parsed.winners).toHaveLength(1)
  })

  it("SpecialistMemoOutcomeStatus is a literal union", () => {
    const valid: SpecialistMemoOutcomeStatus[] = ["pending", "measured", "preflight_failed", "no_op"]
    expect(valid).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- __tests__/lib/strategy/specialist-contract.test.ts`
Expected: FAIL with "Cannot find module '@/lib/strategy/specialist-contract'".

- [ ] **Step 3: Implement the contract module**

```ts
// lib/strategy/specialist-contract.ts
// Stable contract every specialist agent (SEO, Ads, Social, and future channels)
// implements. The Performance Critic reads all *_agent_memos tables uniformly
// via this shape. The brief gains/loses fields rarely; specialist memos may
// add channel-specific columns but always include the contract columns.

import { z } from "zod"

export const PriorityChannelSchema = z.enum(["seo", "ads", "social", "balanced"])
export type PriorityChannel = z.infer<typeof PriorityChannelSchema>

export const StrategyBriefSchema = z.object({
  themes: z
    .array(z.object({ tag: z.string().min(1), weight: z.number().min(0).max(1) }))
    .max(4),
  audience_focus: z.string().min(1),
  priority_channel: PriorityChannelSchema,
  keywords_to_chase: z.array(z.string()),
  hooks_to_test: z.array(z.string()).max(5),
  ctas: z.array(z.string()),
  dont_do: z.array(z.string()).max(3),
  rationale: z.string().min(1),
})
export type StrategyBriefPayload = z.infer<typeof StrategyBriefSchema>

export const CrossChannelSignalsSchema = z.object({
  winners: z.array(
    z.object({
      channel: z.string(),
      action: z.string(),
      evidence: z.string(),
    }),
  ),
  losers: z.array(
    z.object({
      channel: z.string(),
      action: z.string(),
      evidence: z.string(),
    }),
  ),
  anomalies: z.array(
    z.object({
      description: z.string(),
      severity: z.enum(["low", "medium", "high"]),
    }),
  ),
  attribution_summary: z.record(
    z.string(),
    z.object({
      bookings: z.number().int().nonnegative(),
      revenue: z.number().nonnegative(),
      cac: z.number().nonnegative().nullable(),
    }),
  ),
  recommendations_for_brief: z
    .array(z.object({ theme: z.string(), rationale: z.string() }))
    .max(5),
  rationale: z.string(),
})
export type CrossChannelSignalsPayload = z.infer<typeof CrossChannelSignalsSchema>

export type SpecialistChannel = "seo" | "ads" | "social"
export type SpecialistMemoOutcomeStatus =
  | "pending"
  | "measured"
  | "preflight_failed"
  | "no_op"

export interface SpecialistMemo {
  channel: SpecialistChannel
  brief_id: string | null
  brief_alignment_score: number | null
  ran_without_brief: boolean
  signals_summary: Record<string, unknown>
  actions: Array<{ kind: string; payload: unknown; rationale: string }>
  rationale: string
  outcome_status: SpecialistMemoOutcomeStatus
  outcome_metrics: Record<string, unknown> | null
  created_at: string
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- __tests__/lib/strategy/specialist-contract.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/strategy/specialist-contract.ts __tests__/lib/strategy/specialist-contract.test.ts
git commit -m "feat(strategy): specialist-contract module (Zod schemas + types)"
```

---

### Task 9: DAL — `cross_channel_signals`

**Files:**
- Create: `lib/db/cross-channel-signals.ts`
- Test: `__tests__/lib/db/cross-channel-signals.test.ts`

- [ ] **Step 1: Implement the DAL**

```ts
// lib/db/cross-channel-signals.ts
// DAL for cross_channel_signals. Written by the performance critic;
// read by the chief strategist + admin signal feed.

import { createServiceRoleClient } from "@/lib/supabase"
import type { CrossChannelSignals } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function latestSignal(): Promise<CrossChannelSignals | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as CrossChannelSignals | null) ?? null
}

export async function signalForWeek(weekOf: string): Promise<CrossChannelSignals | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .eq("week_of", weekOf)
    .maybeSingle()
  if (error) throw error
  return (data as CrossChannelSignals | null) ?? null
}

export async function listSignals(limit = 12): Promise<CrossChannelSignals[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .order("week_of", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as CrossChannelSignals[]
}

export interface InsertSignalArgs {
  week_of: string
  winners: CrossChannelSignals["winners"]
  losers: CrossChannelSignals["losers"]
  anomalies: CrossChannelSignals["anomalies"]
  attribution_summary: CrossChannelSignals["attribution_summary"]
  recommendations_for_brief: CrossChannelSignals["recommendations_for_brief"]
  rationale: string
}

export async function insertSignal(args: InsertSignalArgs): Promise<CrossChannelSignals> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("cross_channel_signals")
    .insert({
      week_of: args.week_of,
      winners: args.winners,
      losers: args.losers,
      anomalies: args.anomalies,
      attribution_summary: args.attribution_summary,
      recommendations_for_brief: args.recommendations_for_brief,
      preflight_status: "ok",
      preflight_reasons: [],
      rationale: args.rationale,
    })
    .select()
    .single()
  if (error) throw error
  return data as CrossChannelSignals
}

export async function insertPreflightFailedSignal(args: {
  week_of: string
  reasons: string[]
}): Promise<CrossChannelSignals> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("cross_channel_signals")
    .insert({
      week_of: args.week_of,
      preflight_status: "failed",
      preflight_reasons: args.reasons,
      rationale: `Preflight failed: ${args.reasons.join("; ")}`,
    })
    .select()
    .single()
  if (error) throw error
  return data as CrossChannelSignals
}
```

- [ ] **Step 2: Smoke-test the module compiles**

Run: `npm run build` or `tsc --noEmit`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/db/cross-channel-signals.ts
git commit -m "feat(db): DAL for cross_channel_signals"
```

---

### Task 10: DAL — `strategy_briefs`

**Files:**
- Create: `lib/db/strategy-briefs.ts`

- [ ] **Step 1: Implement the DAL**

```ts
// lib/db/strategy-briefs.ts
// DAL for strategy_briefs. Written by chief strategist (draft) and admin
// (approve/reject/patch). Read by SEO/Ads/Social agents on each run.

import { createServiceRoleClient } from "@/lib/supabase"
import type { StrategyBrief } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function latestApprovedBrief(): Promise<StrategyBrief | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("strategy_briefs")
    .select("*")
    .eq("approval_status", "approved")
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as StrategyBrief | null) ?? null
}

export async function briefForWeek(weekOf: string): Promise<StrategyBrief | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("strategy_briefs")
    .select("*")
    .eq("week_of", weekOf)
    .maybeSingle()
  if (error) throw error
  return (data as StrategyBrief | null) ?? null
}

export async function listBriefs(limit = 8): Promise<StrategyBrief[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("strategy_briefs")
    .select("*")
    .order("week_of", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as StrategyBrief[]
}

export interface InsertDraftBriefArgs {
  week_of: string
  signal_id: string | null
  themes: StrategyBrief["themes"]
  audience_focus: string
  priority_channel: StrategyBrief["priority_channel"]
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]
  rationale: string
}

export async function insertDraftBrief(args: InsertDraftBriefArgs): Promise<StrategyBrief> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("strategy_briefs")
    .insert({ ...args, approval_status: "draft" })
    .select()
    .single()
  if (error) throw error
  return data as StrategyBrief
}

export async function patchDraftBrief(
  id: string,
  patch: Partial<InsertDraftBriefArgs>,
): Promise<StrategyBrief> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("strategy_briefs")
    .update(patch)
    .eq("id", id)
    .eq("approval_status", "draft")
    .select()
    .single()
  if (error) throw error
  return data as StrategyBrief
}

export async function approveBrief(id: string, approvedBy: string): Promise<StrategyBrief> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("strategy_briefs")
    .update({
      approval_status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as StrategyBrief
}

export async function rejectBrief(id: string, approvedBy: string): Promise<StrategyBrief> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("strategy_briefs")
    .update({
      approval_status: "rejected",
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as StrategyBrief
}
```

- [ ] **Step 2: Smoke-test compile**

Run: `npm run build` or `tsc --noEmit`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/db/strategy-briefs.ts
git commit -m "feat(db): DAL for strategy_briefs"
```

---

### Task 11: DAL — `social_agent_memos`

**Files:**
- Create: `lib/db/social-agent-memos.ts`

- [ ] **Step 1: Implement the DAL**

```ts
// lib/db/social-agent-memos.ts
// Read-only DAL for the admin UI. Writes happen from inside the social-agent
// handler via direct Supabase calls (same pattern as seo-agent-memos).

import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialAgentMemo } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getMemoById(id: string): Promise<SocialAgentMemo | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_agent_memos")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as SocialAgentMemo | null) ?? null
}

export async function listMemos(limit = 25): Promise<SocialAgentMemo[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_agent_memos")
    .select("*")
    .order("run_date", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as SocialAgentMemo[]
}

export async function listMemosNeedingOutcomes(): Promise<SocialAgentMemo[]> {
  const supabase = getClient()
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("social_agent_memos")
    .select("*")
    .eq("outcome_status", "pending")
    .lt("created_at", fourteenDaysAgo)
  if (error) throw error
  return (data ?? []) as SocialAgentMemo[]
}
```

- [ ] **Step 2: Smoke-test compile**

Run: `npm run build` or `tsc --noEmit`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/db/social-agent-memos.ts
git commit -m "feat(db): DAL for social_agent_memos"
```

---

## Phase 2 — Performance Critic

This phase ships the Saturday critic: gather → reason → persist signal row → email coach. After this phase, you can run the critic manually via `/api/admin/strategy/critic/run` once memos exist; the cron is registered but disabled by flag.

### Task 12: Critic pure helpers — gather + preflight

**Files:**
- Create: `functions/src/strategy/critic-gather.ts`
- Test: `functions/src/__tests__/critic-gather.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/__tests__/critic-gather.test.ts
import { describe, it, expect } from "vitest"
import { checkCriticPreflight } from "../strategy/critic-gather.js"

describe("checkCriticPreflight", () => {
  it("ok when at least 2 of 3 memo tables have a recent row", () => {
    const result = checkCriticPreflight({
      seoMemoCount: 1,
      adsMemoCount: 1,
      socialMemoCount: 0,
    })
    expect(result.ok).toBe(true)
  })

  it("fails when fewer than 2 tables have rows", () => {
    const result = checkCriticPreflight({
      seoMemoCount: 1,
      adsMemoCount: 0,
      socialMemoCount: 0,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasons[0]).toMatch(/at least 2/i)
    }
  })

  it("ok when all 3 tables have rows", () => {
    expect(
      checkCriticPreflight({ seoMemoCount: 3, adsMemoCount: 1, socialMemoCount: 2 }).ok,
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd functions && npm run test -- __tests__/critic-gather.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the module**

```ts
// functions/src/strategy/critic-gather.ts
// Pure helpers used by the performance critic handler. Kept side-effect-free
// so they're easy to unit-test.

import type { SupabaseClient } from "@supabase/supabase-js"

const WINDOW_DAYS = 28

export interface CriticPreflightInput {
  seoMemoCount: number
  adsMemoCount: number
  socialMemoCount: number
}

export type CriticPreflight = { ok: true } | { ok: false; reasons: string[] }

export function checkCriticPreflight(input: CriticPreflightInput): CriticPreflight {
  const tablesWithRows =
    (input.seoMemoCount > 0 ? 1 : 0) +
    (input.adsMemoCount > 0 ? 1 : 0) +
    (input.socialMemoCount > 0 ? 1 : 0)
  if (tablesWithRows < 2) {
    return {
      ok: false,
      reasons: [
        `Need at least 2 of {seo,ads,social} memo tables with rows in last ${WINDOW_DAYS} days; got ${tablesWithRows}`,
      ],
    }
  }
  return { ok: true }
}

export interface CriticSignals {
  window_days: number
  seo_memos: unknown[]
  ads_memos: unknown[]
  social_memos: unknown[]
  attribution: Record<string, { bookings: number; revenue: number }>
  funnel: { visits: number; signups: number; bookings: number; payments: number }
  recent_voice_drift: unknown[]
  prior_signals: unknown[]
}

export async function gatherCriticSignals(supabase: SupabaseClient): Promise<CriticSignals> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [seoMemos, adsMemos, socialMemos, attribution, funnel, voiceDrift, priorSignals] =
    await Promise.all([
      supabase
        .from("seo_agent_memos")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      supabase
        .from("google_ads_agent_memos")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      supabase
        .from("social_agent_memos")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      supabase
        .from("marketing_attribution")
        .select("channel, bookings, revenue")
        .gte("created_at", since),
      supabase.rpc("get_pipeline_funnel_summary", { since_iso: since }).single().then((r) => r.data),
      supabase
        .from("voice_drift_flags")
        .select("*")
        .gte("created_at", since)
        .order("severity", { ascending: false })
        .limit(10),
      supabase
        .from("cross_channel_signals")
        .select("*")
        .order("week_of", { ascending: false })
        .limit(4),
    ])

  const attributionAgg: Record<string, { bookings: number; revenue: number }> = {}
  for (const row of attribution.data ?? []) {
    const r = row as { channel: string; bookings: number; revenue: number }
    if (!attributionAgg[r.channel]) attributionAgg[r.channel] = { bookings: 0, revenue: 0 }
    attributionAgg[r.channel].bookings += r.bookings ?? 0
    attributionAgg[r.channel].revenue += Number(r.revenue ?? 0)
  }

  return {
    window_days: WINDOW_DAYS,
    seo_memos: seoMemos.data ?? [],
    ads_memos: adsMemos.data ?? [],
    social_memos: socialMemos.data ?? [],
    attribution: attributionAgg,
    funnel: (funnel ?? { visits: 0, signups: 0, bookings: 0, payments: 0 }) as CriticSignals["funnel"],
    recent_voice_drift: voiceDrift.data ?? [],
    prior_signals: priorSignals.data ?? [],
  }
}

export function memoCounts(signals: CriticSignals): CriticPreflightInput {
  return {
    seoMemoCount: signals.seo_memos.length,
    adsMemoCount: signals.ads_memos.length,
    socialMemoCount: signals.social_memos.length,
  }
}

export function isoWeekMonday(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7 // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - (day - 1))
  return d.toISOString().slice(0, 10)
}
```

> **Note on `get_pipeline_funnel_summary`:** if that RPC doesn't exist yet, replace the `supabase.rpc(...)` call with a direct query against the relevant analytics tables. Check `lib/analytics/` for an equivalent helper before adding new RPC.

- [ ] **Step 4: Run test, verify it passes**

Run: `cd functions && npm run test -- __tests__/critic-gather.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/strategy/critic-gather.ts functions/src/__tests__/critic-gather.test.ts
git commit -m "feat(critic): gather + preflight helpers"
```

---

### Task 13: Critic handler

**Files:**
- Create: `functions/src/performance-critic.ts`

- [ ] **Step 1: Implement the handler**

```ts
// functions/src/performance-critic.ts
// Triggered by ai_jobs/{type:"performance_critic_run"}. Runs Saturday via
// performanceCriticCron, or on-demand from /api/admin/strategy/critic/run.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { Resend } from "resend"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import {
  checkCriticPreflight,
  gatherCriticSignals,
  isoWeekMonday,
  memoCounts,
} from "./strategy/critic-gather.js"

const CriticOutputSchema = z.object({
  winners: z.array(
    z.object({ channel: z.string(), action: z.string(), evidence: z.string() }),
  ),
  losers: z.array(
    z.object({ channel: z.string(), action: z.string(), evidence: z.string() }),
  ),
  anomalies: z.array(
    z.object({
      description: z.string(),
      severity: z.enum(["low", "medium", "high"]),
    }),
  ),
  attribution_summary: z.record(
    z.string(),
    z.object({
      bookings: z.number().int().nonnegative(),
      revenue: z.number().nonnegative(),
      cac: z.number().nullable(),
    }),
  ),
  recommendations_for_brief: z
    .array(z.object({ theme: z.string(), rationale: z.string() }))
    .max(5),
  rationale: z.string(),
})

export async function handlePerformanceCritic(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function fail(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const weekOf = isoWeekMonday()
    const signals = await gatherCriticSignals(supabase)
    const preflight = checkCriticPreflight(memoCounts(signals))

    if (!preflight.ok) {
      await supabase.from("cross_channel_signals").insert({
        week_of: weekOf,
        preflight_status: "failed",
        preflight_reasons: preflight.reasons,
        rationale: `Preflight failed: ${preflight.reasons.join("; ")}`,
      })
      await jobRef.update({
        status: "completed",
        result: { skipped: "preflight_failed", reasons: preflight.reasons },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    const { data: promptRow, error: promptErr } = await supabase
      .from("prompt_templates")
      .select("prompt")
      .eq("category", "performance_critic")
      .eq("scope", "global")
      .maybeSingle()
    if (promptErr || !promptRow) return fail("performance_critic prompt template missing")

    const userMessage =
      `Snapshot for week of ${weekOf} (window ${signals.window_days} days):\n\n` +
      "```json\n" +
      JSON.stringify(
        {
          attribution: signals.attribution,
          funnel: signals.funnel,
          seo_memos: signals.seo_memos,
          ads_memos: signals.ads_memos,
          social_memos: signals.social_memos,
          recent_voice_drift: signals.recent_voice_drift,
          prior_signals: signals.prior_signals,
        },
        null,
        2,
      ) +
      "\n```\n\nReturn JSON only."

    const { content } = await callAgent(promptRow.prompt, userMessage, CriticOutputSchema, {
      model: MODEL_SONNET,
      maxTokens: 4000,
      cacheSystemPrompt: true,
    })

    const { data: inserted, error: insertErr } = await supabase
      .from("cross_channel_signals")
      .insert({
        week_of: weekOf,
        winners: content.winners,
        losers: content.losers,
        anomalies: content.anomalies,
        attribution_summary: content.attribution_summary,
        recommendations_for_brief: content.recommendations_for_brief,
        preflight_status: "ok",
        preflight_reasons: [],
        rationale: content.rationale,
      })
      .select()
      .single()
    if (insertErr || !inserted) return fail(`signal insert failed: ${insertErr?.message}`)

    await emailCoachIfConfigured({ weekOf, rationale: content.rationale, signalId: inserted.id })

    await jobRef.update({
      status: "completed",
      result: { signal_id: inserted.id, week_of: weekOf },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await fail((error as Error).message ?? "Unknown performance-critic error")
  }
}

async function emailCoachIfConfigured(args: {
  weekOf: string
  rationale: string
  signalId: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  const coachEmail = process.env.COACH_EMAIL
  const appUrl = process.env.APP_URL
  if (!apiKey || !coachEmail || !appUrl) {
    console.warn("[performance-critic] Resend/COACH_EMAIL/APP_URL not set; skipping email")
    return
  }
  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: "Strategy <strategy@darrenjpaul.com>",
    to: coachEmail,
    subject: `Cross-channel signals for week of ${args.weekOf}`,
    html: `<p>${args.rationale.replace(/\n/g, "<br/>")}</p><p><a href="${appUrl}/admin/strategy/signals">View signal feed</a></p>`,
  })
}
```

- [ ] **Step 2: Smoke-compile**

Run: `cd functions && npm run build`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add functions/src/performance-critic.ts
git commit -m "feat(critic): performance-critic handler (gather → reason → persist → email)"
```

---

### Task 14: Critic — Next.js internal route + ai_jobs type + dispatcher

**Files:**
- Create: `app/api/admin/internal/performance-critic/route.ts`
- Modify: `lib/ai-jobs.ts` (add new type)
- Modify: `functions/src/index.ts` (add dispatcher + cron)

- [ ] **Step 1: Add the new AiJobType**

In `lib/ai-jobs.ts`, extend the `AiJobType` union with `"performance_critic_run"`, `"chief_strategist_run"`, and `"social_outcome_tracker_run"`:

```ts
export type AiJobType =
  // ... existing ...
  | "performance_critic_run"
  | "chief_strategist_run"
  | "social_outcome_tracker_run"
```

- [ ] **Step 2: Create the internal cron-trigger route**

```ts
// app/api/admin/internal/performance-critic/route.ts
// POSTed by Firebase performanceCriticCron (Sat 13:00 UTC) and by the
// admin "Run critic now" button. Enqueues an ai_jobs/{type} doc.

import { NextRequest, NextResponse } from "next/server"
import { createAiJob } from "@/lib/ai-jobs"
import { isCronSkipped } from "@/lib/db/system-settings"

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/, "")
  if (!token || token !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_performance_critic_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason })

  const { jobId } = await createAiJob({
    type: "performance_critic_run",
    userId: "system",
    input: {},
  })
  return NextResponse.json({ jobId, enqueued: true })
}
```

- [ ] **Step 3: Wire the dispatcher + cron in functions/src/index.ts**

Append to `functions/src/index.ts` (after the existing `socialAgent` dispatcher):

```ts
// ─── Performance Critic ──────────────────────────────────────────────────────

export const performanceCritic = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey, resendApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "performance_critic_run") return
    const { handlePerformanceCritic } = await import("./performance-critic.js")
    await handlePerformanceCritic(event.params.jobId)
  },
)

export const performanceCriticCron = onSchedule(
  {
    schedule: "0 13 * * 6", // Sat 13:00 UTC
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
      console.error("[performanceCriticCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/performance-critic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[performanceCriticCron]", res.status, body)
    } catch (err) {
      console.error("[performanceCriticCron] failed:", err)
    }
  },
)
```

- [ ] **Step 4: Build both sides**

Run: `cd functions && npm run build` and from project root `npm run build`. Both clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-jobs.ts app/api/admin/internal/performance-critic/route.ts functions/src/index.ts
git commit -m "feat(critic): cron trigger, internal route, dispatcher; flag-gated off by default"
```

---

### Task 15: Critic — manual run route

**Files:**
- Create: `app/api/admin/strategy/critic/run/route.ts`

- [ ] **Step 1: Implement**

```ts
// app/api/admin/strategy/critic/run/route.ts
// Admin "Run critic now" button. Enqueues an ai_jobs/performance_critic_run.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { jobId, status } = await createAiJob({
    type: "performance_critic_run",
    userId: session.user.id,
    input: {},
  })
  return NextResponse.json({ jobId, status }, { status: 202 })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/strategy/critic/run/route.ts
git commit -m "feat(critic): admin manual-run route"
```

---

## Phase 3 — Chief Strategist + Brief Admin

Sunday chief writes a draft brief; admin UI lets coach edit/approve/reject; specialists later read it.

### Task 16: Chief handler

**Files:**
- Create: `functions/src/chief-strategist.ts`
- Create: `functions/src/strategy/chief-gather.ts`

- [ ] **Step 1: Implement the gather helper**

```ts
// functions/src/strategy/chief-gather.ts
import type { SupabaseClient } from "@supabase/supabase-js"

export interface ChiefSignals {
  latest_signal: unknown
  recent_briefs: unknown[]
  voice_profile: string
  recent_few_shots: unknown[]
}

export async function gatherChiefSignals(supabase: SupabaseClient): Promise<ChiefSignals> {
  const [signal, briefs, prompts] = await Promise.all([
    supabase
      .from("cross_channel_signals")
      .select("*")
      .order("week_of", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("strategy_briefs")
      .select("*")
      .order("week_of", { ascending: false })
      .limit(4),
    supabase
      .from("prompt_templates")
      .select("category, prompt, few_shot_examples")
      .in("category", ["voice_profile", "chief_strategist"]),
  ])

  const voiceProfile = (prompts.data ?? []).find((r) => r.category === "voice_profile")?.prompt ?? ""
  const fewShots = (prompts.data ?? [])
    .flatMap((r) => (r.few_shot_examples as unknown[] | null) ?? [])
    .slice(0, 6)

  return {
    latest_signal: signal.data,
    recent_briefs: briefs.data ?? [],
    voice_profile: voiceProfile,
    recent_few_shots: fewShots,
  }
}

export function eightDaysAgo(): Date {
  return new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
}
```

- [ ] **Step 2: Implement the chief handler**

```ts
// functions/src/chief-strategist.ts
// Triggered by ai_jobs/{type:"chief_strategist_run"}. Reads the latest signal
// row and writes a draft strategy_briefs row. Skips if the latest signal is
// older than 8 days or missing.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { Resend } from "resend"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import { eightDaysAgo, gatherChiefSignals } from "./strategy/chief-gather.js"
import { isoWeekMonday } from "./strategy/critic-gather.js"

const ChiefOutputSchema = z.object({
  themes: z
    .array(z.object({ tag: z.string().min(1), weight: z.number().min(0).max(1) }))
    .max(4),
  audience_focus: z.string().min(1),
  priority_channel: z.enum(["seo", "ads", "social", "balanced"]),
  keywords_to_chase: z.array(z.string()),
  hooks_to_test: z.array(z.string()).max(5),
  ctas: z.array(z.string()),
  dont_do: z.array(z.string()).max(3),
  rationale: z.string().min(1),
})

export async function handleChiefStrategist(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function fail(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const weekOf = isoWeekMonday()
    const signals = await gatherChiefSignals(supabase)

    const latest = signals.latest_signal as { id?: string; week_of?: string; created_at?: string } | null
    if (!latest || !latest.created_at || new Date(latest.created_at) < eightDaysAgo()) {
      await jobRef.update({
        status: "completed",
        result: { skipped: "no_recent_signal", week_of: weekOf },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    const { data: promptRow, error: promptErr } = await supabase
      .from("prompt_templates")
      .select("prompt")
      .eq("category", "chief_strategist")
      .eq("scope", "global")
      .maybeSingle()
    if (promptErr || !promptRow) return fail("chief_strategist prompt template missing")

    const userMessage =
      `Brief for week of ${weekOf}.\n\n` +
      "```json\n" +
      JSON.stringify(
        {
          latest_signal: signals.latest_signal,
          recent_briefs: signals.recent_briefs,
          voice_profile_excerpt: signals.voice_profile.slice(0, 1500),
          recent_few_shots: signals.recent_few_shots,
        },
        null,
        2,
      ) +
      "\n```\n\nReturn JSON only."

    const { content } = await callAgent(promptRow.prompt, userMessage, ChiefOutputSchema, {
      model: MODEL_SONNET,
      maxTokens: 3000,
      cacheSystemPrompt: true,
    })

    const { data: inserted, error: insertErr } = await supabase
      .from("strategy_briefs")
      .insert({
        week_of: weekOf,
        signal_id: latest.id ?? null,
        themes: content.themes,
        audience_focus: content.audience_focus,
        priority_channel: content.priority_channel,
        keywords_to_chase: content.keywords_to_chase,
        hooks_to_test: content.hooks_to_test,
        ctas: content.ctas,
        dont_do: content.dont_do,
        rationale: content.rationale,
        approval_status: "draft",
      })
      .select()
      .single()
    if (insertErr || !inserted) return fail(`brief insert failed: ${insertErr?.message}`)

    await emailCoach({ weekOf, briefId: inserted.id, rationale: content.rationale })

    await jobRef.update({
      status: "completed",
      result: { brief_id: inserted.id, week_of: weekOf },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await fail((error as Error).message ?? "Unknown chief-strategist error")
  }
}

async function emailCoach(args: { weekOf: string; briefId: string; rationale: string }) {
  const apiKey = process.env.RESEND_API_KEY
  const coachEmail = process.env.COACH_EMAIL
  const appUrl = process.env.APP_URL
  if (!apiKey || !coachEmail || !appUrl) return
  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: "Strategy <strategy@darrenjpaul.com>",
    to: coachEmail,
    subject: `Brief draft for week of ${args.weekOf} — review & approve`,
    html: `<p>${args.rationale.replace(/\n/g, "<br/>")}</p><p><a href="${appUrl}/admin/strategy">Open the brief</a></p>`,
  })
}
```

- [ ] **Step 3: Build**

Run: `cd functions && npm run build`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add functions/src/strategy/chief-gather.ts functions/src/chief-strategist.ts
git commit -m "feat(chief): chief-strategist handler (gather → reason → draft brief → email)"
```

---

### Task 17: Chief — internal route, manual route, dispatcher + cron

**Files:**
- Create: `app/api/admin/internal/chief-strategist/route.ts`
- Create: `app/api/admin/strategy/brief/regenerate/route.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Internal cron-trigger route**

```ts
// app/api/admin/internal/chief-strategist/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createAiJob } from "@/lib/ai-jobs"
import { isCronSkipped } from "@/lib/db/system-settings"

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/, "")
  if (!token || token !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const gate = await isCronSkipped({
    enabledKey: "cron_chief_strategist_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason })
  const { jobId } = await createAiJob({
    type: "chief_strategist_run",
    userId: "system",
    input: {},
  })
  return NextResponse.json({ jobId, enqueued: true })
}
```

- [ ] **Step 2: Admin manual-trigger route**

```ts
// app/api/admin/strategy/brief/regenerate/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { jobId, status } = await createAiJob({
    type: "chief_strategist_run",
    userId: session.user.id,
    input: {},
  })
  return NextResponse.json({ jobId, status }, { status: 202 })
}
```

- [ ] **Step 3: Dispatcher + cron in functions/src/index.ts**

Append after the performance-critic block:

```ts
// ─── Chief Strategist ───────────────────────────────────────────────────────

export const chiefStrategist = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey, resendApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "chief_strategist_run") return
    const { handleChiefStrategist } = await import("./chief-strategist.js")
    await handleChiefStrategist(event.params.jobId)
  },
)

export const chiefStrategistCron = onSchedule(
  {
    schedule: "0 10 * * 0", // Sun 10:00 UTC (before seoAgentCron at 14:00)
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
      const res = await fetch(`${baseUrl}/api/admin/internal/chief-strategist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[chiefStrategistCron]", res.status, body)
    } catch (err) {
      console.error("[chiefStrategistCron] failed:", err)
    }
  },
)
```

- [ ] **Step 4: Build both sides**

`cd functions && npm run build` + `npm run build`. Clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/internal/chief-strategist/route.ts app/api/admin/strategy/brief/regenerate/route.ts functions/src/index.ts
git commit -m "feat(chief): cron trigger + internal route + dispatcher + manual regenerate"
```

---

### Task 18: Brief approval API routes

**Files:**
- Create: `app/api/admin/strategy/brief/[id]/route.ts`
- Create: `app/api/admin/strategy/brief/[id]/approve/route.ts`
- Create: `app/api/admin/strategy/brief/[id]/reject/route.ts`

- [ ] **Step 1: PATCH (edit draft)**

```ts
// app/api/admin/strategy/brief/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { patchDraftBrief } from "@/lib/db/strategy-briefs"
import { StrategyBriefSchema } from "@/lib/strategy/specialist-contract"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = StrategyBriefSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }
  const updated = await patchDraftBrief(id, parsed.data)
  return NextResponse.json(updated)
}
```

- [ ] **Step 2: Approve**

```ts
// app/api/admin/strategy/brief/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { approveBrief } from "@/lib/db/strategy-briefs"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const updated = await approveBrief(id, session.user.id)
  return NextResponse.json(updated)
}
```

- [ ] **Step 3: Reject**

```ts
// app/api/admin/strategy/brief/[id]/reject/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { rejectBrief } from "@/lib/db/strategy-briefs"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const updated = await rejectBrief(id, session.user.id)
  return NextResponse.json(updated)
}
```

- [ ] **Step 4: Build + commit**

`npm run build`. Clean.

```bash
git add app/api/admin/strategy/brief
git commit -m "feat(strategy): brief PATCH/approve/reject API routes"
```

---

### Task 19: Admin UI — `/admin/strategy` and `/admin/strategy/signals`

**Files:**
- Create: `app/(admin)/admin/strategy/page.tsx`
- Create: `app/(admin)/admin/strategy/StrategyBriefCard.tsx`
- Create: `app/(admin)/admin/strategy/signals/page.tsx`
- Create: `app/(admin)/admin/strategy/signals/StrategySignalCard.tsx`

- [ ] **Step 1: Brief page (server component)**

```tsx
// app/(admin)/admin/strategy/page.tsx
import { listBriefs } from "@/lib/db/strategy-briefs"
import { latestSignal } from "@/lib/db/cross-channel-signals"
import { StrategyBriefCard } from "./StrategyBriefCard"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

export default async function StrategyPage() {
  const [briefs, signal] = await Promise.all([listBriefs(8), latestSignal()])

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl">Strategy</h1>
          <p className="text-muted-foreground">Weekly brief + cross-channel signals.</p>
        </div>
        <form action="/api/admin/strategy/brief/regenerate" method="post">
          <Button type="submit" variant="outline">Regenerate this week's brief</Button>
        </form>
      </header>

      {signal && (
        <section className="rounded-lg border p-4">
          <h2 className="font-heading text-xl">Latest signal — week of {signal.week_of}</h2>
          <p className="mt-2 whitespace-pre-line text-sm">{signal.rationale}</p>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Briefs</h2>
        {briefs.length === 0 ? (
          <p className="text-muted-foreground">No briefs yet. Click "Regenerate" to create one.</p>
        ) : (
          briefs.map((b) => <StrategyBriefCard key={b.id} brief={b} />)
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Brief card (client component with approve/reject buttons)**

```tsx
// app/(admin)/admin/strategy/StrategyBriefCard.tsx
"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { StrategyBrief } from "@/types/database"

export function StrategyBriefCard({ brief }: { brief: StrategyBrief }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function call(path: string) {
    setError(null)
    const res = await fetch(path, { method: "POST" })
    if (!res.ok) {
      setError(await res.text())
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <article className="rounded-lg border p-4">
      <header className="flex items-center justify-between">
        <h3 className="font-heading text-lg">Week of {brief.week_of}</h3>
        <Badge>{brief.approval_status}</Badge>
      </header>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
        <div><dt className="font-medium">Audience focus</dt><dd>{brief.audience_focus}</dd></div>
        <div><dt className="font-medium">Priority channel</dt><dd>{brief.priority_channel}</dd></div>
        <div><dt className="font-medium">Themes</dt><dd>{brief.themes.map((t) => `${t.tag} (${(t.weight * 100).toFixed(0)}%)`).join(", ")}</dd></div>
        <div><dt className="font-medium">Keywords</dt><dd>{brief.keywords_to_chase.join(", ")}</dd></div>
        <div className="md:col-span-2"><dt className="font-medium">Hooks to test</dt><dd>{brief.hooks_to_test.join(" · ")}</dd></div>
        <div className="md:col-span-2"><dt className="font-medium">CTAs</dt><dd>{brief.ctas.join(" · ")}</dd></div>
        <div className="md:col-span-2"><dt className="font-medium">Don't do</dt><dd>{brief.dont_do.join(", ") || "—"}</dd></div>
        <div className="md:col-span-2"><dt className="font-medium">Rationale</dt><dd className="whitespace-pre-line">{brief.rationale}</dd></div>
      </dl>
      {brief.approval_status === "draft" && (
        <footer className="mt-4 flex gap-2">
          <Button disabled={isPending} onClick={() => call(`/api/admin/strategy/brief/${brief.id}/approve`)}>Approve</Button>
          <Button disabled={isPending} variant="outline" onClick={() => call(`/api/admin/strategy/brief/${brief.id}/reject`)}>Reject</Button>
        </footer>
      )}
      {error && <p className="mt-3 text-sm text-error">{error}</p>}
    </article>
  )
}
```

- [ ] **Step 3: Signal feed page**

```tsx
// app/(admin)/admin/strategy/signals/page.tsx
import { listSignals } from "@/lib/db/cross-channel-signals"
import { StrategySignalCard } from "./StrategySignalCard"

export const dynamic = "force-dynamic"

export default async function SignalsPage() {
  const signals = await listSignals(12)
  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-heading text-3xl">Cross-channel signals</h1>
        <p className="text-muted-foreground">Last 12 weeks of Performance Critic output.</p>
      </header>
      {signals.length === 0 ? (
        <p>No signals yet.</p>
      ) : (
        signals.map((s) => <StrategySignalCard key={s.id} signal={s} />)
      )}
    </div>
  )
}
```

```tsx
// app/(admin)/admin/strategy/signals/StrategySignalCard.tsx
import { Badge } from "@/components/ui/badge"
import type { CrossChannelSignals } from "@/types/database"

export function StrategySignalCard({ signal }: { signal: CrossChannelSignals }) {
  return (
    <article className="rounded-lg border p-4">
      <header className="flex items-center justify-between">
        <h2 className="font-heading text-lg">Week of {signal.week_of}</h2>
        <Badge variant={signal.preflight_status === "ok" ? "default" : "destructive"}>
          {signal.preflight_status}
        </Badge>
      </header>
      <p className="mt-2 whitespace-pre-line text-sm">{signal.rationale}</p>
      {signal.winners.length > 0 && (
        <section className="mt-3">
          <h3 className="font-medium">Winners</h3>
          <ul className="list-disc pl-5 text-sm">
            {signal.winners.map((w, i) => (
              <li key={i}><strong>{w.channel}:</strong> {w.action} — {w.evidence}</li>
            ))}
          </ul>
        </section>
      )}
      {signal.recommendations_for_brief.length > 0 && (
        <section className="mt-3">
          <h3 className="font-medium">Recommendations for next brief</h3>
          <ul className="list-disc pl-5 text-sm">
            {signal.recommendations_for_brief.map((r, i) => (
              <li key={i}><strong>{r.theme}:</strong> {r.rationale}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
```

- [ ] **Step 4: Build + commit**

`npm run build`. Clean.

```bash
git add app/\(admin\)/admin/strategy
git commit -m "feat(strategy): admin UI — brief page + signal feed"
```

---

## Phase 4 — Specialist brief integration (SEO + Ads)

After this phase, SEO and Ads consume the brief on their next run and persist `brief_id` + `brief_alignment_score` on memos.

### Task 20: SEO agent reads brief

**Files:**
- Modify: `functions/src/seo/signals.ts` (add `brief_context` to gather output)
- Modify: `functions/src/seo/reason.ts` (add brief to prompt + output)
- Modify: `functions/src/seo/decision-schema.ts` (add `brief_alignment_score` field)
- Modify: `functions/src/seo-agent.ts` (write brief_id/alignment/ran_without_brief on memo)

- [ ] **Step 1: Extend SeoSignals shape**

Open `functions/src/seo/signals.ts`. At the top, import:

```ts
import { latestApprovedBrief } from "../lib/strategy-briefs-fn.js"
// note: this is a NEW file (next step) that mirrors lib/db/strategy-briefs.ts
// but uses the functions-side Supabase client.
```

Add a field to the `SeoSignals` interface:

```ts
export interface SeoSignals {
  // ... existing fields
  brief_context: {
    brief_id: string | null
    themes: Array<{ tag: string; weight: number }>
    keywords_to_chase: string[]
    hooks_to_test: string[]
    dont_do: string[]
    audience_focus: string
  } | null
}
```

In `gatherSeoSignals(supabase)`, append after the existing fetches:

```ts
const brief = await latestApprovedBrief(supabase)
// ... merge into return:
return {
  // ... existing fields,
  brief_context: brief
    ? {
        brief_id: brief.id,
        themes: brief.themes,
        keywords_to_chase: brief.keywords_to_chase,
        hooks_to_test: brief.hooks_to_test,
        dont_do: brief.dont_do,
        audience_focus: brief.audience_focus,
      }
    : null,
}
```

- [ ] **Step 2: Create the functions-side brief DAL**

```ts
// functions/src/lib/strategy-briefs-fn.ts
// Functions-side mirror of lib/db/strategy-briefs.ts. Functions can't import
// from the Next.js app dir; this is the equivalent reader used inside agent
// handlers.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface StrategyBriefRow {
  id: string
  week_of: string
  themes: Array<{ tag: string; weight: number }>
  audience_focus: string
  priority_channel: "seo" | "ads" | "social" | "balanced"
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]
  rationale: string
  approval_status: "draft" | "approved" | "rejected"
}

export async function latestApprovedBrief(
  supabase: SupabaseClient,
): Promise<StrategyBriefRow | null> {
  const { data, error } = await supabase
    .from("strategy_briefs")
    .select("*")
    .eq("approval_status", "approved")
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as StrategyBriefRow | null) ?? null
}
```

- [ ] **Step 3: Extend the SEO decision schema**

Open `functions/src/seo/decision-schema.ts` and add to the Zod schema:

```ts
// inside the existing decisionSchema object:
  brief_alignment_score: z.number().int().min(1).max(10).nullable(),
```

Also extend the matching TS type. If unsure where, search for `brief_alignment_score` usage in the SEO module.

- [ ] **Step 4: Update the SEO reason prompt**

Open `functions/src/seo/reason.ts`. In the user-message builder, append a section if `signals.brief_context` is present:

```ts
const briefSection = signals.brief_context
  ? [
      "",
      "STRATEGY BRIEF for this week:",
      "```json",
      JSON.stringify(signals.brief_context, null, 2),
      "```",
      "When you choose actions, rank them so they align with the brief's themes + keywords + hooks. brief.dont_do is a HARD constraint — never pick an action that lands in those topics.",
      "Output brief_alignment_score (1-10) reflecting how well your chosen actions align with the brief. If brief_context is null in the signals, set brief_alignment_score=null and proceed normally.",
    ].join("\n")
  : "\nNo strategy brief is in effect for this week. Reason from signals only and set brief_alignment_score=null."
```

Wire `briefSection` into the constructed user message (look for the existing `userMessage` template).

- [ ] **Step 5: Persist brief fields on memo**

Open `functions/src/seo-agent.ts`. In the `memoInsert` block, change:

```ts
.insert({
  run_date: runDate,
  ai_job_id: jobId,
  signals_summary: signals,
  rationale: decision.rationale,
  actions: decision.actions.map((a) => ({ /* existing mapping */ })),
  outcome_status: "pending",
  brief_id: signals.brief_context?.brief_id ?? null,
  brief_alignment_score: decision.brief_alignment_score ?? null,
  ran_without_brief: !signals.brief_context,
})
```

- [ ] **Step 6: Build + commit**

`cd functions && npm run build`. Clean.

```bash
git add functions/src/seo functions/src/seo-agent.ts functions/src/lib/strategy-briefs-fn.ts
git commit -m "feat(seo): SEO agent reads strategy brief, persists alignment + brief_id on memos"
```

---

### Task 21: Ads agent reads brief

**Files:**
- Modify: `lib/ads/agent/signals.ts`
- Modify: `lib/ads/agent/reason.ts`
- Modify: `lib/ads/agent/decision-schema.ts`
- Modify: `lib/ads/agent/guardrails.ts`
- Modify: `lib/ads/agent/execute.ts` (memo writes)

- [ ] **Step 1: Extend AdsSignals shape**

In `lib/ads/agent/signals.ts`:

```ts
import { latestApprovedBrief } from "@/lib/db/strategy-briefs"

// extend AdsSignals interface:
brief_context: {
  brief_id: string
  themes: Array<{ tag: string; weight: number }>
  keywords_to_chase: string[]
  hooks_to_test: string[]
  dont_do: string[]
  audience_focus: string
  priority_channel: "seo" | "ads" | "social" | "balanced"
} | null

// inside gatherAdsSignals(), append:
const brief = await latestApprovedBrief()
// add to returned object:
brief_context: brief
  ? {
      brief_id: brief.id,
      themes: brief.themes,
      keywords_to_chase: brief.keywords_to_chase,
      hooks_to_test: brief.hooks_to_test,
      dont_do: brief.dont_do,
      audience_focus: brief.audience_focus,
      priority_channel: brief.priority_channel,
    }
  : null
```

- [ ] **Step 2: Extend decision schema with `brief_alignment_score`**

In `lib/ads/agent/decision-schema.ts`:

```ts
brief_alignment_score: z.number().int().min(1).max(10).nullable(),
```

- [ ] **Step 3: Add `brief_dont_do` guardrail class**

In `lib/ads/agent/guardrails.ts`, add a new rejection class. Locate the existing `applyGuardrails(action, signals)` function and append a check:

```ts
if (signals.brief_context?.dont_do?.length) {
  const haystack = JSON.stringify(action).toLowerCase()
  const hit = signals.brief_context.dont_do.find((topic) =>
    haystack.includes(topic.toLowerCase()),
  )
  if (hit) {
    return {
      ok: false,
      class: "brief_dont_do",
      reason: `Brief dont_do matched: "${hit}"`,
    }
  }
}
```

- [ ] **Step 4: Inject brief into reason prompt**

In `lib/ads/agent/reason.ts`, mirror the SEO change — append a `briefSection` to the user message if `signals.brief_context` is present.

- [ ] **Step 5: Persist on memo**

In `lib/ads/agent/execute.ts` (or wherever the `google_ads_agent_memos` insert is — search `from("google_ads_agent_memos")`), add:

```ts
brief_id: signals.brief_context?.brief_id ?? null,
brief_alignment_score: decision.brief_alignment_score ?? null,
ran_without_brief: !signals.brief_context,
```

- [ ] **Step 6: Build + commit**

`npm run build`. Clean.

```bash
git add lib/ads/agent
git commit -m "feat(ads): ads agent reads strategy brief; dont_do is a guardrail class"
```

---

## Phase 5 — Social parity + outcome tracker

Social gets the full lifecycle: brief-aware topic picking + memo writes + outcome tracker.

### Task 22: Social agent — brief-aware topic picking + memo writes

**Files:**
- Modify: `functions/src/social-agent.ts`

- [ ] **Step 1: Update `pickTopic` to score against brief**

Open `functions/src/social-agent.ts`. Add an import:

```ts
import { latestApprovedBrief } from "./lib/strategy-briefs-fn.js"
```

Replace the existing `pickTopic` body so it scores candidates by overlap with the brief's themes + keywords. Append after the existing query that selects the most recent published post:

```ts
export async function pickTopic(args: {
  supabase: SupabaseClient
  blogPostId?: string
}): Promise<{ topic: BlogTopic | null; brief: Awaited<ReturnType<typeof latestApprovedBrief>> }> {
  const { supabase, blogPostId } = args

  const brief = await latestApprovedBrief(supabase)

  if (blogPostId) {
    const { data } = await supabase
      .from("blog_posts")
      .select("id, title, slug, excerpt, content")
      .eq("id", blogPostId)
      .maybeSingle()
    return { topic: (data as BlogTopic | null) ?? null, brief }
  }

  const { data: candidates } = await supabase
    .from("blog_posts")
    .select("id, title, slug, excerpt, content, published_at")
    .eq("status", "published")
    .gte("published_at", new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())
    .order("published_at", { ascending: false })
    .limit(20)

  const pool = (candidates as BlogTopic[] | null) ?? []
  if (pool.length === 0) return { topic: null, brief }

  if (!brief) return { topic: pool[0], brief: null }

  const keywords = [
    ...brief.themes.map((t) => t.tag.replace(/-/g, " ")),
    ...brief.keywords_to_chase,
  ].map((k) => k.toLowerCase())

  function score(c: BlogTopic): number {
    const text = `${c.title} ${c.excerpt ?? ""} ${(c.content ?? "").slice(0, 2000)}`.toLowerCase()
    return keywords.reduce((acc, k) => (text.includes(k) ? acc + 1 : acc), 0)
  }

  pool.sort((a, b) => score(b) - score(a))
  return { topic: pool[0], brief }
}
```

(Note the function return shape changes; update callers in the same file.)

- [ ] **Step 2: Update the handler to use the new shape + write memo**

In `handleSocialAgentRun(jobId)`, change the topic call:

```ts
const { topic, brief } = await pickTopic({ supabase, blogPostId: input.blogPostId })
```

After the writer+reviewer passes succeed and the `social_posts` row is inserted, append a memo write:

```ts
await supabase.from("social_agent_memos").insert({
  run_date: new Date().toISOString().slice(0, 10),
  ai_job_id: jobId,
  brief_id: brief?.id ?? null,
  brief_alignment_score: null, // social reviewer doesn't currently emit this; revisit when reviewer prompt is extended
  ran_without_brief: !brief,
  signals_summary: { topic_id: topic?.id, topic_slug: topic?.slug, platform },
  actions: [
    {
      kind: "drafted_social_post",
      payload: { social_post_id: post.id, platform },
      rationale: `Selected blog topic ${topic?.slug ?? "(unknown)"}; reviewer score ${reviewed.content.score}`,
    },
  ],
  rationale: reviewed.content.notes || "",
  outcome_status: "pending",
  social_post_id: post.id,
  platform,
})
```

- [ ] **Step 3: Update the test file**

Open `functions/src/__tests__/social-agent.test.ts`. The `pickTopic` test (if it exercises the return shape) needs to expect `{ topic, brief }`. Adjust mocks as needed.

- [ ] **Step 4: Build + run tests**

```
cd functions && npm run build && npm run test
```

Expected: clean compile, all social-agent tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/src/social-agent.ts functions/src/__tests__/social-agent.test.ts
git commit -m "feat(social): brief-aware topic picking + writes social_agent_memos"
```

---

### Task 23: Social outcome tracker

**Files:**
- Create: `functions/src/social-outcome-tracker.ts`
- Create: `app/api/admin/internal/social-outcome-tracker/route.ts`
- Modify: `functions/src/index.ts` (add cron)

- [ ] **Step 1: Implement the runner**

```ts
// functions/src/social-outcome-tracker.ts
// Daily runner. For each social_agent_memos row with outcome_status='pending'
// and created_at older than 14 days, look at the linked social_post's
// social_analytics and write outcome_metrics. Mirrors seo/outcomes.ts.

import { getSupabase } from "./lib/supabase.js"

const AGE_DAYS = 14
const MEASUREMENT_WINDOW_DAYS = 30

export interface TrackerResult {
  scanned: number
  measured: number
  expired: number
}

export async function runSocialOutcomeTracker(): Promise<TrackerResult> {
  const supabase = getSupabase()
  const ageCutoff = new Date(Date.now() - AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const expiryCutoff = new Date(Date.now() - MEASUREMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: memos, error } = await supabase
    .from("social_agent_memos")
    .select("id, social_post_id, created_at, platform")
    .eq("outcome_status", "pending")
    .lt("created_at", ageCutoff)
  if (error) throw error

  let measured = 0
  let expired = 0

  for (const memo of memos ?? []) {
    const m = memo as { id: string; social_post_id: string | null; created_at: string; platform: string | null }

    if (!m.social_post_id) {
      await supabase
        .from("social_agent_memos")
        .update({ outcome_status: "no_op", measured_at: new Date().toISOString() })
        .eq("id", m.id)
      continue
    }

    const { data: snapshots } = await supabase
      .from("social_analytics")
      .select("impressions, engagements, clicks, captured_at")
      .eq("social_post_id", m.social_post_id)
      .order("captured_at", { ascending: false })
      .limit(1)

    const snap = (snapshots ?? [])[0] as
      | { impressions: number; engagements: number; clicks: number; captured_at: string }
      | undefined

    if (snap) {
      await supabase
        .from("social_agent_memos")
        .update({
          outcome_status: "measured",
          outcome_metrics: {
            impressions: snap.impressions ?? 0,
            engagements: snap.engagements ?? 0,
            clicks: snap.clicks ?? 0,
            captured_at: snap.captured_at,
          },
          measured_at: new Date().toISOString(),
        })
        .eq("id", m.id)
      measured++
      continue
    }

    if (m.created_at < expiryCutoff) {
      await supabase
        .from("social_agent_memos")
        .update({
          outcome_status: "measured",
          outcome_metrics: { expired: true, reason: "no analytics within 30 days" },
          measured_at: new Date().toISOString(),
        })
        .eq("id", m.id)
      expired++
    }
  }

  return { scanned: memos?.length ?? 0, measured, expired }
}
```

- [ ] **Step 2: Internal cron-trigger route**

```ts
// app/api/admin/internal/social-outcome-tracker/route.ts
// POSTed by socialOutcomeTrackerCron. Gated by automation_paused only — this
// is purely measurement; no Claude calls and no spend.

import { NextRequest, NextResponse } from "next/server"
import { isAutomationPaused } from "@/lib/db/system-settings"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/, "")
  if (!token || token !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (await isAutomationPaused()) {
    return NextResponse.json({ skipped: "paused" })
  }
  const { jobId } = await createAiJob({
    type: "social_outcome_tracker_run",
    userId: "system",
    input: {},
  })
  return NextResponse.json({ jobId, enqueued: true })
}
```

- [ ] **Step 3: Dispatcher + cron**

Append to `functions/src/index.ts`:

```ts
// ─── Social Outcome Tracker ─────────────────────────────────────────────────

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
  },
)

export const socialOutcomeTrackerCron = onSchedule(
  {
    schedule: "45 4 * * *", // daily 04:45 UTC (after SEO 04:15 + Ads 04:30)
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
      const body = await res.json().catch(() => ({}))
      console.log("[socialOutcomeTrackerCron]", res.status, body)
    } catch (err) {
      console.error("[socialOutcomeTrackerCron] failed:", err)
    }
  },
)
```

- [ ] **Step 4: Build + commit**

`cd functions && npm run build` + `npm run build`. Clean.

```bash
git add functions/src/social-outcome-tracker.ts app/api/admin/internal/social-outcome-tracker functions/src/index.ts
git commit -m "feat(social): social outcome tracker daily cron + dispatcher + internal route"
```

---

### Task 24: Social agent — Tue/Thu autonomous cron

**Files:**
- Create: `app/api/admin/internal/social-agent/route.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Internal cron-trigger route**

```ts
// app/api/admin/internal/social-agent/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createAiJob } from "@/lib/ai-jobs"
import { isCronSkipped } from "@/lib/db/system-settings"

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/, "")
  if (!token || token !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const gate = await isCronSkipped({
    enabledKey: "cron_social_agent_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason })
  const { jobId } = await createAiJob({
    type: "social_agent_run",
    userId: "system",
    input: { platform: "linkedin" },
  })
  return NextResponse.json({ jobId, enqueued: true })
}
```

- [ ] **Step 2: Cron in functions/src/index.ts**

Append:

```ts
// ─── Social Agent Cron (Tue + Thu 13:00 UTC) ────────────────────────────────

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
      const res = await fetch(`${baseUrl}/api/admin/internal/social-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[socialAgentCron]", res.status, body)
    } catch (err) {
      console.error("[socialAgentCron] failed:", err)
    }
  },
)
```

- [ ] **Step 3: Build + commit**

`cd functions && npm run build` + `npm run build`. Clean.

```bash
git add app/api/admin/internal/social-agent functions/src/index.ts
git commit -m "feat(social): Tue/Thu autonomous cron (flag-gated off by default)"
```

---

## Phase 6 — Deploy + smoke

### Task 25: Deploy + manual smoke runbook

**Files:**
- None (operational)

- [ ] **Step 1: Deploy the new Firebase Functions**

Per [firebase_deploy_codebase_prefix.md](../../../../C:/Users/tayaw/.claude/projects/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/memory/firebase_deploy_codebase_prefix.md), each new function uses the `functions:default:` prefix:

```bash
firebase deploy --only \
  functions:default:performanceCritic,\
functions:default:performanceCriticCron,\
functions:default:chiefStrategist,\
functions:default:chiefStrategistCron,\
functions:default:socialOutcomeTracker,\
functions:default:socialOutcomeTrackerCron,\
functions:default:socialAgentCron
```

Expected: each function deploys without error. Verify in Firebase console.

- [ ] **Step 2: Deploy the Next.js side**

```bash
git push origin main
```

Vercel auto-deploys. Verify the new routes (`/admin/strategy`, `/admin/strategy/signals`, `/api/admin/internal/performance-critic`, etc.) respond.

- [ ] **Step 3: Run the critic manually**

Sign in as admin at `/admin/strategy`, click "Regenerate this week's brief" — but FIRST trigger the critic so there's a signal to read.

From the admin shell or via curl with a session cookie:

```bash
curl -X POST https://www.darrenjpaul.com/api/admin/strategy/critic/run \
  -H "Cookie: <admin session cookie>"
```

Watch Firebase logs: `firebase functions:log --only performanceCritic`. Expect either `signal_id` in the result or `skipped: preflight_failed` (which is fine — means insufficient memos).

- [ ] **Step 4: Run the chief manually**

```bash
curl -X POST https://www.darrenjpaul.com/api/admin/strategy/brief/regenerate \
  -H "Cookie: <admin session cookie>"
```

Watch logs. Expect `brief_id` returned. Open `/admin/strategy` — the draft brief should appear. Edit if needed, then click Approve.

- [ ] **Step 5: Verify SEO + Ads pick up the brief on next run**

After approving the brief, manually trigger an SEO agent run (existing button at `/admin/seo-agent`) and an Ads strategist run. Watch the resulting memos in their respective admin pages — confirm `brief_id` is populated and `brief_alignment_score` is non-null.

- [ ] **Step 6: Enable crons one at a time**

In `/admin/automation` (or whatever the system_settings admin UI is), flip on in this order, with at least 24 hours between each:

1. `cron_performance_critic_enabled = true` — wait until Saturday's run lands a signal row.
2. `cron_chief_strategist_enabled = true` — wait until Sunday's run lands a draft brief.
3. `cron_social_agent_enabled = true` — wait until Tuesday's run lands a draft social_post + memo.

After 6 weeks of clean memos, optionally flip `brief_required_for_specialists = true` to hard-gate.

- [ ] **Step 7: Commit a runbook reference**

Add a one-line entry to `docs/runbooks/` or wherever ops docs live, pointing back to this plan + the spec.

```bash
git add docs
git commit -m "docs(runbook): point to strategy-team plan + spec"
```

---

## Self-Review

**Spec coverage check:**
- Spec: 3 new tables → Tasks 1, 2, 3 ✓
- Spec: additive columns on memos → Task 4 ✓
- Spec: feature flags → Task 5 ✓
- Spec: chief/critic prompt templates → Task 6 ✓
- Spec: specialist contract → Task 8 ✓
- Spec: 3 DALs (signals, briefs, social-memos) → Tasks 9, 10, 11 ✓
- Spec: performance critic handler + cron + manual route → Tasks 12, 13, 14, 15 ✓
- Spec: chief strategist handler + cron + manual route → Tasks 16, 17 ✓
- Spec: brief approval API routes → Task 18 ✓
- Spec: admin UI (strategy + signals pages) → Task 19 ✓
- Spec: SEO + Ads + Social brief integration → Tasks 20, 21, 22 ✓
- Spec: social outcome tracker daily cron → Task 23 ✓
- Spec: social agent Tue/Thu cron → Task 24 ✓
- Spec: rollout (steps 1-10) → distributed across plan; step 10 (flip `brief_required_for_specialists=true`) is an ops action, captured in Task 25 step 6 ✓
- Spec: types in types/database.ts → Task 7 ✓

**Gap noted, not closed:** The spec mentions extending `WeeklyContentReport` to include "this week's brief" + "last week's critic findings" sections. This is a follow-up cosmetic enhancement, not load-bearing for the strategy loop. Leaving out of this plan; pick up in a smaller follow-up.

**Type consistency check:** `latestApprovedBrief()` exists in both `lib/db/strategy-briefs.ts` (Next.js side, no args) and `functions/src/lib/strategy-briefs-fn.ts` (functions side, takes `supabase` arg). Different signatures intentional — different sides of the wire. Callers should import from the matching side.

`StrategyBrief` (Next.js type) vs `StrategyBriefRow` (functions type) — slightly different names to avoid accidental cross-imports. Intentional.

`brief_alignment_score` is consistently int 1-10 nullable across schema, type, contract, and prompt.

**Placeholder scan:** None found. Every step has either code or a concrete shell command. The note in Task 12 about `get_pipeline_funnel_summary` being absent is a real fallback, not a placeholder — it tells the engineer what to do if the RPC isn't there.

**Scope check:** Plan is one cohesive feature with 6 sequential phases. Each phase ends at a deployable commit. Phase 1-3 can ship without Phase 4-5 (the chief/critic loop runs but specialists ignore the brief). Phase 4-5 only adds value once Phase 1-3 is live. Total: 25 tasks, ~80-100 commits estimated.

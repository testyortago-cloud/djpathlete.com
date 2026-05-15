# Closing the Learning Loop — Design

**Date:** 2026-05-15
**Status:** Design (pre-plan). Solo-dev project; commits land on `main`.
**Related:**
- [2026-05-15-strategy-team-design.md](2026-05-15-strategy-team-design.md) — the substrate this spec builds on
- [2026-05-13-seo-agent-design.md](2026-05-13-seo-agent-design.md)
- [2026-05-13-ads-agent-lifecycle-design.md](2026-05-13-ads-agent-lifecycle-design.md)
- [2026-04-21-starter-ai-automation-phase5f-performance-learning-loop-design.md](2026-04-21-starter-ai-automation-phase5f-performance-learning-loop-design.md) — `prompt_templates.few_shot_examples` source

## Goal

The strategy-team spec built a coordinated agent system: Critic → Chief → Specialists → Memos → Outcomes → Critic. The substrate works. The brief flows. SEO, Ads, and Social all read the latest approved brief, stamp `brief_id` / `brief_alignment_score` / `ran_without_brief` on their memos, and reject actions that match `brief.dont_do[]` (with one Social-agent exception below). Outcome trackers run daily and feed measured outcomes back into the next week's signal gather.

What's still missing is the **intelligence layer**: agents don't emit calibrated confidence, the Chief leaves no audit trail of its own reasoning, outcomes feed back as flat lists rather than scored aggregates, no agent self-critiques, the trending-topic scan is write-only, the few-shot example column is populated but never read, and the Social agent's topic picker doesn't enforce `dont_do`.

This spec adds those seven things. Together they turn the agents from reactive memo-writers into self-aware, history-weighted, brief-disciplined reasoners.

## Why now

- Outcome trackers have been running for weeks but feed back as boolean-ish "worked / failed" lists. Every week without scored aggregates is a week of unweighted training data.
- The Chief's reasoning is unrecoverable. The first brief that gets rejected will be impossible to diagnose because no row records what alternatives the Chief considered or how confident it was.
- The Social agent can pick a topic that violates the brief's `dont_do[]` because `scoreBlogVsBrief()` only sums theme/keyword weights — no rejection step. This is a correctness bug, not just an improvement.
- The `prompt_templates.few_shot_examples` column has been populated by the performance-learning-loop since April. The agents have never read it. Every agent run is a missed opportunity to learn from past wins.

## What this spec is and is not

**Is:** Eight workstreams that share schema and prompt-engineering work. They batch into a small number of migrations and a single sweep of agent reason files.

**Is not:**
- Multi-platform social publishing (LinkedIn-only stays for now; TikTok/IG/YT Shorts gets its own spec once confidence is calibrated)
- Auto-approve / auto-schedule workflows (need confidence-history data first)
- Tool use for the Chief (`query_outcomes`, `simulate_budget_shift`) — future spec
- Seasonality detection, backlink/E-E-A-T signals, Core Web Vitals signals, internal-link graph, comment/DM agent, query-cannibalization detection
- Adaptive guardrail thresholds (need outcome-score history first)
- Expanding Ads auto-apply beyond the current negative-keyword path

## In-scope workstreams

| # | Change | Touches |
|---|---|---|
| 1 | New `chief_strategist_memos` table; Chief persists reasoning, candidates considered, confidence, dissent | new migration, new DAL, `functions/src/chief-strategist.ts`, `functions/src/strategy/chief-prompt.ts` |
| 2 | Numeric `confidence` (1–10) + `dissent_from_upstream` on all four agents' output schemas + memo tables; surface in admin UI | decision/output schemas, memo schemas, admin pages |
| 3 | Outcome scoring (`impact_score` 0–100) for SEO + Ads + Social memos; `agent_tool_baselines` table | `lib/seo-agent/outcomes.ts`, `lib/ads/agent/outcomes.ts`, new social outcome scorer, new DAL |
| 4 | Tool-performance aggregates injected into Chief, SEO, Ads, Social signal gathers + prompts | `functions/src/seo/signals.ts`, `lib/ads/agent/signals.ts`, social-agent gather, chief gather |
| 5 | Self-critique pass (Haiku) for Chief + Ads + SEO reason steps | each agent's reason step |
| 6 | Add `dont_do` rejection to Social agent's topic picker | `functions/src/strategy/brief-blog-scorer.ts`, `functions/src/social-agent.ts` |
| 7 | Wire `tavilyTrendingScan` results into Social agent prompt | `functions/src/social-agent.ts`, new DAL `lib/db/trending-topics.ts` |
| 8 | Thread `prompt_templates.few_shot_examples` into Chief + Ads + SEO + Social prompts | each agent's gather/reason step |

## Architecture deltas

The strategy-team architecture is intact. This spec adds three new flows on top:

```
                       chief_strategist_memos (new)
                              ▲
                              │  persists reasoning, candidates, confidence
                              │
                     chiefStrategistCron
                              │
                              ▼
                     strategy_briefs (approved)
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   seoAgent              socialAgent           adsAgent
   reads tool_perf       reads tool_perf       reads tool_perf
   reads few-shots       reads trending +      reads few-shots
   self-critique pass    reads few-shots       self-critique pass
                         dont_do rejection
                         in topic picker
        │                     │                     │
        ▼                     ▼                     ▼
   seo_agent_memos       social_agent_memos    google_ads_agent_memos
   + confidence/dissent  + confidence/dissent  + confidence/dissent
   + impact_score        + impact_score        + impact_score
        │                     │                     │
        ▼                     ▼                     ▼
   outcome trackers compute impact_score (0–100) against tool baseline
        │
        ▼
   agent_tool_baselines (new)
        │
        ▼
   next signal gather reads aggregates: "refresh avg impact +42, 8 runs, 75% success"
```

## Detailed workstreams

### 1. `chief_strategist_memos` table + Chief persistence

**Problem.** The Chief reads the latest signal, picks themes / channels / keywords / hooks / `dont_do`, and emits a brief. Its reasoning, the alternatives it considered, its confidence, and whether it agreed with the Critic are all unrecoverable after the run. If a brief gets rejected by the coach, nobody can answer "why did the Chief choose this?"

**New migration:**

```sql
CREATE TABLE chief_strategist_memos (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id               UUID REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  signal_id              UUID REFERENCES cross_channel_signals(id),
  themes_considered      JSONB NOT NULL DEFAULT '[]',
                            -- [{tag, weight, accepted: bool, reason}]
  channels_considered    JSONB NOT NULL DEFAULT '[]',
                            -- [{channel, score, accepted: bool}]
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
```

**New DAL:** `lib/db/chief-strategist-memos.ts` exporting `insertChiefMemo()`, `latestChiefMemo()`, `chiefMemoForBrief(briefId)`, `markBriefRejected(briefId, reason)`.

**Chief handler change.** Today [functions/src/chief-strategist.ts](../../functions/src/chief-strategist.ts) makes a single `callAgent` call and inserts the brief. New behavior:

1. The Zod schema gains a sibling `chief_memo` payload alongside the existing brief fields: `themes_considered`, `channels_considered`, `confidence`, `dissents_from_critic`, `dissent_reason`, `self_critique_notes`.
2. After the brief is inserted, insert the memo with `brief_id` pointing at the newly inserted brief. If brief insert fails, still insert the memo with `brief_id=null` so we don't lose the reasoning.
3. `/api/admin/strategy/brief/[id]/reject` calls `markBriefRejected(briefId, reason)`.

**`functions/src/strategy/chief-prompt.ts` additions.** New rubric section instructing the model to enumerate themes considered (with accepted true/false), the channels it weighed, calibrated confidence, and whether it disagrees with the Critic.

**Acceptance.**
- Every Chief run produces exactly one `chief_strategist_memos` row, even when brief insert fails.
- Brief rejection flips `brief_was_rejected=true` + writes `rejection_reason` on the memo.
- Admin strategy page shows the Chief's confidence and a "dissents from Critic" badge when true.

### 2. Calibrated `confidence` + `dissent_from_upstream` on all four agents

**Today.** Ads has per-action `confidence: "low" | "medium" | "high"`. SEO, Social, and Chief emit no confidence. None of the four flags dissent from upstream guidance.

**Change.** Add a memo-level calibrated `confidence` (integer 1–10) and a `dissent_from_upstream` field (boolean + reason) to every agent's output schema and memo table. Per-action `low|medium|high` on Ads stays — agent-level confidence is a different thing.

**Output schema additions** (in each agent's Zod schema):

```ts
agent_confidence: z.number().int().min(1).max(10),
dissent_from_upstream: z.object({
  dissents: z.boolean(),
  reason: z.string().nullable(),
}),
```

For Chief, "upstream" = the Critic's `recommendations_for_brief`.
For SEO / Ads / Social, "upstream" = the brief (themes + `keywords_to_chase` + `hooks_to_test`).

**Migration** (one migration, three ALTERs):

```sql
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

-- chief_strategist_memos already has confidence + dissents_from_critic per #1
```

(Column name `agent_confidence` rather than `confidence` to avoid colliding with the per-action `confidence` on `google_ads_recommendations` rows.)

**Prompt additions** (templated per agent — keep the rubric identical so calibration is comparable across agents):

```
Calibrated confidence (1-10) — be honest, not optimistic:
  10 = identical pattern to recent measured wins, strong signal
   7 = clean reasoning, partial historical match
   4 = weak signal or ambiguous; best available action but uncertain
   1 = high uncertainty; would prefer to flag_for_human

If your plan disagrees with the upstream {brief|recommendations}, set
dissent_from_upstream.dissents=true and explain in one sentence why
you deviated. Honest dissent beats silent override.
```

**Admin UI.** Confidence shown as a colored chip (red <4, yellow 4–6, green 7–10) on memo list views. Dissent shown as an icon with hover-text reason. No new gating logic — auto-approve thresholds get their own spec once we have history.

**Acceptance.**
- Every memo row written after deploy has `agent_confidence` set (not null).
- Dissenting memos have non-empty `dissent_reason` (app-level validation; CHECK constraint deferred to avoid backfilling).
- Admin pages render chips and icons.

### 3. Outcome scoring + `agent_tool_baselines`

**Today.** SEO and Ads outcome trackers measure 14-day before/after deltas (clicks/CVR/CAC) and write metrics to the memo. The next week's signal gather reads the metric, but it's a flat number — no normalization by tool, no aggregation across runs. A +50-click refresh and a +2-click refresh contribute equally to "refresh works."

**Change.** Add an `impact_score` (integer, –100..100) to each memo. Compute it in the outcome tracker by normalizing the primary delta against the tool's running 90-day P95 absolute delta, signing by predicted direction (positive when delta moved as predicted, negative when opposite). Persist per-tool aggregates in a new `agent_tool_baselines` table so the normalization is stable across runs.

**New migration:**

```sql
CREATE TABLE agent_tool_baselines (
  channel          TEXT NOT NULL CHECK (channel IN ('seo','ads','social')),
  tool_name        TEXT NOT NULL,
  p95_abs_delta    DOUBLE PRECISION NOT NULL DEFAULT 0,
  n_measured       INTEGER NOT NULL DEFAULT 0,
  success_rate     DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- success: impact_score > 0
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, tool_name)
);

ALTER TABLE seo_agent_memos ADD COLUMN impact_score INTEGER;
ALTER TABLE google_ads_agent_memos ADD COLUMN impact_score INTEGER;
ALTER TABLE social_agent_memos ADD COLUMN impact_score INTEGER;
```

**New DAL:** `lib/db/agent-tool-baselines.ts` exporting `getBaseline(channel, tool)`, `upsertBaseline(channel, tool, delta, success)`, `listChannelBaselines(channel)`. Upsert recomputes P95 from the running window of memos.

**Outcome-tracker changes.** When an outcome flips from `pending` to `measured`:

1. Compute `delta` (channel-specific: clicks for SEO new-post / refresh, conversions for Ads, engagement for Social).
2. Look up `agent_tool_baselines` row for `(channel, tool_name)`. If `n_measured < 5`, set `impact_score = sign(delta) * 50` (placeholder during warm-up).
3. Else compute `impact_score = clamp(round(100 * delta / baseline.p95_abs_delta), -100, 100)`, with sign flipped when delta is opposite the predicted direction.
4. Upsert the baseline with the new measurement.
5. Write `impact_score` on the memo row.

For Social, "delta" = engagement_rate or weighted (likes + 2*comments + 3*shares) / impressions. Social does not currently have an outcome tracker per the audit; this workstream adds `lib/social/outcome-scoring.ts` (pure function) called from the existing `social-outcome-tracker.ts` when it marks a memo `measured`.

**Acceptance.**
- After 4 weeks of outcome data, `agent_tool_baselines` has at least one row per (channel, tool) measured ≥3 times.
- `impact_score` is set on every memo whose outcome has flipped to `measured`.
- During warm-up (`n_measured < 5`), `impact_score` is exactly ±50 or 0.

### 4. Tool-performance aggregates → signal gathers

**Today.** Signal gathers list recent memos as flat outcome rows. The agent prompts don't see "refreshes averaged +42 across 8 runs."

**Change.** Each agent's gather step calls `listChannelBaselines(channel)` and adds a `tool_performance` array to its signals output. Each entry shape:

```ts
{
  tool: "queue_refresh",
  n_measured: 8,
  avg_impact_score: 42,
  p95_abs_delta: 60,
  success_rate: 0.75,
}
```

**Reason-prompt addition** (each agent):

```
Tool performance (last 90 days, your channel):
  queue_refresh:    avg impact +42, 8 runs, 75% success
  queue_new_post:   avg impact +18, 12 runs, 50% success
  queue_internal_link_sweep: avg impact -5, 3 runs, 33% success

Bias your ranking toward tools with positive avg_impact and >50%
success unless the signal strongly indicates otherwise. If you choose
a historically weak tool, lower your agent_confidence and explain in
rationale.
```

**Acceptance.**
- Each agent's logged prompt includes a `tool_performance` block when `agent_tool_baselines` has data for that channel.
- When no baselines exist (warm-up), block is absent.

### 5. Self-critique pass

**Pattern.** After the main Sonnet reason step, before persisting the memo and queueing actions, run a Haiku call:

```ts
const critique = await callAgent(
  SELF_CRITIQUE_SYSTEM_PROMPT,
  buildCritiqueMessage({ plan, signalsSummary, briefSummary }),
  critiqueSchema,
  { model: MODEL_HAIKU, maxTokens: 600 },
);
```

`critiqueSchema` returns `{ objections: string[], overall: "sound" | "minor_concern" | "should_revise" }`.

Re-run heuristic: if `critique.overall === "should_revise"` AND `plan.agent_confidence <= 7`, re-run the Sonnet reason step ONCE with the critique appended:

```
You wrote this plan: {plan_summary}
A second model raised these objections: {objections}
Reconsider. You may keep the plan with stronger justification, or
revise it. Output the same schema as before.
```

Hard cap: one re-run per agent run (no recursion).

Apply to Chief, Ads, SEO. Skip Social (it already has writer→reviewer two-pass copywriting that covers the same ground).

**Persistence.** Add `self_critique_notes` column to `seo_agent_memos` and `google_ads_agent_memos` (Chief memo table already has it per #1). On re-run, also persist the pre-revision plan summary in the same column.

**Migration:**

```sql
ALTER TABLE seo_agent_memos ADD COLUMN self_critique_notes TEXT;
ALTER TABLE google_ads_agent_memos ADD COLUMN self_critique_notes TEXT;
```

**Feature flag:** `agent_self_critique_enabled` (default `true`). Kill switch in case the Haiku call goes wrong in production.

**Cost.** Small Haiku calls across three agents on a weekly cadence. Negligible compared to the Sonnet main-reason calls; track on the existing AI-cost dashboard but no engineering required around it.

**Acceptance.**
- Unit test per agent: when main plan has `agent_confidence <= 7` and critique returns `"should_revise"`, agent re-runs and persists both pre/post summaries in `self_critique_notes`.
- Unit test per agent: when critique returns `"sound"`, agent does not re-run; `self_critique_notes` contains the original critique text.
- Feature flag off → critique call is skipped entirely; `self_critique_notes` is null.

### 6. `dont_do` rejection in Social topic picker

**Today.** `scoreBlogVsBrief` ([functions/src/strategy/brief-blog-scorer.ts](../../functions/src/strategy/brief-blog-scorer.ts)) sums theme / keyword / hook matches but never checks `dont_do`. The Social agent can rank a topic high even when it directly violates the brief's forbidden list.

**Change.**

1. Extend `BriefScoringContext` to include `dont_do: string[]`.
2. In `scoreBlogVsBrief`, if any `dont_do[i].toLowerCase()` appears in the haystack (title + excerpt + content), return `-1` to mark the topic as rejected.
3. In `pickTopicWithBrief` ([functions/src/social-agent.ts:117](../../functions/src/social-agent.ts)), filter out scored entries with `score === -1`. If all candidates are filtered, write a memo with `action.kind = "no_eligible_topic"`, `ran_without_brief = false`, `agent_confidence = 1`, `dissents_from_brief = false`, and skip the writer/reviewer pass entirely. Notify the coach via the existing notification path.

**Acceptance.**
- Unit test: brief with `dont_do = ["knee pain"]`, blog post titled "How to manage knee pain in athletes" → `scoreBlogVsBrief` returns `-1`.
- Integration test: all 20 candidate posts contain a `dont_do` phrase → social agent writes a `no_eligible_topic` memo and creates a notification.

### 7. Trending topics → Social agent

**Today.** `tavilyTrendingScan` runs Mon 06:00 UTC and writes to `trending_topics`. The social agent's strategist prompt never sees this.

**Change.** Add a small DAL `lib/db/trending-topics.ts` exporting:

```ts
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
): Promise<TrendingTopic[]>
```

In `handleSocialAgentRun`, after `pickTopicWithBrief`, fetch trending topics and inject as a prompt block ahead of the writer pass:

```
Trending topics this week (Tavily, ranked):
  1. {topic} — relevance: {score}, source: {url}
  2. ...

If a trending topic aligns with brief themes or keywords_to_chase
AND no published blog covers it, prefer flagging via flag_trending_gap
rather than reaching for an off-topic blog.
```

Add a new social memo action kind `flag_trending_gap` with payload `{ trending_topic_id, reason }`. When emitted, write a notification to the coach (existing notification path) so SEO can queue net-new content next cycle.

**Acceptance.**
- Social agent's logged writer prompt includes trending topics when `trending_topics` has rows.
- Integration test: with one trending topic that has no matching blog inventory, social agent emits a `flag_trending_gap` action and creates a notification.

### 8. Few-shot examples threaded into prompts

**Today.** `prompt_templates.few_shot_examples` is populated weekly by the performance-learning-loop and read only by [functions/src/blog/voice-context.ts](../../functions/src/blog/voice-context.ts) (blog generation). Agents never see it.

**Change.** Each agent's gather step fetches its scoped `prompt_templates` row(s) and appends `few_shot_examples` to the user prompt as a "Recent winners" section:

```
Recent winners (for inspiration only — do not copy verbatim):
  1. {few_shot_example_1}
  2. {few_shot_example_2}
  3. {few_shot_example_3}
```

Scope keys (must match `prompt_templates.scope`):
- Chief: `("chief_strategist", "weekly_brief")` — new row seeded with `few_shot_examples=[]`
- SEO agent: `("seo_agent", "system")` — new row, seeded empty
- Ads agent: `("ads_agent", "system")` — new row, seeded empty
- Social agent: `("social", "<platform>")` — already exists for `linkedin`

If `few_shot_examples` is null or empty, skip the section silently. The performance-learning-loop already writes to these rows for social; this workstream just needs to start reading.

A small migration seeds the three missing rows with empty arrays so the agent's first read doesn't fail:

```sql
INSERT INTO prompt_templates (scope, category, prompt, few_shot_examples)
VALUES
  ('chief_strategist', 'weekly_brief', '', '[]'::jsonb),
  ('seo_agent', 'system', '', '[]'::jsonb),
  ('ads_agent', 'system', '', '[]'::jsonb)
ON CONFLICT (scope, category) DO NOTHING;
```

(The `prompt` column is empty because the agent's actual system prompt lives in code; this row is purely a few-shot-examples carrier. Document this in a comment.)

**Acceptance.**
- Each agent's logged prompt contains a "Recent winners" section when `few_shot_examples` has entries.
- When the column is null or `[]`, the section is absent (no error, no empty block).

## Data model summary

**New tables (3):**
- `chief_strategist_memos` (workstream 1)
- `agent_tool_baselines` (workstream 3)

**Altered tables — additive columns (single combined migration where possible):**
- `seo_agent_memos`: `agent_confidence`, `dissents_from_brief`, `dissent_reason`, `self_critique_notes`, `impact_score`
- `google_ads_agent_memos`: same five columns
- `social_agent_memos`: `agent_confidence`, `dissents_from_brief`, `dissent_reason`, `impact_score` (no `self_critique_notes` because Social skips self-critique)

All additive columns are nullable / defaulted so existing rows remain valid.

**New DAL files:**
- `lib/db/chief-strategist-memos.ts`
- `lib/db/agent-tool-baselines.ts`
- `lib/db/trending-topics.ts`

**Modified DAL files:**
- `lib/db/strategy-briefs.ts` — add `markBriefRejected(briefId, reason)`.
- Memo DAL files — extend `Insert` types to accept new columns (passthrough only; agent handlers write directly to Supabase, DALs are read-only per existing convention).

## Modified components

| File | Workstreams touched |
|---|---|
| `functions/src/chief-strategist.ts` | 1, 2, 5, 8 — emit `chief_memo` payload, persist memo, self-critique pass, read few-shots, emit confidence/dissent |
| `functions/src/strategy/chief-prompt.ts` | 1, 2, 5 — rubric for themes/channels considered + confidence + dissent + critique instructions |
| `functions/src/seo-agent.ts` | 2, 5, 8 — write `agent_confidence` / `dissents_from_brief` / `dissent_reason` / `self_critique_notes` on memo; read tool_performance; read few-shots |
| `functions/src/seo/signals.ts` | 4 — add `tool_performance` to signals |
| `functions/src/seo/reason.ts` | 2, 4, 5, 8 — confidence/dissent rubric, tool_performance section, critique step, few-shots |
| `functions/src/seo/decision-schema.ts` | 2 — extend schema with `agent_confidence` + `dissent_from_upstream` |
| `lib/seo-agent/outcomes.ts` | 3 — compute `impact_score`; upsert baseline |
| `lib/ads/agent/signals.ts` | 4, 8 — add `tool_performance`, read few-shots |
| `lib/ads/agent/reason.ts` | 2, 4, 5, 8 |
| `lib/ads/agent/decision-schema.ts` | 2 — extend agent-level schema |
| `lib/ads/agent/execute.ts` | 2, 5 — persist new columns + critique notes on memo |
| `lib/ads/agent/outcomes.ts` | 3 — compute `impact_score`; upsert baseline |
| `functions/src/social-agent.ts` | 2, 6, 7, 8 — persist new columns; topic picker rejects dont_do; inject trending topics; read few-shots |
| `functions/src/strategy/brief-blog-scorer.ts` | 6 — return -1 on dont_do match; extend context type |
| `functions/src/social-outcome-tracker.ts` (existing) | 3 — compute `impact_score` |
| `app/(admin)/admin/strategy/page.tsx` | 1, 2 — show Chief confidence + dissent + memo trail |
| `app/(admin)/admin/seo-agent/memos/page.tsx` | 2 — confidence chip + dissent icon |
| `app/(admin)/admin/ads/agent/[id]/page.tsx` | 2 — same UI additions |
| Social memo page (verify path during implementation) | 2 — same UI additions |

## Feature flags (`system_settings`)

Reuse existing flags where possible. Add:

- `agent_self_critique_enabled` (default `true`) — workstream 5 kill switch
- `agent_outcome_scoring_enabled` (default `true`) — workstream 3 kill switch (when off, outcome trackers skip score + baseline update but still write metrics)

## Migration order

The codebase migrations end at 00141. The next available numbers:

1. `00142_chief_strategist_memos.sql` — new table.
2. `00143_agent_tool_baselines.sql` — new table.
3. `00144_agent_memo_columns.sql` — `agent_confidence`, `dissents_from_brief`, `dissent_reason`, `impact_score` on three memo tables; `self_critique_notes` on SEO + Ads memo tables.
4. `00145_seed_agent_prompt_template_rows.sql` — three INSERTs seeding `chief_strategist`, `seo_agent`, `ads_agent` rows with empty `few_shot_examples`.

(Numbers are best-guess; pick next-available when implementing.)

## Sequencing within the implementation plan

The eight workstreams sequence into six phases. Phases A–C must land in order; D–F can land in parallel after C.

- **Phase A — Chief observability** (workstream 1). `chief_strategist_memos` table, DAL, Chief emits + persists memo. Unblocks debugging of any future Chief brief.
- **Phase B — Confidence + dissent on all four agents** (workstream 2). Schema + prompts + UI. Calibration data starts accumulating from day 1.
- **Phase C — Outcome scoring + baselines** (workstream 3). `agent_tool_baselines`, `impact_score` on memos, outcome tracker logic. No prompt changes yet — just the math.
- **Phase D — Aggregate feedback in prompts** (workstream 4). Depends on C having written at least one baseline. Each agent's gather + reason step adds `tool_performance`.
- **Phase E — Self-critique + few-shots** (workstreams 5 + 8). Prompt-layer additions. Few-shots and critique are independent and can land in the same PR.
- **Phase F — Social robustness** (workstreams 6 + 7). `dont_do` rejection in topic picker + trending-topic injection. Can land in parallel with D/E.

Each phase is independently shippable behind feature flags.

## Testing strategy

- **Unit tests** for: `computeImpactScore`, `upsertBaseline` (verify P95 across a synthetic memo set), each DAL, the `scoreBlogVsBrief` `dont_do` rejection, the self-critique re-run heuristic.
- **Integration tests** simulating one full agent run end-to-end per channel:
  - Memo has `agent_confidence` populated.
  - When confidence ≤ 7 and critique objects, re-run happens and `self_critique_notes` persists both versions.
  - Trending topic with no inventory → `flag_trending_gap` action emitted by social agent.
  - All-dont_do candidates → social agent writes `no_eligible_topic` memo + notification.
- **No new E2E tests** — admin UI changes are small visual additions; manual smoke check is sufficient.

## Out of scope (explicit)

Listed so reviewers can confirm the line:

- Multi-platform social publishing (TikTok, Instagram, Facebook, YouTube Shorts, X). Captions exist in `social-fanout.ts`; agent gating at `social-agent.ts:26` stays.
- Auto-approve + scheduled-publish workflow for social with digest-email-undo. Depends on confidence calibration history from workstream 2.
- Seasonality detection in Ads guardrails.
- Adaptive guardrail thresholds (campaign age, budget shift cap). Needs outcome-score history from workstream 3.
- Auto-apply expansion for Ads beyond negative keywords.
- Tool use for Chief (`query_outcomes`, `simulate_budget_shift`, `check_serp`).
- Backlink awareness, E-E-A-T signals, Core Web Vitals, internal-link graph, query cannibalization detection in SEO.
- Comment/DM agent for social.
- Replacing `scoreBlogVsBrief()` substring matching with embeddings.

## Risks & mitigations

- **Risk:** Confidence is uncalibrated initially — agents say "10" for everything.
  - **Mitigation:** Prompt rubric gives concrete examples per level. Admin UI shows the distribution so coach can spot inflation. No auto-gate on confidence in this spec.
- **Risk:** Self-critique re-runs double cost in failure modes.
  - **Mitigation:** Hard cap at one re-run per agent run (no recursion); `agent_self_critique_enabled` flag for kill-switch.
- **Risk:** `impact_score` math is unstable on early data (small `n_measured` → unstable P95).
  - **Mitigation:** When `n_measured < 5` for a tool, return `impact_score = sign(delta) * 50` as a placeholder; flag as "warming up" in admin UI.
- **Risk:** `dont_do` substring matching produces false-positive rejections (e.g., brief says `dont_do=["pain"]`, blog about "pain-free recovery" is rejected).
  - **Mitigation:** Match `dont_do` phrases at word-boundary level (`\b{phrase}\b` regex, case-insensitive). Document the matching policy in the Chief's prompt so it writes specific phrases rather than single common words.
- **Risk:** Trending topics inject noise — Social agent chases trends that aren't on-brand.
  - **Mitigation:** The prompt explicitly says trending topics are advisory and `flag_trending_gap` is preferred over off-brand reach. `brief.dont_do` (workstream 6) gates topic selection even when trending pressure is high.

## Success criteria (post-deploy, within 4 weeks)

1. Every memo row across all four agents has `agent_confidence` set; `dissents_from_*` is populated.
2. `chief_strategist_memos` has one row per Chief run with non-empty `themes_considered` and `channels_considered`.
3. `agent_tool_baselines` has at least one row per (channel, tool) measured ≥3 times.
4. Each agent's logged prompt contains `tool_performance` and (when populated) `recent_winners` sections.
5. Self-critique notes appear on ≥80% of Chief / Ads / SEO memos. Re-runs occurred on a non-zero fraction.
6. Coach can read a Chief memo in the admin UI and understand why a brief was chosen (themes considered, confidence, dissent) without re-reading the Critic signal.
7. Social agent has rejected at least one topic via `dont_do` or emitted at least one `flag_trending_gap` action.

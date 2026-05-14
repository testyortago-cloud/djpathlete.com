# Strategy Team — Design

**Date:** 2026-05-15
**Status:** Design (pre-plan). Solo-dev project; commits land on `main`.
**Related:** [2026-05-13-seo-agent-design.md](2026-05-13-seo-agent-design.md), [2026-05-13-ads-agent-lifecycle-design.md](2026-05-13-ads-agent-lifecycle-design.md), [2026-04-21-starter-ai-automation-phase5f-performance-learning-loop-design.md](2026-04-21-starter-ai-automation-phase5f-performance-learning-loop-design.md)

## Goal

Turn three mature specialist agents (SEO, Ads, Social) plus their existing learning machinery into a coordinated **strategy team** with a shared weekly direction and a single brain that synthesizes cross-channel outcomes. Today each specialist reasons in isolation — SEO does not know which keyword pillar Ads is funding, Ads does not know which post just landed organic traffic, Social picks the most recent blog post regardless of what is converting. The strategy team closes that loop without introducing real-time inter-agent dialogue.

## Why a brief + critic and not an agent bus

A real-time inter-agent message bus (each agent emits events, siblings subscribe) sounds more scalable but is not, because decisions in this domain are weekly and the bus tax (ordering, dedup, replay, schema drift, monitoring) buys no measurable lift. A weekly **brief** + a weekly **critic** produces the same coordination with one table, one cron, and one Claude call. A real-time loop only becomes useful when decisions become daily (auto-bidding, programmatic creative rotation), which is a different system built later.

The compounding asset is the **memo corpus across channels** — 50+ outcome-labeled rows per channel after a year — which enables future moves (fine-tuned reasoners, per-program strategists, daily rebalancing). This design preserves and unifies that corpus.

## Architecture

```
                         ┌────────────────────────────────┐
                         │ performanceCriticCron          │
                         │ Sat 13:00 UTC                  │
                         │ reads last 4 weeks across all  │
Substrate (existing)     │   *_agent_memos +              │
  - seo_agent_memos      │   marketing_attribution +      │
  - google_ads_agent_..  │   pipeline funnel +            │
  - social_analytics     │   voice_drift_flags            │
  - marketing_attrib..   │ writes ONE cross_channel_      │
  - gsc_query_daily      │   signals row + emails coach   │
  - voice_drift_flags    └────────────┬───────────────────┘
  - pipeline funnel                   │
                                      ▼
                         ┌────────────────────────────────┐
                         │ chiefStrategistCron            │
                         │ Sun 10:00 UTC                  │
                         │ reads latest signals row +     │
                         │   last 4 strategy_briefs       │
                         │ writes ONE strategy_briefs row │
                         │   (approval_status='draft')    │
                         │ emails coach for approval      │
                         └────────────┬───────────────────┘
                                      │
                                      ▼
                          strategy_briefs (approved)
                                      │
                ┌─────────────────────┼─────────────────────┐
                ▼                     ▼                     ▼
        seoAgent (Sun 14:00)   socialAgent (on-demand   adsAgent (Wed 13:00)
        reads brief →           + new Tue/Thu cron)     reads brief →
        biases reason →         reads brief →           biases reason →
        seo_agent_memos         social_agent_memos      google_ads_agent_memos
        with brief_id +         (NEW table — parity     with brief_id +
        brief_alignment_score   with SEO/Ads)           brief_alignment_score
                │                     │                     │
                └─────────────────────┴─────────────────────┘
                                      │
                                outcome trackers
                                (existing daily crons,
                                 extended to social)
                                      │
                                      ▼
                              feeds next week's critic
```

### Design principles

- **Coordination via shared brief, not LLM dialogue.** The brief is a structured row each specialist reads as bias. Cheaper, debuggable, auditable, and human-editable.
- **Critic reads memos; specialists write memos.** The contract between layers is a database row, not a function call. Adding a channel agent does not require critic changes.
- **Soft-gated on brief approval.** If no brief is approved by a specialist's run time, the specialist runs anyway and logs `ran_without_brief=true` on its memo. Prevents the strategy layer from blocking the existing pipeline.
- **Brief is bias, not constraint.** Specialists keep full agency. Only `brief.dont_do[]` is a hard guardrail; everything else shifts action ranking and goes into rationale.
- **Stable specialist contract.** Every specialist implements a single TypeScript interface — read brief, emit memo with required shape. Adding Email/YouTube/TikTok/Podcast/Affiliate in future is copy-paste, not redesign.
- **Coach approves the brief, not every action.** Existing per-channel approval queues (SEO refresh drafts, Ads recs queue, `social_posts.approval_status`) stay untouched.

## Approved assumptions

These are the assumptions Darren confirmed when approving Approach B. Recorded so reviewers can sanity-check them:

1. Single brand, single weekly brief (Comeback Code / Rotational Reboot are themes within a brief, not separate briefs).
2. Coach approves the brief; specialists keep their own approval queues for actions.
3. Brief is bias for ranking + rationale; only `dont_do[]` is a hard constraint.
4. No new LLM-to-LLM dialogue; coordination is via the brief row and existing memo tables.
5. North-star metric is revenue/bookings via `marketing_attribution` + pipeline funnel, not vanity engagement.
6. Social agent gains memo + outcome-tracking parity with SEO/Ads in this scope.
7. Brief is soft-gated: specialists run without an approved brief if none exists by their run time.

## Specialist contract (the scalability discipline)

New file: `lib/strategy/specialist-contract.ts`

```ts
export interface StrategyBrief {
  week_of: string                  // ISO date Monday
  themes: { tag: string; weight: number }[]
  audience_focus: string           // free-text, 1-2 sentences
  priority_channel: "seo" | "ads" | "social" | "balanced"
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]                // hard guardrails
  rationale: string                // why this brief
  approval_status: "draft" | "approved" | "rejected"
}

export interface SpecialistMemo {
  channel: "seo" | "ads" | "social"
  brief_id: string | null          // null if ran_without_brief
  brief_alignment_score: number | null   // 1-10, null if no brief
  signals_summary: string
  actions: Array<{ kind: string; payload: unknown; rationale: string }>
  rationale: string
  outcome_status: "pending" | "measured" | "preflight_failed" | "no_op"
  outcome_metrics: Record<string, unknown> | null
  ran_without_brief: boolean
  created_at: string
}
```

Every specialist agent (SEO, Ads, Social, and future channels) reads `StrategyBrief` and emits a row that conforms to `SpecialistMemo`. The critic reads all `*_agent_memos` tables uniformly via this shape. The brief gains/loses fields rarely; specialist memos gain channel-specific columns but always include the contract columns.

## Data model

Migration order: `cross_channel_signals` must be created before `strategy_briefs` because briefs FK signals. The two new specialist-memo additions can land in any order relative to those.

### New table: `cross_channel_signals`

```sql
CREATE TABLE cross_channel_signals (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of                    DATE NOT NULL UNIQUE,
  winners                    JSONB NOT NULL DEFAULT '[]',   -- top actions across channels
  losers                     JSONB NOT NULL DEFAULT '[]',   -- underperformers
  anomalies                  JSONB NOT NULL DEFAULT '[]',
  attribution_summary        JSONB NOT NULL DEFAULT '{}',   -- channel→bookings/revenue
  recommendations_for_brief  JSONB NOT NULL DEFAULT '[]',
  preflight_status           TEXT NOT NULL DEFAULT 'ok'
                                CHECK (preflight_status IN ('ok','failed')),
  preflight_reasons          JSONB DEFAULT '[]',
  rationale                  TEXT NOT NULL DEFAULT '',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### New table: `strategy_briefs`

```sql
CREATE TABLE strategy_briefs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of           DATE NOT NULL UNIQUE,         -- ISO Monday
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

### New table: `social_agent_memos`

Mirrors `seo_agent_memos` and `google_ads_agent_memos` so the critic walks all three uniformly.

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
  -- channel-specific:
  social_post_id          UUID REFERENCES social_posts(id),
  platform                TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  measured_at             TIMESTAMPTZ
);

CREATE INDEX idx_social_agent_memos_outcome
  ON social_agent_memos (outcome_status, created_at);
```

### Existing tables: additive columns

`seo_agent_memos` and `google_ads_agent_memos` gain three columns (all nullable so existing rows are valid):

```sql
ALTER TABLE seo_agent_memos
  ADD COLUMN brief_id UUID REFERENCES strategy_briefs(id),
  ADD COLUMN brief_alignment_score INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ADD COLUMN ran_without_brief BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE google_ads_agent_memos
  ADD COLUMN brief_id UUID REFERENCES strategy_briefs(id),
  ADD COLUMN brief_alignment_score INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ADD COLUMN ran_without_brief BOOLEAN NOT NULL DEFAULT false;
```

## Components

### `functions/src/performance-critic.ts` (new)

Pure handler invoked by `performanceCriticCron`. Steps:

1. **Preflight.** At least two of `{seo_agent_memos, google_ads_agent_memos, social_agent_memos}` must have a row in the last 14 days. Else insert a `cross_channel_signals` row with `preflight_status='failed'` and skip reasoning.
2. **Gather.** Last 4 weeks of memos from all three tables; last 28 days of `marketing_attribution` aggregated by channel; pipeline funnel (visits → signup → booking → payment); recent `voice_drift_flags`; last 4 `cross_channel_signals` rows (for continuity).
3. **Reason.** Single Claude call (Sonnet, cached system prompt) emitting structured JSON: `winners`, `losers`, `anomalies`, `attribution_summary`, `recommendations_for_brief`, `rationale`.
4. **Persist.** One `cross_channel_signals` row.
5. **Notify.** Resend email to COACH_EMAIL with the rationale + recommendations.

### `functions/src/chief-strategist.ts` (new)

Pure handler invoked by `chiefStrategistCron`. Steps:

1. **Preflight.** Latest `cross_channel_signals` row must exist within 8 days and have `preflight_status='ok'`. Else skip and log.
2. **Gather.** Latest signals row; last 4 strategy briefs (for theme continuity, avoid whiplash); `automation_paused` state; `prompt_templates.few_shot_examples` (informs hook suggestions).
3. **Reason.** Single Claude call. Output validated against `StrategyBrief` shape.
4. **Persist.** One `strategy_briefs` row with `approval_status='draft'`.
5. **Notify.** Resend email to COACH_EMAIL with a one-paragraph preview + link to `/admin/strategy`.

### New DAL: `lib/db/strategy-briefs.ts`

Standard DAL file (per project convention — one file per table). Exports `latestApprovedBrief()` (most recent `approval_status='approved'` row), `briefForWeek(week_of)`, `insertDraftBrief(...)`, `approveBrief(id, userId)`, `rejectBrief(id, userId)`, `patchDraftBrief(id, patch)`. All three specialist agents import `latestApprovedBrief()` from here.

A parallel `lib/db/cross-channel-signals.ts` exports `latestSignal()`, `signalForWeek(week_of)`, `insertSignal(...)`, `insertPreflightFailedSignal(reasons)`. Used by the critic and chief.

A parallel `lib/db/social-agent-memos.ts` mirrors the existing `lib/db/seo-agent-memos.ts` shape.

### Modifications to existing agents

**`functions/src/seo-agent.ts`** — in the gather step, fetch `latestApprovedBrief()` via the new DAL. Pass theme/keywords/hooks/dont_do into the reason prompt as a `brief_context` section. Reason output now includes `brief_alignment_score` (Claude rates 1-10 how well its chosen actions align with the brief). Memo row gets `brief_id`, `brief_alignment_score`, `ran_without_brief`. If `brief.dont_do[]` includes the topic of a chosen action, the guardrail rejects and the agent picks the next-ranked alternative.

**`lib/ads/agent/signals.ts` + `lib/ads/agent/reason.ts`** — same treatment. The brief is added to `AdsSignals.brief_context`; guardrails in `lib/ads/agent/guardrails.ts` gain a `brief_dont_do` rejection class.

**`functions/src/social-agent.ts`** — biggest change. Today the strategist step picks the most recent published blog post. New behavior:
- Read latest approved brief.
- Score candidate blog posts (last 60 days) by overlap with `brief.themes` + `brief.keywords_to_chase`.
- Pick highest-scoring candidate. If no brief, fall back to current "most recent published" behavior.
- After writer + reviewer passes, write a `social_agent_memos` row (in addition to the existing `social_posts` row) with `brief_id`, `brief_alignment_score`, action = "drafted_social_post", `social_post_id` link.

A new on-schedule cron `socialAgentCron` (Tue & Thu 13:00 UTC) enqueues `social_agent_run` jobs so social participates in the weekly cadence without coach intervention. Gated by `cron_social_agent_enabled` + `automation_paused`.

### New outcome tracker: social

`functions/src/social-outcome-tracker.ts` runs daily at 04:45 UTC. For each `social_agent_memos` row with `outcome_status='pending'` and `created_at` older than 14 days, reads `social_analytics` for the linked `social_post_id`, computes engagement + attribution-via-marketing_attribution if available, writes `outcome_metrics`, flips `outcome_status='measured'`. Staggered from SEO (04:15) and Ads (04:30) outcome trackers.

### Admin surface

- **`app/(admin)/admin/strategy/page.tsx`** — current week's brief (editable until approved), last 4 weeks of brief history, latest signal row.
- **`app/(admin)/admin/strategy/signals/page.tsx`** — cross-channel signal feed.
- **`app/api/admin/strategy/brief/[id]/approve/route.ts`**, **`.../reject/route.ts`**, **`.../route.ts`** (PATCH for edits before approval), **`.../regenerate/route.ts`** (enqueue a manual chief run for the current week).
- **`app/api/admin/strategy/critic/run/route.ts`** — manual trigger for the critic.
- Coach email weekly digests: extend `WeeklyContentReport` to include "this week's brief" + "last week's critic findings" sections.

### Feature flags (`system_settings`)

- `cron_performance_critic_enabled` (default `false` until first manual run is validated)
- `cron_chief_strategist_enabled` (default `false`)
- `cron_social_agent_enabled` (default `false`)
- `brief_required_for_specialists` (default `false` — soft-gate; flip on once Darren trusts the brief flow)

All four are honored alongside the existing `automation_paused` master kill switch.

## Cron schedule (additions)

| Cron | Schedule (UTC) | Reads | Writes |
|---|---|---|---|
| `performanceCriticCron` | `0 13 * * 6` (Sat 13:00) | 4 wk of all `*_agent_memos`, marketing_attribution, funnel | `cross_channel_signals` + email |
| `chiefStrategistCron` | `0 10 * * 0` (Sun 10:00) | latest signal, last 4 briefs | `strategy_briefs` draft + email |
| `socialAgentCron` | `0 13 * * 2,4` (Tue+Thu 13:00) | brief, blog inventory | `social_agent_memos` + `social_posts` draft |
| `socialOutcomeTrackerCron` | `45 4 * * *` (daily 04:45) | aged `social_agent_memos` + `social_analytics` | outcome_metrics |

Critic runs Saturday so memos from the prior week have had time to age before the Sunday brief consumes them.

## Failure modes and guardrails

| Failure | Behavior |
|---|---|
| Critic preflight fails (sparse memos) | Insert preflight-failed signal row, skip Claude, email coach |
| Chief preflight fails (no recent signal) | Skip; specialists run with last-approved brief or no brief |
| Brief not approved by specialist run time | Specialist runs with last-approved brief if it exists; else `ran_without_brief=true` |
| `brief.dont_do[]` rejects all top actions | Specialist falls back to next-ranked action; if none survive, memo with `outcome_status='no_op'` |
| `automation_paused=true` | All four new crons no-op early; existing crons unchanged |
| Claude output schema invalid | Zod validation throws; memo/signal row not written; admin email surfaces failure |
| Brief edit after approval | Approval audit trail (`approved_at`, `approved_by`); re-edit requires new approval (idempotent — same `week_of` upserts) |

## Out of scope (deferred)

- Real-time inter-agent signal bus (Approach C).
- Per-program briefs (Comeback Code vs Rotational Reboot) — themes-within-brief covers it for now.
- Email/YouTube/TikTok/Podcast specialist agents — contract makes them trivial to add later, but not in this scope.
- Fine-tuning a smaller reasoner on the memo corpus.
- Auto-applying ads changes via the brief.
- Meta Ads integration (separate spec).
- Daily strategist rebalancing (different system; build only if weekly cycle proves insufficient).

## Future work enabled by this design

- **Channel specialists 4..N** — Email, YouTube, TikTok, Affiliate, PR. Each is a new agent + new `*_agent_memos` table + new outcome tracker. Brief and critic require zero changes.
- **Per-program strategist** — Once each program has ~12 weeks of memo data, fork the chief into program-scoped briefs.
- **Memo-corpus reasoner** — Fine-tune a smaller model on the rationale-to-outcome history.
- **Brief A/B testing** — Approve two briefs in a week, route half the actions to each, compare outcomes.
- **Daily mini-strategist** — Sub-week tactical adjustments once the weekly cycle is dialed in.

## Testing strategy

- **Unit:** specialist-contract types compile; brief Zod schema rejects malformed Claude output; guardrail `dont_do` rejection picks next action; brief alignment score is in [1,10] or null.
- **Integration:** seed memos across all three channels, run critic locally, assert signal row shape; seed a signal row, run chief locally, assert brief shape; flip `brief_required_for_specialists=true`, assert specialist no-ops when no brief.
- **Manual smoke:** run critic manually via `/api/admin/strategy/critic/run`; review the signal row in `/admin/strategy/signals`; run chief manually; review and approve the brief; observe next specialist run picks it up via the memo's `brief_id`.

## Rollout

1. Land migrations + specialist contract types + admin shell (no behavior change).
2. Land critic + chief handlers behind disabled flags; manual-trigger only.
3. Run critic manually once memos exist; iterate on prompt until the signal row is useful.
4. Run chief manually; iterate on brief shape.
5. Wire `social_agent_memos` writes into existing socialAgent (still on-demand, no cron yet).
6. Enable `cron_performance_critic_enabled` (Sat).
7. Enable `cron_chief_strategist_enabled` (Sun).
8. Modify SEO + Ads to read brief; ship behind a `brief_specialist_integration_enabled` toggle defaulting on once the brief flow is trusted.
9. Enable `cron_social_agent_enabled` (Tue/Thu).
10. After 6 weeks of clean outcome data: flip `brief_required_for_specialists=true`.

Each step is independently revertable via flags.

# Ads Agent Lifecycle — Design Spec

**Date:** 2026-05-13
**Author:** Claude (Opus 4.7) with tayawaaean
**Status:** Approved for planning
**Related:** [2026-05-12-blog-seo-quick-wins.md](../plans/2026-05-12-blog-seo-quick-wins.md)

## Problem

The Google Ads "AI Agent" at [app/(admin)/admin/ads/agent/](../../../app/(admin)/admin/ads/agent/) currently produces narrative memos and supports ad-hoc Q&A via [lib/ads/agent.ts](../../../lib/ads/agent.ts), but it does not:

1. Gather cross-channel signals (GA4 + GSC + Google Ads + funnel pipeline) into a unified snapshot.
2. Emit structured, actionable proposals (only narrative sections).
3. Persist proposed actions as a tracked queue.
4. Measure post-decision outcomes to learn what worked.

The **SEO Agent** already has all four: [signals.ts](../../../functions/src/seo/signals.ts) → [reason.ts](../../../functions/src/seo/reason.ts) → [decision-schema.ts](../../../functions/src/seo/decision-schema.ts) → [execute.ts](../../../functions/src/seo/execute.ts) → [outcomes.ts](../../../lib/seo-agent/outcomes.ts).

This spec brings the Ads Agent to lifecycle parity with the SEO Agent while preserving the existing memo + email artifact.

## Non-goals

- **Auto-applying ads changes.** All proposals go to a recommendations queue requiring human approval. Ad spend is high-blast-radius; reversibility ≠ free.
- **Multi-turn tool-use reasoning.** Snapshot reasoning ships first. Claude function-calling is deferred to a future v2 (already noted as future work in [lib/ads/agent.ts](../../../lib/ads/agent.ts)).
- **Meta Ads integration.** Google Ads only for v1. Meta is a separate spec.
- **Unifying SEO + Ads into a single marketing agent.** Channel attribution and outcome measurement stay simpler when split per-channel.

## Architecture

```
                Firebase onSchedule (Wed 13:00 UTC, existing runAgentStrategist)
                                    │
                                    ▼
                POST /api/admin/internal/ads/agent-strategist  (existing route — extended)
                                    │
                ┌───────────────────┴───────────────────┐
                ▼                                       ▼
        gatherAdsSignals()                  measureAdsOutcomes()   (daily 04:15 UTC,
        lib/ads/agent/signals.ts            lib/ads/agent/outcomes.ts existing cron)
                │
                ▼
        reasonAdsDecision()
        lib/ads/agent/reason.ts
                │
                ▼ (Zod-validated)
        AdsAgentDecision
        lib/ads/agent/decision-schema.ts
                │
                ▼
        executeAdsActions()
        lib/ads/agent/execute.ts
                │
                ▼
        google_ads_agent_memos
        (signals_summary, actions[], outcome_status, outcome_metrics)
                │
                ▼
        WeeklyAgentMemo email (existing component, extended)
```

## Components

### `lib/ads/agent/signals.ts` (new)

Pure function `gatherAdsSignals(opts)` → `AdsSignals`. Pulls from existing data sources only — no new API integrations. Returns a JSON-serializable snapshot.

**Inputs collected:**
- **Google Ads (existing tables):** active campaigns + 28-day metrics; search-term performance (top 50 by spend, top 50 by conversions); pending Google Ads recommendations; conversion-action health.
- **GA4 (via [lib/analytics/ga4-data.ts](../../../lib/analytics/ga4-data.ts)):** sessions/conversions by source/medium for the 28-day window; goal completions; audience overlap.
- **GSC (via `gsc_query_daily` table):** organic queries that rank in positions 1–10 for the 28-day window — used to find paid-vs-organic gaps.
- **Pipeline (existing [lib/ads/pipeline.ts](../../../lib/ads/pipeline.ts)):** funnel rates visits → signups → bookings → payments.
- **Memory:** last 4 weeks of `google_ads_agent_memos` rows including their `outcome_metrics`.

**Cross-channel derived signals** (this is the unique value over the current snapshot). Thresholds live as named constants in `lib/ads/agent/thresholds.ts` so they can be tuned without touching the signal logic:
- `paid_terms_already_organic`: search terms with paid spend ≥ `PAID_SPEND_THRESHOLD_USD` (default $20 over 28 days) where the same query ranks position ≤ `ORGANIC_OVERLAP_MAX_POSITION` (default 5) organically. Surfaces potential overspend on owned terms.
- `organic_wins_not_in_ads`: GSC queries with clicks ≥ `ORGANIC_WIN_MIN_CLICKS` (default 10 over 28 days) and position ≤ `ORGANIC_WIN_MAX_POSITION` (default 10) that are NOT currently bid on in Google Ads. Surfaces expansion opportunity.
- `landing_page_engagement_mismatch`: campaigns with CTR ≥ p75 across active campaigns but GA4 landing-page `engagement_rate` ≤ `LP_ENGAGEMENT_FLOOR` (default 0.40). Surfaces creative/LP misalignment.

### `lib/ads/agent/decision-schema.ts` (new)

Zod schema for the agent's output. Mirrors [functions/src/seo/decision-schema.ts](../../../functions/src/seo/decision-schema.ts) structure.

```ts
const adsAgentDecisionSchema = z.object({
  rationale: z.string(),         // <= 600 words explaining the snapshot read
  actions: z.array(z.object({
    rank: z.number().int().min(1),
    tool: z.enum([
      'propose_budget_shift',
      'propose_new_keywords',
      'propose_negative_keywords',
      'propose_ad_copy_test',
      'propose_audience_expansion',
      'flag_for_human',
    ]),
    args: z.record(z.unknown()),  // tool-specific; validated per-tool in execute.ts
    rationale: z.string().max(400),
    expected_metric: z.enum(['CTR', 'CVR', 'CAC', 'ROAS', 'spend_efficiency']),
    expected_direction: z.enum(['increase', 'decrease']),
  })).max(7),                    // hard cap to prevent firehose
  watch_list: z.array(z.string()).max(5),  // things to monitor next week
});
```

### `lib/ads/agent/reason.ts` (new)

Single `callAgent()` invocation (Sonnet, cached system prompt). Takes `AdsSignals`, returns Zod-validated `AdsAgentDecision`. No tool use, no multi-turn. The existing `buildStrategistMemo()` in [lib/ads/agent.ts](../../../lib/ads/agent.ts) becomes a thin wrapper that calls `gatherAdsSignals` + `reasonAdsDecision` and renders the narrative sections from the decision.

### `lib/ads/agent/execute.ts` (new)

Per-tool handlers. **None of them apply changes to Google Ads directly.** Each writes a row to the existing `google_ads_recommendations` queue (which already supports human approval per [app/(admin)/admin/ads/recommendations/](../../../app/(admin)/admin/ads/recommendations/)) with `source: 'ads_agent'` and a back-reference to the memo. The `actions` array on `google_ads_agent_memos` stores the recommendation IDs and tool calls for audit.

### `lib/ads/agent/outcomes.ts` (new)

Mirrors [lib/seo-agent/outcomes.ts](../../../lib/seo-agent/outcomes.ts). Per-action resolvers compute 14-day post-window deltas anchored to the recommendation's `applied_at`. Recommendations still in `proposed` status are skipped — outcome measurement only runs once an admin has approved/applied the change. The 14 days *before* `applied_at` form the baseline; the 14 days *after* form the post-window:

- **CTR delta** for keyword/copy actions
- **CVR delta** for landing-page / audience actions
- **CAC + ROAS delta** for budget-shift actions
- **Spend-efficiency delta** for negative-keyword actions

The daily outcome-tracker cron (existing 04:15 UTC) calls this and updates `outcome_status` (`pending` → `measured` → optionally `rolled_back`) and `outcome_metrics`.

### API route — extension of [app/api/admin/internal/ads/agent-strategist/route.ts](../../../app/api/admin/internal/ads/agent-strategist/route.ts)

Refactored from "build memo + send email" into:

1. `gatherAdsSignals()`
2. `reasonAdsDecision(signals)`
3. `executeAdsActions(decision, memoId)`
4. `persistMemo({ signals_summary, decision, actions })`
5. `renderAndSendEmail(memo)` (existing, extended template)

### UI — [app/(admin)/admin/ads/agent/](../../../app/(admin)/admin/ads/agent/)

- **Memo list page:** add `outcome_status` badge + headline outcome metric per row.
- **Memo detail page:** add three tabs — **Signals** (collapsible JSON viewer of `signals_summary`), **Actions** (queue with status + link to the corresponding recommendation), **Outcomes** (per-action 14-day delta chart, hidden until status = `measured`).

## Data model

### Migration: extend `google_ads_agent_memos`

```sql
alter table google_ads_agent_memos
  add column signals_summary jsonb,
  add column actions jsonb default '[]'::jsonb,
  add column outcome_status text not null default 'pending'
    check (outcome_status in ('pending', 'measured', 'rolled_back')),
  add column outcome_metrics jsonb;

create index idx_agent_memos_outcome_status
  on google_ads_agent_memos(outcome_status)
  where outcome_status = 'pending';
```

No new tables — reuses `google_ads_recommendations` for the action queue.

Migration applied via the `mcp__supabase__apply_migration` MCP tool (the CLI isn't linked in this project).

## Error handling

- **Signals gathering failure** (one source unavailable): proceed with available sources, mark the gap in `signals_summary.gaps[]`, and pass to reasoning. Reasoning prompt is instructed to flag low-confidence actions when gaps exist.
- **Reasoning failure** (Zod parse failure or Claude error): retry once with the same snapshot; on second failure, write a memo row with `outcome_status='pending'`, `actions=[]`, and a `rationale` of `"Reasoning failed: <error>"`. Email is NOT sent.
- **Execute failure** (recommendation insert fails for one action): persist the others, record the failure in the memo's action entry with `status: 'failed'`, continue.
- **Outcome measurement failure**: skip that action this cycle, retry tomorrow. After 30 days unmeasured, mark `outcome_status='measured'` with `outcome_metrics.error: 'window_expired'`.

## Testing

Vitest specs co-located in `__tests__/`:

- `__tests__/ads/agent/signals.test.ts` — mock the Google Ads, GA4, GSC clients; assert cross-channel derived signals compute correctly on fixture data.
- `__tests__/ads/agent/reason.test.ts` — mock `callAgent`; assert Zod validation rejects malformed responses and accepts valid ones.
- `__tests__/ads/agent/execute.test.ts` — assert each tool writes to the right table with the right shape; assert failures don't block other actions.
- `__tests__/ads/agent/outcomes.test.ts` — fixture-based 14-day-window math; assert delta calculations and rollback detection.
- `__tests__/ads/agent/end-to-end.test.ts` — full pipeline with mocked external calls; asserts a memo row is persisted with all five new columns populated.

E2E (Playwright, optional follow-up): admin can click into a memo, see signals/actions/outcomes tabs render, and approve a recommendation from the actions tab.

## Scheduling

Unchanged: weekly Wed 13:00 UTC via Firebase `runAgentStrategist`. Daily outcome-tracker continues at 04:15 UTC; it'll pick up ads-agent memos alongside seo-agent memos because the per-channel resolvers live in the same daily cron.

## Implementation phasing (handoff to writing-plans)

The implementation plan should slice along these natural seams:

1. **Schema migration + DAL extension** ([lib/db/google-ads-agent-memos.ts](../../../lib/db/google-ads-agent-memos.ts)).
2. **`signals.ts` + tests** — pure function, easy to TDD.
3. **`decision-schema.ts` + `reason.ts` + tests** — schema first, then the Claude call.
4. **`execute.ts` + tests** — write to `google_ads_recommendations` queue.
5. **`outcomes.ts` + tests** — per-tool resolvers.
6. **API route refactor** — wire 1-5 together; existing route stays backward-compatible during transition.
7. **UI extensions** — tabs on memo detail; badge on memo list.
8. **Wire outcome-tracker cron** to include ads memos.

Each slice ends with green tests; the build is amenable to `/ralph-loop` driving each slice.

## Open risks

1. **GA4 + GSC token freshness:** both rely on stored OAuth refresh tokens. Confirm both have working refresh paths in [lib/gsc/oauth.ts](../../../lib/gsc/oauth.ts) and the GA4 equivalent before the first scheduled run. Plan step 0: verification.
2. **Search-term volume:** Google Ads search-term reports can be large. Cap to top-50-by-spend + top-50-by-conversions in `signals.ts` to keep the prompt under token limits and stay within Sonnet's cached-system-prompt economics.
3. **Outcome window collisions:** if the same keyword is touched by two consecutive memos within 14 days, attribution gets ambiguous. Mitigation: in `outcomes.ts`, only measure if no overlapping action exists in the window; otherwise mark `outcome_metrics.attribution: 'ambiguous'`.

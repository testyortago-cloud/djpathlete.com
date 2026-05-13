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
        applyGuardrails(action, signals)
        lib/ads/agent/guardrails.ts          ← gates every action
                │
                ▼ (passing actions only)
        executeAdsActions()
        lib/ads/agent/execute.ts
                │
                ▼
        google_ads_agent_memos
        (signals_summary, actions[], guardrail_rejections,
         outcome_status, outcome_metrics)
                │
                ▼
        WeeklyAgentMemo email (existing component, extended)
```

## Components

### `lib/ads/agent/signals.ts` (new)

Pure function `gatherAdsSignals(opts)` → `AdsSignals`. Pulls from existing data sources only — no new API integrations. Returns a JSON-serializable snapshot.

**Step 0 — Data-quality preflight (HARD ABORT):** Before gathering anything else, run preflight checks. If any fail, return early with `AdsSignals.preflight = { ok: false, reasons: [...] }`. The strategist route writes a memo row with `outcome_status='preflight_failed'`, `actions=[]`, `rationale='Preflight failed: …'`, and skips reasoning + email. Checks:
- Most recent conversion event ≤ 48h old (else conversion tracking is stale).
- At least one active campaign with ≥ 30 clicks in the last 7 days (else nothing to reason about).
- GA4 and GSC sync timestamps within 48h (else cross-channel signals are unreliable).
- Refresh tokens for Google Ads, GA4, and GSC are valid (don't get halfway through and 401).

**Step 1 — Raw inputs collected:**
- **Google Ads (existing tables):** active campaigns + 28-day metrics; search-term performance (top 50 by spend, top 50 by conversions); pending Google Ads recommendations; conversion-action health; auction-insights impression share + impression-share-lost (budget + rank); Quality Score per keyword.
- **GA4 (via [lib/analytics/ga4-data.ts](../../../lib/analytics/ga4-data.ts)):** sessions/conversions by source/medium for the 28-day window; goal completions; audience overlap; landing-page `engagement_rate`.
- **GSC (via `gsc_query_daily` table):** organic queries that rank in positions 1–10 for the 28-day window — used to find paid-vs-organic gaps.
- **Pipeline (existing [lib/ads/pipeline.ts](../../../lib/ads/pipeline.ts)):** funnel rates visits → signups → bookings → payments.
- **Memory:** last 4 weeks of `google_ads_agent_memos` rows including their `outcome_metrics`.

**Step 2 — Cross-channel derived signals.** Thresholds live as named constants in `lib/ads/agent/thresholds.ts`:
- `paid_terms_already_organic`: search terms with paid spend ≥ `PAID_SPEND_THRESHOLD_USD` (default $20 over 28 days) where the same query ranks position ≤ `ORGANIC_OVERLAP_MAX_POSITION` (default 5) organically. Surfaces potential overspend on owned terms.
- `organic_wins_not_in_ads`: GSC queries with clicks ≥ `ORGANIC_WIN_MIN_CLICKS` (default 10 over 28 days) and position ≤ `ORGANIC_WIN_MAX_POSITION` (default 10) that are NOT currently bid on in Google Ads. Surfaces expansion opportunity.
- `landing_page_engagement_mismatch`: campaigns with CTR ≥ p75 across active campaigns but GA4 landing-page `engagement_rate` ≤ `LP_ENGAGEMENT_FLOOR` (default 0.40). Surfaces creative/LP misalignment.

**Step 3 — Learning layer (what's actually working).** This is the institutional memory that turns the agent from "snapshot reactor" into "strategist":
- `winning_keywords`: keywords with ≥ 3 conversions in 30 days AND CVR ≥ account-wide p75. Seed for `propose_new_keywords` expansion.
- `winning_audiences`: audiences whose week-over-week CVR trended up in 3 of the last 4 weeks.
- `winning_ad_creative`: top ads ranked by (CTR × CVR), with their headline themes extracted.
- `winning_schedule`: hour-of-day × day-of-week cells where CVR > 1.5× campaign average (from `ad_schedule_view`).
- `winning_geos`: geographic regions with CVR ≥ 1.3× campaign average and ≥ 10 conversions.
- `prior_actions_that_worked`: from prior memos where `outcome_status='measured'` AND the expected-metric delta moved in the predicted direction AND the delta was significant (see Guardrails §). Each entry has `{ tool, args_summary, observed_delta, weeks_ago }`. The reasoning prompt is instructed to bias toward repeating these patterns.
- `prior_actions_that_failed`: same shape but where the delta went the wrong direction. The prompt is instructed to avoid repeating these patterns.

### `lib/ads/agent/decision-schema.ts` (new)

Zod schema for the agent's output. Mirrors [functions/src/seo/decision-schema.ts](../../../functions/src/seo/decision-schema.ts) structure.

```ts
const adsAgentDecisionSchema = z.object({
  rationale: z.string(),         // <= 600 words explaining the snapshot read
  actions: z.array(z.object({
    rank: z.number().int().min(1),
    tool: z.enum([
      // Within-campaign tweaks
      'propose_budget_shift',
      'propose_new_keywords',
      'propose_negative_keywords',
      'propose_ad_copy_test',
      'propose_audience_expansion',
      // Structural / campaign-level moves
      'propose_new_campaign',
      'propose_campaign_pause',
      'propose_campaign_split',
      'propose_match_type_change',
      'propose_bid_strategy_review',
      // Escape hatch
      'flag_for_human',
    ]),
    args: z.record(z.unknown()),  // tool-specific; validated per-tool in execute.ts
    rationale: z.string().max(400),
    expected_metric: z.enum(['CTR', 'CVR', 'CAC', 'ROAS', 'spend_efficiency', 'impression_share']),
    expected_direction: z.enum(['increase', 'decrease']),
    confidence: z.enum(['low', 'medium', 'high']),  // self-reported by the model
    supporting_signals: z.array(z.string()).max(5), // names of signals from §Signals that justify this
  })).max(7),                    // hard cap to prevent firehose
  watch_list: z.array(z.string()).max(5),  // things to monitor next week
});
```

**Per-tool arg shapes** (each enforced by a Zod refinement in `execute.ts` and gated by guardrails — see §Guardrails):
- `propose_budget_shift`: `{ from_campaign_id, to_campaign_id, delta_pct }` — clamped to ±`MAX_BUDGET_SHIFT_PCT` (default 20%).
- `propose_new_keywords`: `{ campaign_id, ad_group_id, keywords: [{ text, match_type }] }` — match type one of `phrase|exact|broad`; max 20 keywords per action.
- `propose_negative_keywords`: `{ campaign_id, negatives: [{ text, match_type, scope }] }` — `scope: 'campaign'|'ad_group'`; brand-allowlist enforced.
- `propose_ad_copy_test`: `{ ad_group_id, variant: { headlines, descriptions, final_url } }` — minimum 3 headlines, 2 descriptions per Google's RSA spec.
- `propose_audience_expansion`: `{ campaign_id, audience_id }` — audience size ≥ `MIN_AUDIENCE_SIZE` (default 1,000).
- `propose_new_campaign`: `{ name, type: 'search'|'pmax', initial_daily_budget, target_keywords, target_audience_id?, landing_page_url, conversion_action_ids }` — capped at 1 per memo; initial_daily_budget ≤ `NEW_CAMPAIGN_MAX_DAILY_BUDGET` (default $30/day). Always queue-only; never auto-launch.
- `propose_campaign_pause`: `{ campaign_id, reason }` — rejected if campaign had ≥ 1 conversion in last 7 days OR is < 14 days old.
- `propose_campaign_split`: `{ campaign_id, split_dimension: 'brand_vs_nonbrand'|'intent_tier'|'geo' }` — flagged for human, never executed.
- `propose_match_type_change`: `{ ad_group_id, keyword_id, from_match_type, to_match_type }` — only `broad→phrase` or `phrase→exact` allowed in v1 (tightening, never loosening).
- `propose_bid_strategy_review`: `{ campaign_id, current_strategy, suggested_strategy, reason }` — always `flag_for_human` semantically (no auto-change), but tracked as its own tool for outcome attribution.

### `lib/ads/agent/reason.ts` (new)

Single `callAgent()` invocation (Sonnet, cached system prompt). Takes `AdsSignals`, returns Zod-validated `AdsAgentDecision`. No tool use, no multi-turn. The existing `buildStrategistMemo()` in [lib/ads/agent.ts](../../../lib/ads/agent.ts) becomes a thin wrapper that calls `gatherAdsSignals` + `reasonAdsDecision` and renders the narrative sections from the decision.

### `lib/ads/agent/execute.ts` (new)

Per-tool handlers. **None of them apply changes to Google Ads directly.** Each writes a row to the existing `google_ads_recommendations` queue (which already supports human approval per [app/(admin)/admin/ads/recommendations/](../../../app/(admin)/admin/ads/recommendations/)) with `source: 'ads_agent'` and a back-reference to the memo. The `actions` array on `google_ads_agent_memos` stores the recommendation IDs and tool calls for audit.

**Every action must pass `applyGuardrails(action, signals)` first** (see §Guardrails). Rejected actions are persisted on the memo with `status: 'rejected_by_guardrails'` and the rejection reason, so the agent's intent is still auditable even though the action never reached the queue.

### `lib/ads/agent/guardrails.ts` (new)

The gate between the model's output and any persisted action. Three tiers:

**Hard guardrails (silently rejected — the action does not reach the queue):**
- Cannot propose any change to a campaign that is < `CAMPAIGN_MIN_AGE_DAYS` (default 14) days old — Google Smart Bidding learning period.
- Cannot recommend on a campaign with < `MIN_CLICKS_FOR_RECOMMENDATION` (default 30) clicks OR < `MIN_CONVERSIONS_FOR_RECOMMENDATION` (default 3) conversions in the 28-day window. Insufficient data.
- Budget shift `delta_pct` clamped to ±`MAX_BUDGET_SHIFT_PCT` (default 20%). A 50% delta gets clamped to 20% and flagged as `clamped: true` on the action.
- `propose_campaign_pause` rejected if the campaign drove ≥ 1 conversion in the last 7 days OR if it has any pending recommendation already.
- `propose_negative_keywords` cross-referenced against `BRAND_TERM_ALLOWLIST` (configurable per project, defaults to common brand variants); any match rejects the whole action.
- Match-type changes restricted to tightening (`broad→phrase`, `phrase→exact`). Loosening rejected.
- `propose_new_campaign` rejected if more than 1 already proposed in the same memo, or if `initial_daily_budget > NEW_CAMPAIGN_MAX_DAILY_BUDGET` (default $30).
- Total proposed *new* daily spend across all actions in a memo capped at `MAX_NEW_DAILY_SPEND_PER_MEMO` (default $100).

**Soft guardrails (allowed but annotated):**
- **Statistical significance flag.** For any action whose `supporting_signals` reference a metric delta, compute a simple significance check: for proportions (CTR, CVR) use a two-proportion z-test, for means use Welch's t-test, or fall back to a sample-size floor (≥ 100 sessions each side). Attach `significance: 'sig' | 'underpowered' | 'insufficient_data'` to the action.
- **Audit confidence** stored as `action.audit_confidence` to distinguish it from the model's self-reported `action.confidence`. Computed deterministically: `high` if data volume passes thresholds AND significance is `sig` AND a prior similar action succeeded; `medium` if 2 of 3; `low` otherwise. The UI surfaces both side-by-side — a "model: high, audit: low" delta is itself a signal that the model is overconfident.
- **Seasonality flag** if either the baseline or post window overlaps a known event (holidays from a small static calendar; product launches from `content_calendar` entries with `published_at` in window).

**Approval-tier guardrails (the queue UI enforces, not this module):**
- Budget shifts ≥ `LARGE_BUDGET_SHIFT_USD` (default $50/day equivalent) require a two-click confirmation in the recommendations UI.
- Bulk negative-keyword adds (> 10 negatives in one action) shown as one expandable card requiring batch approval.
- `propose_new_campaign` always shown with a "preview budget" toggle and never auto-launched even after approval — admin must click "Launch in Google Ads" as a separate explicit action.

Guardrail decisions are pure functions over `(action, signals, config)` — fully testable without any external calls.

### `lib/ads/agent/outcomes.ts` (new)

Mirrors [lib/seo-agent/outcomes.ts](../../../lib/seo-agent/outcomes.ts). Per-action resolvers compute 14-day post-window deltas anchored to the recommendation's `applied_at`. Recommendations still in `proposed` status are skipped — outcome measurement only runs once an admin has approved/applied the change. The 14 days *before* `applied_at` form the baseline; the 14 days *after* form the post-window:

- **CTR delta** for keyword/copy actions
- **CVR delta** for landing-page / audience actions
- **CAC + ROAS delta** for budget-shift actions
- **Spend-efficiency delta** for negative-keyword actions

The daily outcome-tracker cron (existing 04:15 UTC) calls this and updates `outcome_status` (`pending` → `measured` → optionally `rolled_back`) and `outcome_metrics`.

### API route — extension of [app/api/admin/internal/ads/agent-strategist/route.ts](../../../app/api/admin/internal/ads/agent-strategist/route.ts)

Refactored from "build memo + send email" into:

1. `gatherAdsSignals()` — includes preflight; may short-circuit to step 4 with empty actions.
2. `reasonAdsDecision(signals)` — skipped if preflight failed.
3. For each action: `applyGuardrails(action, signals)` → if accepted, `executeAdsActions()`; if rejected, attach reason and persist on memo only.
4. `persistMemo({ signals_summary, decision, actions, guardrail_rejections })`
5. `renderAndSendEmail(memo)` — extended template surfaces winning patterns, rejected actions (audit transparency), confidence + significance badges per action.

### UI — [app/(admin)/admin/ads/agent/](../../../app/(admin)/admin/ads/agent/)

- **Memo list page:** add `outcome_status` badge + headline outcome metric per row.
- **Memo detail page:** add three tabs — **Signals** (collapsible JSON viewer of `signals_summary`), **Actions** (queue with status + link to the corresponding recommendation), **Outcomes** (per-action 14-day delta chart, hidden until status = `measured`).

## Data model

### Migration: extend `google_ads_agent_memos`

```sql
alter table google_ads_agent_memos
  add column signals_summary jsonb,
  add column actions jsonb default '[]'::jsonb,
  add column guardrail_rejections jsonb default '[]'::jsonb,
  add column outcome_status text not null default 'pending'
    check (outcome_status in ('pending', 'measured', 'rolled_back', 'preflight_failed')),
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

- `__tests__/ads/agent/signals.test.ts` — mock the Google Ads, GA4, GSC clients; assert preflight aborts on stale conversion tracking, cross-channel derived signals compute correctly, and learning-layer signals (`winning_keywords`, `prior_actions_that_worked`) extract from fixtures correctly.
- `__tests__/ads/agent/reason.test.ts` — mock `callAgent`; assert Zod validation rejects malformed responses and accepts valid ones; assert each new tool variant parses correctly.
- `__tests__/ads/agent/guardrails.test.ts` — table-driven test of every hard-guardrail rule (campaign age, click/conversion floor, budget clamp, brand allowlist, match-type direction, new-campaign caps); table-driven soft-guardrail tests for significance + confidence; assert pure-function behavior (no I/O).
- `__tests__/ads/agent/execute.test.ts` — assert each tool writes to the right table with the right shape; assert guardrail-rejected actions never reach the queue but are persisted on the memo; assert failures don't block other actions.
- `__tests__/ads/agent/outcomes.test.ts` — fixture-based 14-day-window math; assert delta calculations, statistical-significance computation, attribution-ambiguity detection, and rollback detection.
- `__tests__/ads/agent/end-to-end.test.ts` — full pipeline with mocked external calls; asserts a memo row is persisted with all new columns populated AND guardrail-rejected actions appear in `actions[]` with `status='rejected_by_guardrails'`.

E2E (Playwright, optional follow-up): admin can click into a memo, see signals/actions/outcomes tabs render, and approve a recommendation from the actions tab.

## Scheduling

Unchanged: weekly Wed 13:00 UTC via Firebase `runAgentStrategist`. Daily outcome-tracker continues at 04:15 UTC; it'll pick up ads-agent memos alongside seo-agent memos because the per-channel resolvers live in the same daily cron.

## Implementation phasing (handoff to writing-plans)

The implementation plan should slice along these natural seams:

1. **Schema migration + DAL extension** ([lib/db/google-ads-agent-memos.ts](../../../lib/db/google-ads-agent-memos.ts)) — adds `signals_summary`, `actions`, `outcome_status`, `outcome_metrics`, and `guardrail_rejections`.
2. **`thresholds.ts` + `guardrails.ts` + tests** — pure-function guardrail engine first; everything downstream depends on it.
3. **`signals.ts` + tests** — preflight + raw + derived + learning-layer signals.
4. **`decision-schema.ts` + `reason.ts` + tests** — schema with expanded tool catalog, then the Claude call.
5. **`execute.ts` + tests** — guardrail gate, then write to `google_ads_recommendations` queue.
6. **`outcomes.ts` + tests** — per-tool resolvers + statistical-significance computation.
7. **API route refactor** — wire 2-6 together; existing route stays backward-compatible during transition.
8. **UI extensions** — Signals/Actions/Outcomes tabs on memo detail; rejection badges on memo list; significance + confidence chips on every action card.
9. **Wire outcome-tracker cron** to include ads memos.

Each slice ends with green tests; the build is amenable to `/ralph-loop` driving each slice.

## Open risks

1. **GA4 + GSC token freshness:** both rely on stored OAuth refresh tokens. Confirm both have working refresh paths in [lib/gsc/oauth.ts](../../../lib/gsc/oauth.ts) and the GA4 equivalent before the first scheduled run. Plan step 0: verification.
2. **Search-term volume:** Google Ads search-term reports can be large. Cap to top-50-by-spend + top-50-by-conversions in `signals.ts` to keep the prompt under token limits and stay within Sonnet's cached-system-prompt economics.
3. **Outcome window collisions:** if the same keyword is touched by two consecutive memos within 14 days, attribution gets ambiguous. Mitigation: in `outcomes.ts`, only measure if no overlapping action exists in the window; otherwise mark `outcome_metrics.attribution: 'ambiguous'`.

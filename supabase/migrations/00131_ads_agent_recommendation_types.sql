-- 00131_ads_agent_recommendation_types.sql
-- Extends google_ads_recommendations to accept the full ads-agent tool catalog
-- (11 tools, 14 recommendation_type values, scope_type 'account') and to
-- back-reference the agent memo + provenance via top-level columns.
--
-- NOTE: this is numbered 00131 because 00127-00130 were taken by the
-- perf-db track (daily_readiness, injuries, performance_tests, PR view).
-- The task plan called the file "00127_ads_agent_recommendation_types.sql"
-- but those slots are already used; renumbered to the next free slot.

alter table google_ads_recommendations
  drop constraint if exists google_ads_recommendations_recommendation_type_check;

alter table google_ads_recommendations
  add constraint google_ads_recommendations_recommendation_type_check
  check (recommendation_type in (
    'add_negative_keyword', 'adjust_bid', 'pause_keyword',
    'add_keyword', 'add_ad_variant', 'pause_ad',
    'budget_shift', 'audience_expansion', 'new_campaign',
    'campaign_pause', 'campaign_split', 'match_type_change',
    'bid_strategy_review', 'flag'
  ));

alter table google_ads_recommendations
  drop constraint if exists google_ads_recommendations_scope_type_check;

alter table google_ads_recommendations
  add constraint google_ads_recommendations_scope_type_check
  check (scope_type in ('campaign', 'ad_group', 'keyword', 'ad', 'account'));

alter table google_ads_recommendations
  add column if not exists memo_id uuid,
  add column if not exists source text;

create index if not exists idx_google_ads_recommendations_memo_id
  on google_ads_recommendations(memo_id)
  where memo_id is not null;

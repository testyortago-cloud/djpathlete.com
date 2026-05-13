-- 00126_ads_agent_lifecycle.sql
-- Extends google_ads_agent_memos with the lifecycle fields:
-- signals_summary, actions, guardrail_rejections, outcome_status, outcome_metrics.

alter table google_ads_agent_memos
  add column if not exists signals_summary jsonb,
  add column if not exists actions jsonb not null default '[]'::jsonb,
  add column if not exists guardrail_rejections jsonb not null default '[]'::jsonb,
  add column if not exists outcome_status text not null default 'pending'
    check (outcome_status in ('pending', 'measured', 'rolled_back', 'preflight_failed')),
  add column if not exists outcome_metrics jsonb;

create index if not exists idx_agent_memos_outcome_status
  on google_ads_agent_memos(outcome_status)
  where outcome_status = 'pending';

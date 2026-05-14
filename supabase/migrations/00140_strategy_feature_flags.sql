-- supabase/migrations/00140_strategy_feature_flags.sql
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

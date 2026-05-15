-- 00145_self_critique_notes.sql
-- Self-critique audit field on SEO + Ads memo tables. Each row stores the
-- v1 plan summary, the Haiku critique objections, and (when a re-run fires)
-- the v2 plan summary, so we can post-hoc inspect how often critique flipped
-- the agent's mind.
--
-- chief_strategist_memos already has self_critique_notes from migration 00142.

ALTER TABLE seo_agent_memos        ADD COLUMN self_critique_notes TEXT;
ALTER TABLE google_ads_agent_memos ADD COLUMN self_critique_notes TEXT;

COMMENT ON COLUMN seo_agent_memos.self_critique_notes IS
  'Audit trail of the Haiku second-pass critique. Format: "[v1 critique] overall=X\nobjections: ...". When a re-run fires, includes [v1 plan], [critique], [v2 plan] blocks.';
COMMENT ON COLUMN google_ads_agent_memos.self_critique_notes IS
  'Audit trail of the Haiku second-pass critique. Format: "[v1 critique] overall=X\nobjections: ...". When a re-run fires, includes [v1 plan], [critique], [v2 plan] blocks.';

-- Feature flag: when true (default), specialist agents run the Haiku critique
-- pass after the main Sonnet reason call. Flip to false to disable globally.
INSERT INTO system_settings (key, value, description) VALUES
  (
    'agent_self_critique_enabled',
    '{"enabled": true}'::jsonb,
    'When true, specialist agents (SEO, Ads, Social) run a Haiku critique after the main Sonnet reason call and re-run once when overall=should_revise AND agent_confidence <= 7.'
  )
ON CONFLICT (key) DO NOTHING;

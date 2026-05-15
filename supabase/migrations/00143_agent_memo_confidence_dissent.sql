-- 00143_agent_memo_confidence_dissent.sql
-- Adds calibrated agent-level confidence and dissent fields to all specialist
-- memo tables. Per-action confidence on google_ads_recommendations is untouched.

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

COMMENT ON COLUMN seo_agent_memos.agent_confidence IS
  'Agent-level calibrated confidence 1-10 (10=identical to recent wins, 1=high uncertainty)';
COMMENT ON COLUMN seo_agent_memos.dissents_from_brief IS
  'True when the agent chose actions that deviate from the brief themes/keywords/hooks';

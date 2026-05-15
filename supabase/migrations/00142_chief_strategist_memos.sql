-- 00142_chief_strategist_memos.sql
-- Audit trail for the Chief Strategist's weekly reasoning. One row per Chief
-- run, regardless of whether the brief insert succeeded. Enables post-hoc
-- diagnosis of rejected briefs and outcome correlation.

CREATE TABLE chief_strategist_memos (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id               UUID REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  signal_id              UUID REFERENCES cross_channel_signals(id) ON DELETE SET NULL,
  themes_considered      JSONB NOT NULL DEFAULT '[]',
  channels_considered    JSONB NOT NULL DEFAULT '[]',
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

COMMENT ON TABLE chief_strategist_memos IS
  'Per-run audit trail for chief-strategist cron. Always written, even when brief insert fails.';

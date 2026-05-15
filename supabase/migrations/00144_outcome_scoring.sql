-- 00144_outcome_scoring.sql
-- Per-tool running aggregates and per-memo impact scores. Outcome trackers
-- compute these when an outcome flips from 'pending' to 'measured'.

CREATE TABLE agent_tool_baselines (
  channel        TEXT NOT NULL CHECK (channel IN ('seo','ads','social')),
  tool_name      TEXT NOT NULL,
  p95_abs_delta  DOUBLE PRECISION NOT NULL DEFAULT 0,
  n_measured     INTEGER NOT NULL DEFAULT 0,
  success_rate   DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, tool_name)
);

ALTER TABLE seo_agent_memos          ADD COLUMN impact_score INTEGER;
ALTER TABLE google_ads_agent_memos   ADD COLUMN impact_score INTEGER;
ALTER TABLE social_agent_memos       ADD COLUMN impact_score INTEGER;

COMMENT ON TABLE agent_tool_baselines IS
  'Per-(channel, tool) running aggregates used to normalize impact_score. n_measured<5 triggers warm-up mode.';
COMMENT ON COLUMN seo_agent_memos.impact_score IS
  'Normalized -100..100. Positive = delta moved as predicted. Warm-up returns ±50.';

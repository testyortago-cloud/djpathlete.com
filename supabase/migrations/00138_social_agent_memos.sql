-- supabase/migrations/00138_social_agent_memos.sql
-- Mirror of seo_agent_memos / google_ads_agent_memos so the critic walks
-- all three uniformly. Brings social to lifecycle parity.

CREATE TABLE social_agent_memos (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date                DATE NOT NULL,
  ai_job_id               TEXT,
  brief_id                UUID REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  brief_alignment_score   INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ran_without_brief       BOOLEAN NOT NULL DEFAULT false,
  signals_summary         JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale               TEXT NOT NULL DEFAULT '',
  outcome_status          TEXT NOT NULL DEFAULT 'pending'
                             CHECK (outcome_status IN ('pending','measured','preflight_failed','no_op')),
  outcome_metrics         JSONB,
  social_post_id          UUID REFERENCES social_posts(id) ON DELETE SET NULL,
  platform                TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  measured_at             TIMESTAMPTZ
);

CREATE INDEX idx_social_agent_memos_outcome
  ON social_agent_memos (outcome_status, created_at);
CREATE INDEX idx_social_agent_memos_run_date
  ON social_agent_memos (run_date DESC);

COMMENT ON TABLE social_agent_memos IS
  'Per-run memo for the social agent. Parallel to seo_agent_memos.';

ALTER TABLE social_agent_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on social_agent_memos"
  ON social_agent_memos FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read social_agent_memos"
  ON social_agent_memos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

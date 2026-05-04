-- Phase 1.5g — AI Ads Agent (v1: weekly strategist memo + ad-hoc Q&A)
--
-- google_ads_agent_memos stores a structured weekly memo from the senior-
-- marketer agent. sections is a JSONB blob with executive_summary,
-- whats_working, whats_not, recommended_actions, watch_list — rendered to
-- both an in-app viewer and the Wednesday email digest.

CREATE TABLE google_ads_agent_memos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of         date NOT NULL,                  -- Monday of the week the memo covers
  subject         text NOT NULL,
  sections        jsonb NOT NULL DEFAULT '{}'::jsonb,
  source          text NOT NULL DEFAULT 'scheduled' CHECK (source IN ('scheduled', 'manual')),
  triggered_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  tokens_used     integer NOT NULL DEFAULT 0,
  email_sent_at   timestamptz,
  email_recipient text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_google_ads_agent_memos_week ON google_ads_agent_memos(week_of DESC);

CREATE TRIGGER trg_google_ads_agent_memos_updated_at
  BEFORE UPDATE ON google_ads_agent_memos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE google_ads_agent_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_agent_memos"
  ON google_ads_agent_memos FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all google_ads_agent_memos"
  ON google_ads_agent_memos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

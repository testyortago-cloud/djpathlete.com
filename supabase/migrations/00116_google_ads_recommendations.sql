-- Phase 1.2 — AI recommendations + audit log
-- Plan 1.2 generates Claude-authored recommendations after each nightly sync;
-- Plan 1.3 will wire the apply path that consumes 'approved'/'auto_applied'
-- rows. The automation_log captures every apply attempt with the request /
-- response payload so Darren can answer "did the AI break my campaigns?".

CREATE TABLE google_ads_recommendations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  scope_type          text NOT NULL CHECK (scope_type IN ('campaign', 'ad_group', 'keyword', 'ad')),
  scope_id            text NOT NULL,
  recommendation_type text NOT NULL CHECK (recommendation_type IN (
                        'add_negative_keyword',
                        'adjust_bid',
                        'pause_keyword',
                        'add_keyword',
                        'add_ad_variant',
                        'pause_ad'
                      )),
  payload             jsonb NOT NULL,
  reasoning           text NOT NULL,
  confidence          numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN (
                        'pending', 'approved', 'applied',
                        'rejected', 'auto_applied', 'failed', 'expired'
                      )),
  created_by_ai       boolean NOT NULL DEFAULT true,
  approved_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  applied_at          timestamptz,
  failure_reason      text,
  expires_at          timestamptz NOT NULL DEFAULT now() + INTERVAL '14 days',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_google_ads_recs_status   ON google_ads_recommendations(status, customer_id);
CREATE INDEX idx_google_ads_recs_scope    ON google_ads_recommendations(scope_type, scope_id);
CREATE INDEX idx_google_ads_recs_customer ON google_ads_recommendations(customer_id);

CREATE TRIGGER trg_google_ads_recs_updated_at
  BEFORE UPDATE ON google_ads_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE google_ads_automation_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid REFERENCES google_ads_recommendations(id) ON DELETE SET NULL,
  customer_id       text NOT NULL,
  mode              text NOT NULL,
  actor             text NOT NULL,
  api_request       jsonb NOT NULL,
  api_response      jsonb,
  result_status     text NOT NULL CHECK (result_status IN ('success', 'failure', 'partial')),
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_google_ads_log_rec     ON google_ads_automation_log(recommendation_id);
CREATE INDEX idx_google_ads_log_created ON google_ads_automation_log(created_at);

ALTER TABLE google_ads_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_automation_log  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_recommendations"
  ON google_ads_recommendations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all google_ads_recommendations"
  ON google_ads_recommendations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role full access on google_ads_automation_log"
  ON google_ads_automation_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all google_ads_automation_log"
  ON google_ads_automation_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

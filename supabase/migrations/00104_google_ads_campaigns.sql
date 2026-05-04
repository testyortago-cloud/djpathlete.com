-- Phase 1.1 sync — google_ads_campaigns
-- One row per campaign per Customer ID. automation_mode is a local override
-- (not synced from Google Ads) and survives nightly UPSERTs. raw_data keeps
-- the full Google Ads response payload for debugging / future migrations.

CREATE TABLE google_ads_campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  campaign_id         text NOT NULL,
  name                text NOT NULL,
  type                text NOT NULL CHECK (type IN (
                        'SEARCH', 'VIDEO', 'PERFORMANCE_MAX', 'DISPLAY', 'SHOPPING',
                        'DEMAND_GEN', 'LOCAL_SERVICES', 'APP', 'HOTEL', 'SMART', 'UNKNOWN'
                      )),
  status              text NOT NULL CHECK (status IN ('ENABLED', 'PAUSED', 'REMOVED')),
  bidding_strategy    text,
  budget_micros       bigint,
  start_date          date,
  end_date            date,
  automation_mode     text NOT NULL DEFAULT 'co_pilot'
                      CHECK (automation_mode IN ('auto_pilot', 'co_pilot', 'advisory')),
  raw_data            jsonb,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, campaign_id)
);

CREATE INDEX idx_google_ads_campaigns_customer ON google_ads_campaigns(customer_id);
CREATE INDEX idx_google_ads_campaigns_status   ON google_ads_campaigns(status);

CREATE TRIGGER trg_google_ads_campaigns_updated_at
  BEFORE UPDATE ON google_ads_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE google_ads_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_campaigns"
  ON google_ads_campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all google_ads_campaigns"
  ON google_ads_campaigns FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

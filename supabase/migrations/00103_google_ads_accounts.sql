-- Phase 1.1 — Google Ads account registry
-- One row per connected Customer ID. Schema allows MCC (manager) accounts
-- via manager_customer_id, but Phase 1.1 ships single-account only.

CREATE TABLE google_ads_accounts (
  customer_id          text PRIMARY KEY,
  manager_customer_id  text,
  descriptive_name     text,
  currency_code        text,
  time_zone            text,
  is_active            boolean NOT NULL DEFAULT true,
  connected_at         timestamptz,
  last_synced_at       timestamptz,
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_google_ads_accounts_updated_at
  BEFORE UPDATE ON google_ads_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE google_ads_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_accounts"
  ON google_ads_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all google_ads_accounts"
  ON google_ads_accounts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

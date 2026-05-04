-- Phase 1.5e — GA4 / remarketing audience visibility cache
--
-- google_ads_ga4_audiences mirrors non-Customer-Match user_list rows from
-- Google Ads (those flow in via the GA4 ↔ Google Ads link, configured in
-- the Google Ads UI — there's no API to create them on our side). This
-- table is purely a read-through cache so the admin can see what audiences
-- are flowing without leaving djpathlete.
--
-- Customer Match lists (CRM_BASED type) live in google_ads_user_lists
-- and are managed by Plan 1.5b. Everything else (REMARKETING, RULE_BASED,
-- LOGICAL, SIMILAR, LOOKALIKE, EXTERNAL_REMARKETING) lands here.

CREATE TABLE google_ads_ga4_audiences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  user_list_id    text NOT NULL,                  -- Google Ads UserList numeric ID
  name            text NOT NULL,
  description     text,
  list_type       text NOT NULL,                  -- REMARKETING | RULE_BASED | LOGICAL | SIMILAR | LOOKALIKE | EXTERNAL_REMARKETING
  membership_status text,                         -- OPEN | CLOSED
  size_for_search   integer,                      -- estimated members for search ad serving
  size_for_display  integer,                      -- estimated members for display ad serving
  membership_life_span_days integer,
  raw_data        jsonb,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, user_list_id)
);

CREATE INDEX idx_google_ads_ga4_audiences_customer ON google_ads_ga4_audiences(customer_id);
CREATE INDEX idx_google_ads_ga4_audiences_type     ON google_ads_ga4_audiences(list_type);

CREATE TRIGGER trg_google_ads_ga4_audiences_updated_at
  BEFORE UPDATE ON google_ads_ga4_audiences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE google_ads_ga4_audiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_ga4_audiences"
  ON google_ads_ga4_audiences FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all google_ads_ga4_audiences"
  ON google_ads_ga4_audiences FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

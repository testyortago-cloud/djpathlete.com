-- Phase 1.1 sync — google_ads_daily_metrics + google_ads_search_terms
-- Metrics are stored at the most-granular grain available (campaign +
-- ad_group + keyword) but queried by aggregating up. Generated columns for
-- ctr / avg_cpc keep computed values consistent. The 7-day rewrite window
-- (handled by the sync orchestrator) catches Google Ads attribution lag.
--
-- ad_group_id and keyword_criterion_id are nullable so we can roll up to the
-- campaign grain. The unique key uses COALESCE(...) so NULLs collapse to ''
-- for dedup purposes (PostgreSQL treats NULL = NULL as unknown otherwise).

CREATE TABLE google_ads_daily_metrics (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  campaign_id          text NOT NULL,
  ad_group_id          text,
  keyword_criterion_id text,
  date                 date NOT NULL,
  impressions          bigint NOT NULL DEFAULT 0,
  clicks               bigint NOT NULL DEFAULT 0,
  cost_micros          bigint NOT NULL DEFAULT 0,
  conversions          numeric(12,3) NOT NULL DEFAULT 0,
  conversion_value     numeric(14,2) NOT NULL DEFAULT 0,
  ctr                  numeric(8,5) GENERATED ALWAYS AS
                       (CASE WHEN impressions > 0 THEN clicks::numeric / impressions ELSE 0 END) STORED,
  avg_cpc_micros       bigint GENERATED ALWAYS AS
                       (CASE WHEN clicks > 0 THEN cost_micros / clicks ELSE 0 END) STORED,
  raw_data             jsonb,
  last_synced_at       timestamptz NOT NULL DEFAULT now()
);

-- Expression-based uniqueness can't be inline (Postgres rejects CASE/COALESCE
-- in column-list UNIQUE constraints). A separate UNIQUE INDEX with COALESCE
-- collapses NULLs to '' so dedup behaves as expected at the rollup grain.
CREATE UNIQUE INDEX idx_google_ads_daily_metrics_unique
  ON google_ads_daily_metrics(
    customer_id,
    campaign_id,
    COALESCE(ad_group_id, ''),
    COALESCE(keyword_criterion_id, ''),
    date
  );

CREATE INDEX idx_google_ads_daily_metrics_date     ON google_ads_daily_metrics(date);
CREATE INDEX idx_google_ads_daily_metrics_campaign ON google_ads_daily_metrics(campaign_id, date);

CREATE TABLE google_ads_search_terms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  campaign_id         text NOT NULL,
  ad_group_id         text NOT NULL,
  search_term         text NOT NULL,
  date                date NOT NULL,
  impressions         bigint NOT NULL DEFAULT 0,
  clicks              bigint NOT NULL DEFAULT 0,
  cost_micros         bigint NOT NULL DEFAULT 0,
  conversions         numeric(12,3) NOT NULL DEFAULT 0,
  matched_keyword_id  text,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, campaign_id, ad_group_id, search_term, date)
);

CREATE INDEX idx_search_terms_term ON google_ads_search_terms(search_term);

ALTER TABLE google_ads_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_search_terms  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_daily_metrics"
  ON google_ads_daily_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on google_ads_search_terms"
  ON google_ads_search_terms  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all google_ads_daily_metrics"
  ON google_ads_daily_metrics FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins read all google_ads_search_terms"
  ON google_ads_search_terms  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

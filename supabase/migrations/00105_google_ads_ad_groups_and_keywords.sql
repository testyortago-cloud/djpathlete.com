-- Phase 1.1 sync — ad_groups, keywords, negative_keywords, ads
-- All FKs use the local UUID PK (id) so we can rewrite parent rows without
-- breaking children, and use the (parent, external_id) UNIQUE for UPSERT.

CREATE TABLE google_ads_ad_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES google_ads_campaigns(id) ON DELETE CASCADE,
  ad_group_id     text NOT NULL,
  name            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('ENABLED', 'PAUSED', 'REMOVED')),
  type            text,
  cpc_bid_micros  bigint,
  raw_data        jsonb,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, ad_group_id)
);

CREATE INDEX idx_google_ads_ad_groups_campaign ON google_ads_ad_groups(campaign_id);

CREATE TRIGGER trg_google_ads_ad_groups_updated_at
  BEFORE UPDATE ON google_ads_ad_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE google_ads_keywords (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_group_id     uuid NOT NULL REFERENCES google_ads_ad_groups(id) ON DELETE CASCADE,
  criterion_id    text NOT NULL,
  text            text NOT NULL,
  match_type      text NOT NULL CHECK (match_type IN ('EXACT', 'PHRASE', 'BROAD')),
  status          text NOT NULL CHECK (status IN ('ENABLED', 'PAUSED', 'REMOVED')),
  cpc_bid_micros  bigint,
  raw_data        jsonb,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ad_group_id, criterion_id)
);

CREATE INDEX idx_google_ads_keywords_ad_group ON google_ads_keywords(ad_group_id);
CREATE INDEX idx_google_ads_keywords_status   ON google_ads_keywords(status);

CREATE TABLE google_ads_negative_keywords (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     text NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  scope_type      text NOT NULL CHECK (scope_type IN ('campaign', 'ad_group')),
  scope_id        uuid NOT NULL,
  criterion_id    text NOT NULL,
  text            text NOT NULL,
  match_type      text NOT NULL CHECK (match_type IN ('EXACT', 'PHRASE', 'BROAD')),
  raw_data        jsonb,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, scope_type, scope_id, criterion_id)
);

CREATE INDEX idx_google_ads_negative_kw_scope ON google_ads_negative_keywords(scope_type, scope_id);

CREATE TABLE google_ads_ads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_group_id     uuid NOT NULL REFERENCES google_ads_ad_groups(id) ON DELETE CASCADE,
  ad_id           text NOT NULL,
  type            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('ENABLED', 'PAUSED', 'REMOVED')),
  headlines       jsonb NOT NULL DEFAULT '[]'::jsonb,
  descriptions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_urls      jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_data        jsonb,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ad_group_id, ad_id)
);

CREATE INDEX idx_google_ads_ads_ad_group ON google_ads_ads(ad_group_id);

ALTER TABLE google_ads_ad_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_keywords         ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_negative_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_ads              ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_ad_groups"        ON google_ads_ad_groups        FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on google_ads_keywords"         ON google_ads_keywords         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on google_ads_negative_keywords" ON google_ads_negative_keywords FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on google_ads_ads"              ON google_ads_ads              FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all google_ads_ad_groups"        ON google_ads_ad_groups        FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins read all google_ads_keywords"         ON google_ads_keywords         FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins read all google_ads_negative_keywords" ON google_ads_negative_keywords FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins read all google_ads_ads"              ON google_ads_ads              FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

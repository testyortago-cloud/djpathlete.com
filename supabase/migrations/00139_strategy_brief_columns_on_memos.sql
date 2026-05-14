-- supabase/migrations/00139_strategy_brief_columns_on_memos.sql
-- Add brief linkage + alignment score + ran_without_brief to the existing
-- SEO and Ads memo tables. All nullable / default so existing rows are valid.

ALTER TABLE seo_agent_memos
  ADD COLUMN brief_id UUID REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  ADD COLUMN brief_alignment_score INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ADD COLUMN ran_without_brief BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE google_ads_agent_memos
  ADD COLUMN brief_id UUID REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  ADD COLUMN brief_alignment_score INTEGER CHECK (brief_alignment_score BETWEEN 1 AND 10),
  ADD COLUMN ran_without_brief BOOLEAN NOT NULL DEFAULT false;

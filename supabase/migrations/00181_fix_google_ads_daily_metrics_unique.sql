-- Fix: google_ads_daily_metrics upserts never worked.
--
-- 00106 created uniqueness as an EXPRESSION index —
--   (customer_id, campaign_id, COALESCE(ad_group_id,''), COALESCE(keyword_criterion_id,''), date)
-- — but the sync DAL upserts with a plain column list:
--   ON CONFLICT (customer_id, campaign_id, ad_group_id, keyword_criterion_id, date)
-- Postgres cannot infer an expression index from a column list, so every
-- metrics write failed with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification". The table has been empty since
-- launch; the error only surfaced in the sync banner once campaigns started
-- serving (zero-impression days return no rows, and the upsert short-circuits
-- on empty input).
--
-- UNIQUE NULLS NOT DISTINCT (Postgres 15+) gives the same NULL-collapsing
-- dedup semantics the COALESCE index was built for, in a form ON CONFLICT
-- column inference CAN target. Table is empty, so no dedup backfill needed.

DROP INDEX IF EXISTS idx_google_ads_daily_metrics_unique;

ALTER TABLE google_ads_daily_metrics
  ADD CONSTRAINT google_ads_daily_metrics_grain_key
  UNIQUE NULLS NOT DISTINCT (customer_id, campaign_id, ad_group_id, keyword_criterion_id, date);

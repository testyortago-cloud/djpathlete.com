-- supabase/migrations/00067_shop_product_type.sql
-- Phase 2: introduce product_type discriminator + per-type columns

CREATE TYPE product_type AS ENUM ('pod', 'digital', 'affiliate');

ALTER TABLE shop_products
  ADD COLUMN product_type product_type NOT NULL DEFAULT 'pod',
  ADD COLUMN affiliate_url                  text,
  ADD COLUMN affiliate_asin                 text,
  ADD COLUMN affiliate_price_cents          integer,
  ADD COLUMN digital_access_days            integer,
  ADD COLUMN digital_signed_url_ttl_seconds integer NOT NULL DEFAULT 900,
  ADD COLUMN digital_max_downloads          integer,
  ADD COLUMN digital_is_free                boolean NOT NULL DEFAULT false;

-- printful_sync_id becomes nullable (digital/affiliate products have no sync id).
ALTER TABLE shop_products ALTER COLUMN printful_sync_id DROP NOT NULL;

CREATE INDEX idx_shop_products_type ON shop_products(product_type);

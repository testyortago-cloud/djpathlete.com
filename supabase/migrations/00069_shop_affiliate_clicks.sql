-- supabase/migrations/00069_shop_affiliate_clicks.sql
CREATE TABLE shop_affiliate_clicks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  clicked_at   timestamptz NOT NULL DEFAULT now(),
  ip_address   text,
  user_agent   text,
  referrer     text
);

CREATE INDEX idx_shop_affiliate_clicks_product_time
  ON shop_affiliate_clicks(product_id, clicked_at DESC);

ALTER TABLE shop_affiliate_clicks ENABLE ROW LEVEL SECURITY;
-- Service role only: no policies created.

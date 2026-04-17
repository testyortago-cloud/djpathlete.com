-- supabase/migrations/00071_shop_order_downloads.sql
CREATE TABLE shop_order_downloads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id         uuid NOT NULL REFERENCES shop_products(id),
  file_id            uuid NOT NULL REFERENCES shop_product_files(id),
  access_expires_at  timestamptz,
  download_count     integer NOT NULL DEFAULT 0,
  max_downloads      integer,
  last_downloaded_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_shop_order_downloads_order_file
  ON shop_order_downloads(order_id, file_id);
CREATE INDEX idx_shop_order_downloads_order ON shop_order_downloads(order_id);

ALTER TABLE shop_order_downloads ENABLE ROW LEVEL SECURITY;

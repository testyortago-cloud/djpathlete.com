-- supabase/migrations/00070_shop_product_files.sql
CREATE TABLE shop_product_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  display_name    text NOT NULL,
  storage_path    text NOT NULL,
  file_size_bytes bigint NOT NULL,
  mime_type       text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shop_product_files_product ON shop_product_files(product_id);

ALTER TABLE shop_product_files ENABLE ROW LEVEL SECURITY;
-- service role only

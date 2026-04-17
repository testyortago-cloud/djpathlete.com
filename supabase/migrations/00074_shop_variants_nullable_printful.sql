-- supabase/migrations/00074_shop_variants_nullable_printful.sql
-- Digital products auto-create a single default variant for cart uniformity.
-- Those variants have no Printful IDs, so the columns must allow NULL.

ALTER TABLE shop_product_variants
  ALTER COLUMN printful_sync_variant_id DROP NOT NULL,
  ALTER COLUMN printful_variant_id DROP NOT NULL;
-- The UNIQUE index on printful_sync_variant_id still works (NULLs are distinct).

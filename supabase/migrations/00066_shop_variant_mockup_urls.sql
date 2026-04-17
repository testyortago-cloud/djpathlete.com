-- Add mockup_urls jsonb array to store every Printful mockup image per variant
-- (front, back, flat, sleeve, lifestyle, etc.). Existing mockup_url remains as
-- the primary image for back-compat.

alter table shop_product_variants
  add column if not exists mockup_urls jsonb not null default '[]'::jsonb;

-- Backfill existing rows: seed the array with the single primary image
update shop_product_variants
set mockup_urls = jsonb_build_array(mockup_url)
where mockup_urls = '[]'::jsonb
  and mockup_url is not null
  and mockup_url <> '';

-- Guard: the column must always be a JSON array
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shop_product_variants_mockup_urls_is_array'
  ) then
    alter table shop_product_variants
      add constraint shop_product_variants_mockup_urls_is_array
      check (jsonb_typeof(mockup_urls) = 'array');
  end if;
end $$;

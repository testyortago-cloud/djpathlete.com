-- supabase/migrations/00260_business_brand_colors.sql
-- Per-tenant brand colours for the page builder's palette default.
--
-- Nullable with no default on purpose: NULL means "this tenant has not chosen a
-- brand", which is what makes themeCss() fall through to today's var(--primary)
-- behaviour. A default would make every existing tenant claim a brand it never set.
--
-- Two columns, not seven: resolvePalette() derives ink, surface, paper and accent
-- from the brand, so the derived palette is contrast-checked by construction.
--
-- The CHECK mirrors the Zod regex deliberately. These values are interpolated into
-- a CSS custom property, and safeStyle() in the funnel compiler does NOT reject
-- url(...) -- so one guard is not enough.
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS brand_color  text,
  ADD COLUMN IF NOT EXISTS accent_color text;

ALTER TABLE public.business_settings
  DROP CONSTRAINT IF EXISTS business_settings_brand_color_hex;
ALTER TABLE public.business_settings
  ADD CONSTRAINT business_settings_brand_color_hex
  CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$');

ALTER TABLE public.business_settings
  DROP CONSTRAINT IF EXISTS business_settings_accent_color_hex;
ALTER TABLE public.business_settings
  ADD CONSTRAINT business_settings_accent_color_hex
  CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$');

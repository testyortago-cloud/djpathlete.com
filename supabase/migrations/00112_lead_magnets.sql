-- supabase/migrations/00112_lead_magnets.sql
-- Phase 5 of blog-generation-quality rollout.
-- Coach-managed catalog of downloadable lead magnets (PDFs, checklists, etc.)
-- that auto-render under the intro of topically-matching blog posts.
-- Public-read for active=true rows; service-role-only for writes.

CREATE TABLE lead_magnets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  asset_url text NOT NULL,
  category text CHECK (category IN ('Performance', 'Recovery', 'Coaching', 'Youth Development')),
  tags text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_magnets_active ON lead_magnets(active) WHERE active = true;
CREATE INDEX idx_lead_magnets_tags ON lead_magnets USING GIN (tags);
CREATE INDEX idx_lead_magnets_category ON lead_magnets(category) WHERE category IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_lead_magnets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lead_magnets_updated_at
  BEFORE UPDATE ON lead_magnets
  FOR EACH ROW EXECUTE FUNCTION set_lead_magnets_updated_at();

ALTER TABLE lead_magnets ENABLE ROW LEVEL SECURITY;

-- Public read for active rows (rendered on public blog).
CREATE POLICY "active lead magnets are public" ON lead_magnets
  FOR SELECT USING (active = true);

-- Service role bypasses RLS for all writes; admin API routes use the
-- service-role client.

COMMENT ON COLUMN lead_magnets.slug IS 'URL-friendly unique identifier (lowercase, hyphens).';
COMMENT ON COLUMN lead_magnets.asset_url IS 'Direct URL to the downloadable asset (PDF, etc.). Coach uploads to Supabase Storage or external host.';
COMMENT ON COLUMN lead_magnets.category IS 'Optional blog category match. NULL = matches any category.';
COMMENT ON COLUMN lead_magnets.tags IS 'Tags to match against post.tags. Best match wins when multiple magnets are eligible.';
COMMENT ON COLUMN lead_magnets.active IS 'When false, magnet does not render on public posts and is hidden from default admin list.';

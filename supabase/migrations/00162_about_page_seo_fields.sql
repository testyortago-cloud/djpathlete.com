-- 00162_about_page_seo_fields.sql
--
-- Extends about_page_content (00161) so the coach can edit the page <title>,
-- meta description, and the credential cards via /admin/marketing/about. Each
-- credential flows into BOTH the visible 6-card grid AND the Person JSON-LD
-- hasCredential array, so adding a new certification automatically improves
-- the on-page text AND the structured E-E-A-T signal Google + AI Overviews
-- read.

ALTER TABLE public.about_page_content
  ADD COLUMN IF NOT EXISTS meta_title TEXT NOT NULL
    DEFAULT 'Darren J Paul — Athletic Performance Coach',
  ADD COLUMN IF NOT EXISTS meta_description TEXT NOT NULL
    DEFAULT 'Meet Darren J Paul — athletic performance coach and sports performance coach behind DJP Athlete. Two decades coaching elite and youth athletes in Tampa Bay, FL.',
  -- Array of {icon, title, category?, recognizing_org?, recognizing_url?}
  -- icon: 'graduation_cap' | 'award' | 'trophy'
  -- category: 'degree' | 'certification' | 'experience'
  ADD COLUMN IF NOT EXISTS credentials JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Seed with the current /about credentials so the live page is unchanged
-- until the coach edits something. Includes structured recognizing-org
-- data for the schema layer.
UPDATE public.about_page_content
SET credentials = jsonb_build_array(
  jsonb_build_object(
    'icon', 'graduation_cap',
    'title', 'Doctor of Philosophy (PhD)',
    'category', 'degree'
  ),
  jsonb_build_object(
    'icon', 'graduation_cap',
    'title', 'B.S. in Exercise Science & Kinesiology',
    'category', 'degree'
  ),
  jsonb_build_object(
    'icon', 'award',
    'title', 'Certified Strength & Conditioning Specialist (CSCS)',
    'category', 'certification',
    'recognizing_org', 'National Strength and Conditioning Association',
    'recognizing_url', 'https://www.nsca.com/'
  ),
  jsonb_build_object(
    'icon', 'award',
    'title', 'NASM Certified Personal Trainer',
    'category', 'certification',
    'recognizing_org', 'National Academy of Sports Medicine',
    'recognizing_url', 'https://www.nasm.org/'
  ),
  jsonb_build_object(
    'icon', 'trophy',
    'title', 'Two Decades of High-Performance Experience',
    'category', 'experience'
  )
)
WHERE id = 1 AND credentials = '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

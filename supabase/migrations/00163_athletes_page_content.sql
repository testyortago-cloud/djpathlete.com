-- 00163_athletes_page_content.sql
--
-- Single-row content table for the public /athletes page. Lets the coach edit
-- the hero copy and the four stage cards (Professional / Collegiate /
-- Youth / Return-to-Sport) from /admin/marketing/athletes without a code
-- deploy. Mirrors the about_page_content (00161) shape.

CREATE TABLE IF NOT EXISTS public.athletes_page_content (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Hero
  hero_eyebrow TEXT NOT NULL DEFAULT 'Athletes',
  hero_heading_line_1 TEXT NOT NULL DEFAULT 'Sports performance training',
  hero_heading_line_2 TEXT NOT NULL DEFAULT 'for every stage of athlete.',
  hero_description TEXT NOT NULL DEFAULT 'Professional. Collegiate. Youth. Coming back from injury. The same training framework runs each stage, scaled to training age, sport and calendar.',

  -- "Four stages" section
  stages_eyebrow TEXT NOT NULL DEFAULT 'The four stages',
  stages_heading TEXT NOT NULL DEFAULT 'One training system, scaled to where you actually are.',
  -- Array of stage objects, each: { id, icon, name, heading, summary, pillars[3..] }
  stages JSONB NOT NULL DEFAULT '[]'::jsonb,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-bump updated_at on every UPDATE
CREATE OR REPLACE FUNCTION public.athletes_page_content_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_athletes_page_content_updated_at ON public.athletes_page_content;
CREATE TRIGGER trg_athletes_page_content_updated_at
  BEFORE UPDATE ON public.athletes_page_content
  FOR EACH ROW EXECUTE FUNCTION public.athletes_page_content_set_updated_at();

-- Seed with current production copy so the page renders identically until
-- the coach changes something.
INSERT INTO public.athletes_page_content (id, stages)
VALUES (
  1,
  jsonb_build_array(
    jsonb_build_object(
      'id', 'professional',
      'icon', 'plane',
      'name', 'Professional',
      'heading', 'Performance training for professional athletes',
      'summary', 'Year-round, individualized training built around touring reality: travel, time zones, tournament density and in-season load. Programming adjusts weekly to wellness markers and the equipment available at the venue. Already used by WTA professionals and professional pickleball players among the 500+ athletes coached.',
      'pillars', jsonb_build_array(
        'Travel-friendly programming that moves with the schedule',
        'In-season load monitoring with weekly programming changes',
        'Career longevity prioritized over short peak windows'
      )
    ),
    jsonb_build_object(
      'id', 'collegiate',
      'icon', 'graduation_cap',
      'name', 'Collegiate & competitive amateur',
      'heading', 'Sports performance training for collegiate and competitive amateur athletes',
      'summary', 'A diagnostic-driven training plan instead of a roster template. Force production, asymmetry, movement quality and sport-specific output measured first, then strength training and speed training periodized across off-season, pre-season, in-season and post-season blocks. Works alongside school strength staff where they exist, not around them.',
      'pillars', jsonb_build_array(
        'Diagnostic baseline before the program is written',
        'Year-round periodization built around the sport calendar',
        'Strength training that transfers to sprint speed, change of direction and rotational power'
      )
    ),
    jsonb_build_object(
      'id', 'youth',
      'icon', 'sparkles',
      'name', 'Youth & long-term development',
      'heading', 'Youth athletic performance training and long-term development',
      'summary', 'Strength training, movement quality and speed work programmed around training age and maturity, not chronological age. The NSCA''s position is that supervised, age-appropriate resistance training is safe and effective for young athletes — and is one of the most effective injury-prevention tools available. Multi-sport participation is encouraged through the early teens; early single-sport specialization is not.',
      'pillars', jsonb_build_array(
        'Age and stage-appropriate progression',
        'Movement quality, deceleration and change of direction trained from the foundation',
        'Long-term athletic development that protects the ceiling, not eight-week peaks'
      )
    ),
    jsonb_build_object(
      'id', 'return-to-sport',
      'icon', 'heart_pulse',
      'name', 'Return to sport',
      'heading', 'Return-to-performance training for athletes coming back from injury',
      'summary', 'The bridge between medical clearance and competition readiness. Force production, single-leg asymmetry, reactive strength and sport-specific output are measured, then closed with structured strength training and progressive reactive loading. Works alongside the clinical team; does not replace physiotherapy.',
      'pillars', jsonb_build_array(
        'Return-to-performance assessment before the rebuild starts',
        'Asymmetry-targeted strength training programmed from data',
        'Progressive reactive and sport-specific reintegration'
      )
    )
  )
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

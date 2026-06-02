-- 00161_about_page_content.sql
--
-- Single-row content table for the public /about page. Lets the coach edit
-- hero copy, the AEO answer block, the journey story, and the bottom CTA via
-- /admin/marketing/about without a code deploy.
--
-- The id CHECK ensures only one row ever exists; the seed below creates it
-- with the current production copy so the public page renders identically
-- until something is changed.

CREATE TABLE IF NOT EXISTS public.about_page_content (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Hero
  hero_eyebrow TEXT NOT NULL DEFAULT 'Meet Your Coach',
  hero_heading TEXT NOT NULL DEFAULT 'About Darren J Paul',
  hero_credentials_line TEXT NOT NULL DEFAULT 'PhD · Sports Performance Coach · CSCS · NASM',
  -- Array of paragraph strings rendered as <p>s under the credentials line.
  hero_bio_paragraphs JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- AEO answer block ("In short")
  aeo_eyebrow TEXT NOT NULL DEFAULT 'In short',
  aeo_question TEXT NOT NULL DEFAULT 'Who is Darren J Paul?',
  aeo_answer TEXT NOT NULL DEFAULT '',

  -- "The Journey" story section
  story_heading TEXT NOT NULL DEFAULT 'The Journey',
  story_paragraphs JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Bottom CTA section
  cta_eyebrow TEXT NOT NULL DEFAULT 'Ready to start training?',
  cta_heading TEXT NOT NULL DEFAULT 'Ready to start training?',
  cta_description TEXT NOT NULL DEFAULT 'Whether you are an aspiring athlete or a seasoned competitor, there is a place for you here.',
  cta_button_label TEXT NOT NULL DEFAULT 'Get in Touch',
  cta_button_href TEXT NOT NULL DEFAULT '/contact',

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-bump updated_at on every UPDATE
CREATE OR REPLACE FUNCTION public.about_page_content_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_about_page_content_updated_at ON public.about_page_content;
CREATE TRIGGER trg_about_page_content_updated_at
  BEFORE UPDATE ON public.about_page_content
  FOR EACH ROW EXECUTE FUNCTION public.about_page_content_set_updated_at();

-- Seed the single row with current /about copy so the public page renders
-- identically to the hard-coded version until the coach changes something.
INSERT INTO public.about_page_content (
  id,
  hero_bio_paragraphs,
  aeo_answer,
  story_paragraphs
)
VALUES (
  1,
  jsonb_build_array(
    'Performance strategist, coach, and researcher. Two decades inside high-performance environments. 500+ athletes coached across 15+ sports and 3 continents — including WTA professional tennis players and pro pickleball players.',
    'I think in systems, not exercises. I look for patterns, not shortcuts. Every program is built from diagnostic data and adjusted in real time.'
  ),
  'Darren J Paul, PhD, is a sports performance coach and the founder of DJP Athlete, based in Zephyrhills, Florida (Tampa Bay area). He has spent two decades inside high-performance environments and has coached 500+ athletes across 15+ sports and three continents, including WTA professional tennis players and professional pickleball players. His certifications include CSCS (NSCA) and NASM-CPT, alongside a PhD and a degree in exercise science. He delivers in-person training at his Tampa Bay facility and online coaching for athletes worldwide, plus return-to-performance assessments for athletes coming back from injury. His approach is diagnostic-driven and individualized: systems over exercises, patterns over shortcuts.',
  jsonb_build_array(
    'I grew up as a multi-sport athlete — competing in track and field, football, and basketball through college. Along the way, I experienced firsthand what it is like to train without proper guidance. Nagging injuries, plateaus, and burnout were constant companions.',
    'When I discovered the science of athletic performance — periodization, biomechanics, and sport psychology — everything changed. I realized that with the right approach, athletes could train harder while staying healthier and performing at levels they never thought possible.',
    'That realization became my mission. I went back to school for Exercise Science, earned my certifications, and started coaching. DJP Athlete is the culmination of everything I have learned — a platform where every athlete, regardless of level, can access the coaching and tools they need to reach their full potential.'
  )
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

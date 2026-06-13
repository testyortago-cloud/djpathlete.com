-- 00169_step_up_page_content.sql
--
-- Single-row content table for the "Packages" section of the public
-- /step-up-for-students page. Lets the coach edit the section eyebrow,
-- heading, intro, and the package cards from /admin/marketing/step-up without
-- a code deploy. Mirrors the athletes_page_content (00163) shape.

CREATE TABLE IF NOT EXISTS public.step_up_page_content (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Packages section heading
  packages_eyebrow TEXT NOT NULL DEFAULT 'Scholarship-Ready Packages',
  packages_heading TEXT NOT NULL DEFAULT 'Packages Designed for Step Up Families',
  packages_intro TEXT NOT NULL DEFAULT 'Every package is structured to align with Step Up''s quarterly funding cycle and can be billed directly through the EMA portal — no out-of-pocket payment required for eligible families.',

  -- Array of package objects, each: { badge, title, desc, items[], cta, featured }
  packages JSONB NOT NULL DEFAULT '[]'::jsonb,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-bump updated_at on every UPDATE
CREATE OR REPLACE FUNCTION public.step_up_page_content_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_step_up_page_content_updated_at ON public.step_up_page_content;
CREATE TRIGGER trg_step_up_page_content_updated_at
  BEFORE UPDATE ON public.step_up_page_content
  FOR EACH ROW EXECUTE FUNCTION public.step_up_page_content_set_updated_at();

ALTER TABLE public.step_up_page_content ENABLE ROW LEVEL SECURITY;
-- Service-role only: all access is via the DAL with the service-role client.

-- Seed with current production copy so the page renders identically until the
-- coach changes something.
INSERT INTO public.step_up_page_content (id, packages)
VALUES (
  1,
  jsonb_build_array(
    jsonb_build_object(
      'badge', 'Entry Point · One-Time',
      'title', 'Athletic Performance Assessment',
      'desc', 'The diagnostic foundation. Understand exactly where your athlete is — and where they need to go — before committing to a program.',
      'items', jsonb_build_array(
        'Speed & acceleration testing (10/40-yard)',
        'Vertical jump & power output',
        'Agility & change-of-direction testing',
        'Movement quality & mobility screen',
        'Personalized performance report',
        '30-min parent consultation'
      ),
      'cta', 'Book Assessment',
      'featured', false
    ),
    jsonb_build_object(
      'badge', '★ Most Popular',
      'title', 'Hybrid Performance Package',
      'desc', 'A hybrid of in-person sessions, small-group training, and online app-based programming — built around your athlete''s goals, sport, and competition schedule. Aligns with quarterly scholarship disbursements.',
      'items', jsonb_build_array(
        'In-person performance sessions',
        'Small-group training',
        'Online app-based sessions & programming',
        'Individualized program design',
        'Monthly progress re-testing',
        'Parent progress updates',
        'Direct EMA billing available'
      ),
      'cta', 'Get Started',
      'featured', true
    ),
    jsonb_build_object(
      'badge', 'Clinic · Aligned to Funding Quarter',
      'title', 'Agility Clinic',
      'desc', 'A structured agility clinic to develop speed, reaction, and movement confidence — run in blocks that line up with each scholarship disbursement.',
      'items', jsonb_build_array(
        'Pre- and post-clinic agility testing',
        'Sport-specific change-of-direction drills',
        'Reaction & decision-making work',
        'Runs as a clinic aligned to each funding quarter',
        'Small-group or individual format'
      ),
      'cta', 'Enquire',
      'featured', false
    ),
    jsonb_build_object(
      'badge', 'Homeschool · Year-Round',
      'title', 'Homeschool Athlete PE Program',
      'desc', 'Structured athletic development designed specifically for homeschool families. Fulfils PE requirements with measurable, documented progress.',
      'items', jsonb_build_array(
        'Weekly structured training sessions',
        'PE-standard documentation & reporting',
        'Athletic skill progression tracking',
        'Year-round enrollment available',
        'Social group training environment',
        'PEP scholarship-aligned billing'
      ),
      'cta', 'Book a Spot',
      'featured', false
    )
  )
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

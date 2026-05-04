-- Phase 1.4 — extend prompt_templates with 'google_ads_copy' category and
-- seed Darren's brand-voice prompt for ad-variant generation. The voice
-- profile sits in 'voice_profile' rows; this row is the channel-specific
-- adapter (RSA character limits, response-direct CTAs, etc).

ALTER TABLE prompt_templates DROP CONSTRAINT prompt_templates_category_check;

ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_category_check
  CHECK (category IN (
    'structure', 'session', 'periodization', 'sport', 'rehab', 'conditioning', 'specialty',
    'voice_profile', 'social_caption', 'blog_generation', 'blog_research', 'newsletter',
    'google_ads_copy'
  ));

INSERT INTO prompt_templates (name, category, scope, description, prompt)
VALUES (
  'DJP Athlete — Google Ads Responsive Search Ad Copy',
  'google_ads_copy',
  'global',
  'Brand-voiced headlines + descriptions for Google Ads RSAs. Generated as add_ad_variant recommendations after each nightly sync. Edit during voice calibration.',
  'You write Google Ads Responsive Search Ad copy as DJP Athlete — a strength coach focused on rotational power, comeback training, and performance development for athletes.

Voice: direct, confident, technically precise. Active voice. No hype, no generic fitness tropes.

Hard format constraints (Google Ads RSA limits):
- Headlines: 30 characters max each, 3-15 headlines per ad
- Descriptions: 90 characters max each, 2-4 descriptions per ad
- Final URL: must be a real DJP Athlete URL (darrenjpaul.com or a known sub-path)

Quality bar:
- Reference specific programs (Comeback Code, Rotational Reboot) when the keyword theme aligns
- Lead with athlete-specific outcomes (rotational power, return-from-injury, sport-specific strength)
- One CTA-style headline ("Get assessed", "Book a session", "See programs")
- Avoid superlatives without evidence ("the best", "guaranteed")
- Never invent credentials, certifications, or testimonials'
)
ON CONFLICT DO NOTHING;

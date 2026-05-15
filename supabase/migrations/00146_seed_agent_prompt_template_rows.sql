-- supabase/migrations/00146_seed_agent_prompt_template_rows.sql
-- Empty prompt_templates rows for the SEO and Ads agents to read
-- few_shot_examples from. The `prompt` column is intentionally a
-- placeholder — agent system prompts live in code. These rows exist
-- purely as a carrier for the performance-learning-loop to write into.
--
-- The chief_strategist already has a seeded row at (global,
-- chief_strategist) from migration 00141, so it is NOT re-seeded here —
-- we reuse it. Likewise, social-caption rows already exist per-platform
-- under category='social_caption' and the loop already writes to them.
--
-- Notes:
-- * prompt_templates has NO unique constraint on (scope, category), so
--   idempotency uses WHERE NOT EXISTS rather than ON CONFLICT.
-- * `name` and `description` are NOT NULL — supply both.
-- * The category CHECK constraint must be widened first to accept
--   the new 'seo_agent' and 'ads_agent' categories.

ALTER TABLE prompt_templates
  DROP CONSTRAINT prompt_templates_category_check;

ALTER TABLE prompt_templates
  ADD CONSTRAINT prompt_templates_category_check
  CHECK (category = ANY (ARRAY[
    'structure', 'session', 'periodization', 'sport', 'rehab',
    'conditioning', 'specialty', 'voice_profile', 'social_caption',
    'social_caption_reviewer', 'blog_generation', 'blog_research',
    'newsletter', 'google_ads_copy',
    'performance_critic', 'chief_strategist',
    'seo_agent', 'ads_agent'
  ]));

INSERT INTO prompt_templates (name, scope, category, description, prompt, few_shot_examples)
SELECT
  'SEO Agent — Few-Shot Carrier',
  'global',
  'seo_agent',
  'Empty carrier row whose few_shot_examples column is populated by the performance-learning-loop with top-performing SEO actions. The system prompt itself lives in functions/src/seo/reason.ts.',
  '(system prompt lives in code at functions/src/seo/reason.ts)',
  '[]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_templates WHERE scope = 'global' AND category = 'seo_agent'
);

INSERT INTO prompt_templates (name, scope, category, description, prompt, few_shot_examples)
SELECT
  'Ads Agent — Few-Shot Carrier',
  'global',
  'ads_agent',
  'Empty carrier row whose few_shot_examples column is populated by the performance-learning-loop with top-performing Ads actions. The system prompt itself lives in lib/ads/agent/reason.ts.',
  '(system prompt lives in code at lib/ads/agent/reason.ts)',
  '[]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_templates WHERE scope = 'global' AND category = 'ads_agent'
);

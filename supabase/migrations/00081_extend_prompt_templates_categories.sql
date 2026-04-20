-- supabase/migrations/00081_extend_prompt_templates_categories.sql

-- Drop existing category CHECK, add a broader one that includes AI automation categories
ALTER TABLE prompt_templates DROP CONSTRAINT prompt_templates_category_check;

ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_category_check
  CHECK (category IN (
    'structure', 'session', 'periodization', 'sport', 'rehab', 'conditioning', 'specialty',
    'voice_profile', 'social_caption', 'blog_generation', 'blog_research', 'newsletter'
  ));

-- Extend scope CHECK to include AI automation scopes
ALTER TABLE prompt_templates DROP CONSTRAINT prompt_templates_scope_check;

ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_scope_check
  CHECK (scope IN (
    'week', 'day', 'both',
    'global', 'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin', 'blog', 'newsletter'
  ));

-- Seed one default voice profile row (coach edits it during Phase 1 brand voice session)
INSERT INTO prompt_templates (name, category, scope, description, prompt)
VALUES (
  'DJP Athlete — Default Voice Profile',
  'voice_profile',
  'global',
  'Brand voice profile applied to every AI-generated piece of content. Edit during kickoff session.',
  'You write as DJP Athlete — a strength coach focused on rotational power, comeback training, and performance development for athletes. Voice: direct, confident, technically precise. Prefer active voice. Avoid hype language and generic fitness tropes. Reference specific exercises, programs (Comeback Code, Rotational Reboot), and training concepts from the exercise library when relevant. Never use client names or personal details without explicit permission.'
);

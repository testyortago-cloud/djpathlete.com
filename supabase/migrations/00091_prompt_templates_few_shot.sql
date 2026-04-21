-- supabase/migrations/00091_prompt_templates_few_shot.sql
-- Phase 5f — Performance Learning Loop.
--
-- Adds a JSONB column to prompt_templates that stores top-performing real
-- examples, populated weekly by the performanceLearningLoop Firebase
-- Function. Additive only — existing rows default to an empty array.

ALTER TABLE prompt_templates
  ADD COLUMN few_shot_examples jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prompt_templates.few_shot_examples IS
  'Top-performing real examples for this prompt. Populated weekly by the performanceLearningLoop Firebase Function when category = social_caption. Array of { caption, platform, engagement, impressions, recorded_at, social_post_id }.';

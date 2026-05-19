ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS cover_image_meta JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN blog_posts.cover_image_meta IS
  'Reproducibility metadata for cover_image_url: { seed, model, prompt, prompt_version, quality_score, quality_reasons, judge_failed, attempts }. Inline image equivalents live in the inline_images JSONB array.';

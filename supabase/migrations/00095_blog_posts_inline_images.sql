-- Track inline images per post for regeneration logic and SEO ImageObject schema.
-- Each entry: { url, alt, prompt, section_h2, width, height }

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS inline_images JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN blog_posts.inline_images IS
  'Array of inline images generated for this post. Used for regeneration and ImageObject schema.';

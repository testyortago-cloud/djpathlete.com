-- supabase/migrations/00111_blog_faq_subcategory.sql
-- Phase 3 of blog-generation-quality rollout.
-- (1) Adds FAQ + subcategory columns to blog_posts.
-- (2) Updates the structural blog_generation prompt_templates row to instruct
--     the model to emit a 3-5 entry faq array. Subcategory is optional and
--     not part of the AI output schema — it's a coach-facing field on the
--     edit form.

-- ─── (1) Schema additions ───────────────────────────────────────────────────

ALTER TABLE blog_posts
  ADD COLUMN faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN subcategory text;

CREATE INDEX idx_blog_posts_subcategory ON blog_posts(subcategory) WHERE subcategory IS NOT NULL;

COMMENT ON COLUMN blog_posts.faq IS
  'Array of { question, answer } pairs rendered as <details> blocks and emitted as FAQPage JSON-LD.';
COMMENT ON COLUMN blog_posts.subcategory IS
  'Free-text topical sub-classification (e.g. "Nutrition", "Mindset"). Complements the 4-value category enum without bloating it.';

-- ─── (2) Update structural prompt to include FAQ in the output schema ───────

UPDATE prompt_templates
SET prompt = $prompt$# OUTPUT SCHEMA
You must output a JSON object with these fields ONLY:
- title: 50-60 chars, SEO-friendly, primary keyword in first half (when supplied)
- slug: URL-friendly lowercase with hyphens, max 200 chars
- excerpt: 140-180 chars, includes primary keyword if supplied
- content: Full HTML body (rules below)
- category: One of "Performance" | "Recovery" | "Coaching" | "Youth Development"
- tags: 3-5 lowercase keyword tags
- meta_description: 140-150 chars (hard cap 160)
- faq: Array of 3-5 objects, each with: { question, answer }. Questions are 5-200 chars; answers are 20-800 chars. Cover real questions a reader would type into Google after reading the post. Don't repeat content already covered in the body — go deeper. The first FAQ should target the primary keyword.

# HTML RULES — content field
Allowed tags ONLY: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <u>, <a href="...">
- No <h1> (the title field is rendered as h1 by the template)
- No <br>, no inline styles, no class attrs, no <div> wrappers
- Each paragraph in its own <p>
- Max 3 sentences per <p>
- Insert one <h2> every 200-300 words
- One bulleted or ordered list every 2 sections
- One blockquote with a coach-voice take in the second half

# LENGTH PRESETS
- short:  ~500 words, 3-4 h2 sections
- medium: ~1000 words, 5-6 h2 sections
- long:   ~1500 words, 7-8 h2 sections

# SOURCING (mandatory)
- The author may provide their own research material (crawled web pages, notes, uploaded documents). When present, these are PRIMARY sources — cite from them first.
- Auto-discovered research papers, when present, supplement primary sources.
- You MUST cite from provided sources using their EXACT URLs.
- Do NOT invent, guess, or fabricate any DOI links, PubMed URLs, or research paper URLs that were not provided to you.
- You MAY ALSO cite well-known organization pages you are confident exist (WHO, NSCA, ACSM).
- Include 3-4 inline <a href="..."> source references per post, placed naturally where claims are made.
- Link text describes what the source says — never just an organization name or "click here".
- Always end with a "References" or "Further Reading" h2 listing the cited papers/sources by full title.
- All URLs are validated post-generation. Any link returning 404 is removed.

# FAQ GUIDANCE
- 3-5 entries minimum.
- Phrase questions exactly as a reader would type them ("How long should I rest between sets?", not "Optimal rest periods").
- Answers are concise: 1-3 sentences each. Refer to the body if a fuller treatment exists there ("see the section above on...") but never copy-paste body content.
- Avoid yes/no questions unless the answer is genuinely binary; prefer "How", "When", "Why", "What" framings.
- The first FAQ entry MUST target the primary keyword (when one is supplied via SEO TARGET).

Output ONLY the JSON object, no preamble.$prompt$,
    updated_at = now()
WHERE name = 'DJP Athlete — Blog Generation Structure'
  AND category = 'blog_generation';

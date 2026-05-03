-- supabase/migrations/00108_blog_generation_prompt_template.sql
-- Phase 1 of blog-generation-quality rollout.
-- Adds the blog_generation prompt_templates row that holds OUTPUT/STRUCTURE
-- rules for the blog generator. Voice/persona stays in the existing
-- voice_profile row from migration 00081.

INSERT INTO prompt_templates (name, category, scope, description, prompt)
VALUES (
  'DJP Athlete — Blog Generation Structure',
  'blog_generation',
  'global',
  'Output schema, HTML rules, length presets, and sourcing requirements for AI-generated blog posts. Voice/tone is loaded separately from the voice_profile row.',
  $prompt$# OUTPUT SCHEMA
You must output a JSON object with these fields ONLY:
- title: 50-60 chars, SEO-friendly, primary keyword in first half (when supplied)
- slug: URL-friendly lowercase with hyphens, max 200 chars
- excerpt: 140-180 chars, includes primary keyword if supplied
- content: Full HTML body (rules below)
- category: One of "Performance" | "Recovery" | "Coaching" | "Youth Development"
- tags: 3-5 lowercase keyword tags
- meta_description: 140-150 chars (hard cap 160)

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

Output ONLY the JSON object, no preamble.$prompt$
);

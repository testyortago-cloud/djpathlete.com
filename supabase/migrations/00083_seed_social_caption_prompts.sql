-- supabase/migrations/00083_seed_social_caption_prompts.sql
-- Seeds one social_caption prompt template per platform. The fanout function
-- reads these rows by scope to build platform-specific caption prompts.

INSERT INTO prompt_templates (name, category, scope, description, prompt) VALUES
(
  'Facebook Caption Style',
  'social_caption',
  'facebook',
  'Facebook Page post style — longer form, conversational, includes CTA and link where relevant.',
  'Write a Facebook Page post (120-250 words). Structure: a hook in the first line, 2-3 short paragraphs of insight drawn from the video transcript, then a CTA to the DJP Athlete website or relevant program (Comeback Code for injury return, Rotational Reboot for rotational athletes). Voice: direct, confident, coach-to-coach. Use short paragraphs separated by blank lines. Do NOT include hashtags (Facebook users do not engage with hashtags — keep them in the metadata only, 3-5 max). Return: caption_text (the post body) and hashtags (3-5 relevant fitness/sports hashtags).'
),
(
  'Instagram Caption Style',
  'social_caption',
  'instagram',
  'Instagram caption style — hook-driven, structured bullets, strong CTA, 20-30 hashtags.',
  'Write an Instagram caption (maximum 2200 chars). Structure: (1) hook line that stops the scroll, (2) 3-5 short benefit bullets using → arrow prefix, (3) a save/share prompt, (4) CTA to link-in-bio. Voice: punchy, authoritative, athlete-focused. Keep lines short with blank lines between sections for readability. Return: caption_text without hashtags appended, and hashtags array with 20-30 niche-relevant tags (mix of rotational/sport-specific/coaching/training/recovery — avoid generic #fitness #gym).'
),
(
  'TikTok Caption Style',
  'social_caption',
  'tiktok',
  'TikTok short-form caption — one-line hook optimised for the TikTok algorithm.',
  'Write a TikTok caption (50-150 chars). Structure: one conversational hook line that plays off the video content. Optionally add one short follow-up sentence. Voice: casual, direct, speaking TO the viewer. Return: caption_text and hashtags array with 5-8 trending/niche tags (mix a broad discovery tag like #fyp or #athletetok with 4-6 niche sport-specific ones).'
),
(
  'YouTube Long-form Caption Style',
  'social_caption',
  'youtube',
  'YouTube long-form video title + description. Title on line 1 (<=100 chars), double newline, then description.',
  'Generate a YouTube long-form video package for a coaching video. Output MUST be: line 1 = a click-worthy, SEO-friendly TITLE (max 100 chars, include a specific exercise or concept). Then a blank line. Then a 300-500 word DESCRIPTION with: a hook paragraph, 2-3 key takeaways as bullet points, timestamps placeholder ("Chapters:\n00:00 Intro\n..."), links to DJP Athlete programs at the bottom. Voice: educational, thorough, referencing real coaching experience. Return: caption_text = "TITLE\n\nDESCRIPTION", and hashtags array with 10-15 YouTube tags for discovery.'
),
(
  'YouTube Shorts Caption Style',
  'social_caption',
  'youtube_shorts',
  'YouTube Shorts title-as-caption — very short, vertical-video friendly, #Shorts injected automatically by the plugin.',
  'Write a YouTube Shorts title + description (the TITLE becomes line 1, the description appears below). Format: "TITLE (max 60 chars)\n\nDESCRIPTION (1-2 sentences explaining the drill or concept, max 150 chars)". Voice: direct, hook-first. Return: caption_text formatted as "TITLE\n\nDESCRIPTION", and 3-5 niche hashtags (the plugin auto-adds #Shorts — do NOT include #Shorts in your output).'
),
(
  'LinkedIn Caption Style',
  'social_caption',
  'linkedin',
  'LinkedIn Company Page post — professional tone, insight-driven, 150-300 words.',
  'Write a LinkedIn Company Page post (150-300 words). Structure: a professional hook framing a coaching problem or observation, 2-3 short paragraphs of expert insight drawn from the video transcript, then a CTA to DJP Athlete services or relevant program. Voice: authoritative, peer-to-peer (coach-to-coach), not overly casual. Avoid fitness-bro slang. Use line breaks between paragraphs. Return: caption_text and hashtags array with 3-5 industry-relevant tags (e.g. #StrengthAndConditioning, #AthleteDevelopment, not generic #Fitness).'
);

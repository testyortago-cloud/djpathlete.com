export type CaptionPlatform = "instagram" | "facebook" | "tiktok" | "linkedin"

const BASE_SYSTEM = `You are writing social-media captions for Darren Paul, a performance/coaching brand. Tone is direct, motivational, no medical claims, no fabricated personal records, no specific numbers unless the user provided them.`

const PLATFORM_RULES: Record<CaptionPlatform, string> = {
  instagram: `Platform: Instagram.
- Hook: one tight opener line.
- Body: 2-4 short lines.
- Hashtags: 5-10, lowercase, single-word, no punctuation.
- Max caption length: 2200 chars; aim for ~600.`,
  facebook: `Platform: Facebook.
- Conversational, 2-3 sentences.
- Write WITHOUT hashtags (no hashtags whatsoever).
- End with a question or a soft CTA.
- Max caption length: 5000 chars; aim for ~400.`,
  tiktok: `Platform: TikTok.
- Hook-first: the first line must be ≤ 60 chars and grab attention.
- Body: 1-2 short follow-up lines.
- Hashtags: 3-5, lowercase, single-word.
- Max caption length: 2200 chars; aim for ~300.`,
  linkedin: `Platform: LinkedIn.
- Professional tone with story arc.
- 3-6 sentences, paragraph breaks welcome.
- Hashtags: 0-3, PascalCase or lowercase, single-word.
- Max caption length: 3000 chars; aim for ~800.`,
}

const CAROUSEL_NOTE = `These images form a sequence. Reference the progression — e.g., "swipe to see…", "from setup to finish", or "frame by frame". Do not describe each image; capture the arc.`

const SINGLE_NOTE = `One image. Write a caption rooted in what's visible.`

const OUTPUT_RULE = `Return ONLY a JSON object:
{ "caption": "<the caption>", "hashtags": ["<tag1>", "<tag2>", ...], "cta": "<optional short CTA or null>" }
Rules:
- hashtags lowercase, single-word, no '#'.
- caption must not exceed the platform max.
- No preamble. No markdown fence. JSON only.`

export function buildCaptionPrompt(platform: CaptionPlatform, imageCount: number): string {
  const seq = imageCount > 1 ? CAROUSEL_NOTE : SINGLE_NOTE
  return [BASE_SYSTEM, PLATFORM_RULES[platform], seq, OUTPUT_RULE].join("\n\n")
}

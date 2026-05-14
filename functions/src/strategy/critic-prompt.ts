import type { CriticInputs } from "./critic-signals.js"

export const CRITIC_SYSTEM_PROMPT = `You are the Performance Critic for the Darren J Paul Athlete brand.

Your job: synthesize the past four weeks of cross-channel agent memos + booking attribution + funnel data into a single weekly signal row. You read SEO, Ads, and Social agent memos uniformly; you DO NOT make new actions. Your output becomes the primary input for next Sunday's Chief Strategist.

Priorities (in order):
1. North-star: bookings + revenue via marketing_attribution.
2. Compounding: identify what's been working multi-week, not one-off blips.
3. Anomalies worth investigating: sudden CAC moves, organic-traffic spikes/drops, hook-engagement outliers.

Return JSON only matching this shape:
{
  "winners": [{ "channel": "seo|ads|social", "what": "...", "evidence": "..." }],
  "losers": [{ "channel": "...", "what": "...", "evidence": "..." }],
  "anomalies": [{ "what": "...", "evidence": "..." }],
  "attribution_summary": { "<channel>": { "bookings": <int>, "revenue": <num>, "trend_vs_prior_week": "up|down|flat" } },
  "recommendations_for_brief": ["specific direction for next week's brief"],
  "rationale": "2-3 paragraphs explaining the call"
}`

export function buildCriticUserMessage(input: CriticInputs): string {
  return [
    `Week of: ${input.weekOf}`,
    "",
    `SEO memos: ${input.seoMemos.length}`,
    `Ads memos: ${input.adsMemos.length}`,
    `Social memos: ${input.socialMemos.length}`,
    `Voice drift flags (last 28d): ${input.voiceFlags.length}`,
    `Prior signals (${input.priorSignals.length}):`,
    JSON.stringify(input.priorSignals, null, 2),
    "",
    "Attribution by channel (last 28d):",
    JSON.stringify(input.attribution, null, 2),
    "",
    "Funnel (last 28d):",
    JSON.stringify(input.funnel, null, 2),
    "",
    "SEO memos:",
    JSON.stringify(input.seoMemos, null, 2),
    "",
    "Ads memos:",
    JSON.stringify(input.adsMemos, null, 2),
    "",
    "Social memos:",
    JSON.stringify(input.socialMemos, null, 2),
    "",
    "Return JSON only.",
  ].join("\n")
}

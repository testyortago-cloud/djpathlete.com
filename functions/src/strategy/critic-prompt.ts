import type { CriticInputs } from "./critic-signals.js"

export const CRITIC_SYSTEM_PROMPT = `You are the Performance Critic for the Darren J Paul Athlete brand.

Your job: synthesize the past four weeks of cross-channel agent memos + first-touch attribution into a single weekly signal row. You read SEO, Ads, and Social agent memos uniformly; you DO NOT make new actions. Your output becomes the primary input for next Sunday's Chief Strategist.

What the attribution data is: visitor SESSIONS counted by the channel each session first arrived through (google_ads, meta_ads, a UTM source such as newsletter or instagram, referral, direct), and how many of those sessions became LEADS (the visitor applied, registered or subscribed). It does not measure bookings or revenue. Never infer bookings or revenue from it; if a memo reports them, cite that memo as the source.

Priorities (in order):
1. North-star: bookings + revenue, as the memos report them. Leads by channel are the nearest measured step toward them.
2. Compounding: identify what's been working multi-week, not one-off blips.
3. Anomalies worth investigating: sudden CAC moves, organic-traffic spikes/drops, hook-engagement outliers.

Return JSON only matching this shape:
{
  "winners": [{ "channel": "seo|ads|social", "what": "...", "evidence": "..." }],
  "losers": [{ "channel": "...", "what": "...", "evidence": "..." }],
  "anomalies": [{ "what": "...", "evidence": "..." }],
  "attribution_summary": { "<channel>": { "sessions": <int>, "leads": <int>, "trend_vs_prior_week": "up|down|flat|unknown" } },
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
    "Sessions and leads by first-touch channel (last 28d):",
    JSON.stringify(input.attribution, null, 2),
    "",
    "Sessions and leads, all channels (last 28d):",
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

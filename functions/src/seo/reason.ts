// functions/src/seo/reason.ts
// The single Claude call that picks two ranked actions for the week.

import { callAgent, MODEL_SONNET } from "../ai/anthropic.js"
import { decisionSchema, type Decision } from "./decision-schema.js"
import type { SeoSignalsSummary } from "./signals.js"

export const SYSTEM_PROMPT = `You are the SEO strategist for darrenjpaul.com — a strength & conditioning coach's site. Your job each Sunday is to pick the two highest-leverage SEO actions for the coming week.

You see fused signals: Google Search Console performance, the blog inventory, prior Tavily topic suggestions, orphan posts with no inbound internal links, and the outcomes of your previous 8 decisions.

Rules:
1. Output exactly two actions, ranked by leverage (rank 1 = highest, rank 2 = second highest).
2. The two actions MUST be of different types. No two refreshes, no two new posts, etc.
3. Each action must be justified in one sentence inside its args.reason field (for queue_refresh) or via the action's nature (for the others). The overall pair must be justified in a 2-5 sentence top-level rationale.
4. Prefer actions whose outcome you can measure. Avoid actions whose outcome is purely qualitative.
5. If the outcomes table shows a tactic underperforming (e.g., refreshes producing no clicks delta), shift weight to other tactics this week.

The four tools available to you:

  queue_new_post(keyword, angle, references?)
    Drops a topic_suggestion row that autoBlogCron picks up on Tuesday or Thursday.
    Use for: striking-distance keywords (avg position 8-20, ≥50 impressions in last 28d)
    where no published post already targets that keyword.

  queue_refresh(blog_post_id, reason)
    Enqueues a refresh of an existing post. Produces a draft for coach review.
    Use for: posts with position_drop ≥5 over the last 28d, OR posts >6 months old
    that haven't been refreshed in 90+ days.

  queue_internal_link_sweep(target_blog_post_id, candidate_anchor_post_ids[])
    Inserts up to 2 inbound links from candidate posts into the target.
    Use for: posts in orphan_post_ids (no inbound links from other posts) that you
    want to lift. Pick candidate posts from the inventory that are topically related.

  flag_for_human(issue, urgency, context)
    Creates an admin notification. Use only when you spot something that needs
    human judgment — cannibalization, schema breakage, off-brand content drift.
    Use sparingly; this is the escape hatch, not a default action.

Output a JSON object matching this shape exactly:
{
  "rationale": "<2-5 sentences explaining why these two actions, in this combination, are the highest-leverage moves this week>",
  "actions": [
    { "rank": 1, "tool": "<tool_name>", "args": { ... }, "complementary_to_rank_1": "optional reason" },
    { "rank": 2, "tool": "<different_tool_name>", "args": { ... }, "complementary_to_rank_1": "why this complements rank 1" }
  ]
}`

export async function reasonAboutWeek(signals: SeoSignalsSummary): Promise<{ decision: Decision; tokens_used: number }> {
  const briefBlock = signals.brief_context
    ? [
        "Brief context (bias your action ranking toward themes + keywords; treat dont_do as hard guardrail):",
        JSON.stringify(signals.brief_context, null, 2),
        "",
        "If you align well with the brief, set brief_alignment_score 7-10. If you deviate (with reason), 4-6. Ignoring the brief entirely is 1-3.",
        "",
      ].join("\n")
    : "(No approved brief this week — reason freely. Set brief_alignment_score to null.)\n"

  const userMessage = `${briefBlock}
Here is the current state of darrenjpaul.com SEO. Pick the two highest-leverage actions for this week.

\`\`\`json
${JSON.stringify(signals, null, 2)}
\`\`\`

Return ONLY the JSON object — no commentary outside it.`
  const result = await callAgent(SYSTEM_PROMPT, userMessage, decisionSchema, { model: MODEL_SONNET })
  return { decision: result.content, tokens_used: result.tokens_used }
}

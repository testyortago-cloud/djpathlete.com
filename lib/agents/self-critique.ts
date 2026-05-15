// lib/agents/self-critique.ts
// Mirror of functions/src/lib/self-critique.ts for the Next.js-side Ads agent.
// Cheap Haiku second-pass critique. Each agent's reason step calls this
// after the main Sonnet call. If overall='should_revise' AND the original
// plan's agent_confidence <= 7, the caller re-runs the main reason once
// with the objections appended.

import { z } from "zod"
import { callAgent, MODEL_HAIKU } from "@/lib/ai/anthropic"

const critiqueSchema = z.object({
  objections: z.array(z.string()).max(6),
  overall: z.enum(["sound", "minor_concern", "should_revise"]),
})

export type CritiqueResult = z.infer<typeof critiqueSchema>

const SYSTEM_PROMPT = `You are a critic. A reasoning agent has produced a plan. Your job: poke holes in it.

Read the plan, signals, and brief context. Identify the strongest 2-4 objections — places where the plan is overconfident, ignores a signal, or chooses a historically weak tactic. If you find nothing serious, say "sound".

Output:
{
  "objections": ["<one-sentence objection>", ...],
  "overall": "sound | minor_concern | should_revise"
}

Be specific. Vague objections like "could be better" do not help. Cite the signal or tool name you're objecting about.`

export interface RunSelfCritiqueInput {
  planSummary: string
  signalsSummary: string
  briefSummary: string | null
}

export async function runSelfCritique(input: RunSelfCritiqueInput): Promise<CritiqueResult> {
  const userMessage = [
    "Plan being critiqued:",
    "---",
    input.planSummary,
    "---",
    "",
    "Signals the plan was based on (truncated):",
    "---",
    input.signalsSummary.slice(0, 4000),
    "---",
    "",
    input.briefSummary ? `Brief context:\n${input.briefSummary}` : "(No brief this week.)",
    "",
    "Critique the plan. Return JSON only.",
  ].join("\n")

  const { content } = await callAgent(SYSTEM_PROMPT, userMessage, critiqueSchema, {
    model: MODEL_HAIKU,
    maxTokens: 600,
  })
  return content
}

/**
 * Heuristic: should the agent re-run its main reason step in response to this critique?
 * Re-run only when the original confidence is shaky AND critique flags a clear concern.
 * One re-run cap; no recursion.
 */
export function shouldReRunAfterCritique(
  critique: CritiqueResult,
  originalConfidence: number,
): boolean {
  return critique.overall === "should_revise" && originalConfidence <= 7
}

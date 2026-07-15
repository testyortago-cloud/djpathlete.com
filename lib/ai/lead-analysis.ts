import { z } from "zod"
import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"

export const leadAnalysisSchema = z.object({
  priority: z.enum(["high", "medium", "low"]),
  priority_reason: z.string().min(1).max(220),
  summary: z.string().min(1).max(600),
  draft_reply: z.string().min(1).max(900),
})

export type LeadAnalysisResult = z.infer<typeof leadAnalysisSchema>

const SYSTEM_PROMPT = `You are helping Coach Darren, owner of DJP Athlete, triage and respond to new coaching inquiries submitted through his website. You will be given the raw details someone submitted through the inquiry form.

Return:
1. priority: "high" | "medium" | "low" — how promising/ready-to-book this lead looks. High = clear goals, ready to commit, no ambiguity. Medium = interested but vague, or has open questions. Low = very thin information, likely just browsing, or a mismatch for what DJP Athlete offers.
2. priority_reason: one sentence (under 25 words), in plain language, explaining the priority call and referencing something specific from what they wrote. If they mentioned an injury or physical limitation, surface it here — Darren needs to see that immediately.
3. summary: 2-3 sentences a busy coach can read in five seconds to understand who this lead is and what they want.
4. draft_reply: a warm, ready-to-send email reply FROM Darren TO the lead, under 120 words. Reference their specific goals/sport by name, don't invent facts not present in the submission, and end by inviting them to book a call. Sign off as "Coach Darren, DJP Athlete".

Be direct and specific — avoid generic filler. This is a real business email, not a template.`

export interface LeadAnalysisInput {
  name: string
  serviceLabel: string
  sport?: string | null
  experience?: string | null
  goals: string
  injuries?: string | null
  howHeard?: string | null
}

export async function generateLeadAnalysis(input: LeadAnalysisInput) {
  const userMessage = [
    `Name: ${input.name}`,
    `Service requested: ${input.serviceLabel}`,
    input.sport ? `Sport: ${input.sport}` : null,
    input.experience ? `Experience level: ${input.experience}` : null,
    input.injuries ? `Injuries/limitations: ${input.injuries}` : null,
    input.howHeard ? `How they heard about us: ${input.howHeard}` : null,
    `Goals (in their own words):\n${input.goals}`,
  ]
    .filter(Boolean)
    .join("\n")

  return callAgent(SYSTEM_PROMPT, userMessage, leadAnalysisSchema, { model: MODEL_SONNET, maxTokens: 1200 })
}

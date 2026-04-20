// functions/src/tavily-fact-check.ts
// Firebase Function: verifies generated blog content against a research brief.
// Called standalone via type "tavily_fact_check" OR in-process from
// handleBlogFromVideo. Returns a list of flagged (unverifiable/contradicted)
// claims and a coarse fact_check_status.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import type { TavilyResearchBrief } from "./lib/research-brief.js"

export type FactCheckStatus = "passed" | "flagged" | "failed"

export interface FactCheckFlaggedClaim {
  claim: string
  span_start: number | null
  span_end: number | null
  source_urls_checked: string[]
  verdict: "unverifiable" | "contradicted"
  notes: string
}

export interface FactCheckDetails {
  flagged_claims: FactCheckFlaggedClaim[]
  generated_at: string
  model: string
}

export interface TavilyFactCheckInput {
  content: string
  brief: TavilyResearchBrief
  blog_post_id?: string
  max_claims?: number
}

export interface TavilyFactCheckResult {
  fact_check_status: FactCheckStatus
  details: FactCheckDetails
}

interface BuildPromptParams {
  content: string
  brief: TavilyResearchBrief
  maxClaims: number
}

export function buildFactCheckPrompt({ content, brief, maxClaims }: BuildPromptParams): string {
  const extractsSection = brief.extracted
    .map((e) => `SOURCE ${e.url}:\n${e.content.slice(0, 4000)}`)
    .join("\n\n")
  const resultsSection = brief.results
    .map((r) => `- ${r.title} (${r.url}) — ${r.snippet}`)
    .join("\n")

  return [
    "# CONTENT TO FACT-CHECK",
    content,
    "",
    "# RESEARCH BRIEF",
    `Topic: ${brief.topic}`,
    brief.summary ? `Summary: ${brief.summary}` : "",
    "",
    "## Sources",
    resultsSection,
    "",
    "## Extracted source content",
    extractsSection,
    "",
    "# INSTRUCTIONS",
    `Identify claims in the content that cannot be verified against the research brief above. Return a JSON array of flagged claims, max ${maxClaims} claims. Include only claims you can confidently mark as "unverifiable" (no supporting source) or "contradicted" (a source explicitly disagrees). Skip claims that are verified — do NOT include them.`,
  ]
    .filter(Boolean)
    .join("\n")
}

export function classifyStatus(flaggedCount: number): FactCheckStatus {
  if (flaggedCount === 0) return "passed"
  if (flaggedCount <= 5) return "flagged"
  return "failed"
}

const FactCheckResponseSchema = z.object({
  flagged_claims: z.array(
    z.object({
      claim: z.string(),
      span_start: z.number().nullable(),
      span_end: z.number().nullable(),
      source_urls_checked: z.array(z.string()),
      verdict: z.enum(["unverifiable", "contradicted"]),
      notes: z.string(),
    }),
  ),
})

export async function runFactCheck(input: TavilyFactCheckInput): Promise<TavilyFactCheckResult> {
  const maxClaims = input.max_claims ?? 10
  const prompt = buildFactCheckPrompt({ content: input.content, brief: input.brief, maxClaims })

  const result = await callAgent(
    "You are a rigorous fact-checker. Respond with a JSON object matching the schema the user requests. Do not fabricate sources.",
    prompt,
    FactCheckResponseSchema,
    { model: MODEL_SONNET },
  )

  const flagged = result.content.flagged_claims.slice(0, maxClaims)
  const status = classifyStatus(flagged.length)

  return {
    fact_check_status: status,
    details: {
      flagged_claims: flagged,
      generated_at: new Date().toISOString(),
      model: MODEL_SONNET,
    },
  }
}

export async function handleTavilyFactCheck(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) {
      await failJob("ai_jobs doc disappeared")
      return
    }

    const input = data.input as TavilyFactCheckInput
    if (!input?.content || !input?.brief) {
      await failJob("input.content and input.brief are required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const result = await runFactCheck(input)

    if (input.blog_post_id) {
      const supabase = getSupabase()
      const { error: updateError } = await supabase
        .from("blog_posts")
        .update({
          fact_check_status: result.fact_check_status,
          fact_check_details: result.details,
        })
        .eq("id", input.blog_post_id)
      if (updateError) {
        console.error("[tavily-fact-check] blog_posts update failed:", updateError)
      }
    }

    await jobRef.update({
      status: "completed",
      result,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown tavily-fact-check error")
  }
}

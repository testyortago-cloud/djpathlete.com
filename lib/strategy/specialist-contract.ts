// The stable contract every specialist agent (SEO, Ads, Social, future channels)
// implements. Adding a new channel = new agent + new *_agent_memos table that
// conforms to SpecialistMemo. The critic walks all *_agent_memos uniformly via
// this shape; the brief is consumed identically by every specialist.

import { z } from "zod"

export const StrategyBriefSchema = z.object({
  week_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  themes: z.array(z.object({ tag: z.string().min(1), weight: z.number().min(0).max(1) })),
  audience_focus: z.string().min(1),
  priority_channel: z.enum(["seo", "ads", "social", "balanced"]),
  keywords_to_chase: z.array(z.string()),
  hooks_to_test: z.array(z.string()),
  ctas: z.array(z.string()),
  dont_do: z.array(z.string()),
  rationale: z.string().min(1),
})

export type StrategyBriefShape = z.infer<typeof StrategyBriefSchema>

export const SpecialistMemoSchema = z.object({
  channel: z.enum(["seo", "ads", "social"]),
  brief_id: z.string().nullable(),
  brief_alignment_score: z.number().int().min(1).max(10).nullable(),
  ran_without_brief: z.boolean(),
  signals_summary: z.string(),
  actions: z.array(
    z.object({
      kind: z.string(),
      payload: z.unknown(),
      rationale: z.string(),
    }),
  ),
  rationale: z.string(),
  outcome_status: z.enum(["pending", "measured", "preflight_failed", "no_op"]),
  outcome_metrics: z.record(z.string(), z.unknown()).nullable(),
})

export type SpecialistMemoShape = z.infer<typeof SpecialistMemoSchema>

// Brief-context bundle every specialist's reason() step receives so prompts
// stay consistent. Built once by each specialist from latestApprovedBrief().
export interface BriefContext {
  brief_id: string
  week_of: string
  themes: StrategyBriefShape["themes"]
  audience_focus: string
  priority_channel: StrategyBriefShape["priority_channel"]
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]
}

// functions/src/seo/decision-schema.ts
// Zod schema for the SEO agent's decision shape. The schema enforces:
// - exactly 2 actions
// - each action is a valid tool with the right args
// - the two actions must be of different tools (refine())
// - rank is 1 or 2

import { z } from "zod"

// Zod v4 enforces strict RFC 4122 variant bits in z.string().uuid().
// Use a loose pattern that matches the 8-4-4-4-12 hex format without variant enforcement,
// consistent with how UUIDs are stored in Postgres (which accepts any variant).
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidString = z.string().regex(uuidRegex, "Invalid UUID")

const queueNewPostArgs = z.object({
  keyword: z.string().min(2).max(120),
  angle: z.string().min(5).max(500),
  references: z.array(z.string().url()).max(5).optional(),
})

const queueRefreshArgs = z.object({
  blog_post_id: uuidString,
  reason: z.string().min(5).max(500),
})

const queueLinkSweepArgs = z.object({
  target_blog_post_id: uuidString,
  candidate_anchor_post_ids: z.array(uuidString).min(1).max(10),
})

const flagForHumanArgs = z.object({
  issue: z.string().min(5).max(200),
  urgency: z.enum(["low", "medium", "high"]),
  context: z.string().min(10).max(1000),
})

const baseActionFields = {
  rank: z.union([z.literal(1), z.literal(2)]),
  complementary_to_rank_1: z.string().max(300).optional(),
}

const actionSchema = z.discriminatedUnion("tool", [
  z.object({ ...baseActionFields, tool: z.literal("queue_new_post"), args: queueNewPostArgs }),
  z.object({ ...baseActionFields, tool: z.literal("queue_refresh"), args: queueRefreshArgs }),
  z.object({
    ...baseActionFields,
    tool: z.literal("queue_internal_link_sweep"),
    args: queueLinkSweepArgs,
  }),
  z.object({ ...baseActionFields, tool: z.literal("flag_for_human"), args: flagForHumanArgs }),
])

export const decisionSchema = z
  .object({
    rationale: z.string().min(20).max(2000),
    actions: z.tuple([actionSchema, actionSchema]),
  })
  .refine((d) => d.actions[0].tool !== d.actions[1].tool, {
    message: "Both actions must be of different tools",
    path: ["actions"],
  })

export type Decision = z.infer<typeof decisionSchema>
export type Action = z.infer<typeof actionSchema>
export type ToolName = Action["tool"]

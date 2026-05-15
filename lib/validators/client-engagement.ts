import { z } from "zod"

export const riskTierSchema = z.enum(["none", "low", "medium", "high"])

export const clientEngagementSnapshotSchema = z.object({
  client_id: z.string().uuid(),
  snapshot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days_since_last_session: z.number().int().min(0),
  session_frequency_pct_14d: z.number().min(0).max(100).nullable(),
  open_form_review_days: z.number().int().min(0).nullable(),
  open_performance_assessment_days: z.number().int().min(0).nullable(),
  program_ending_in_days: z.number().int().nullable(),
  last_renewal_conversation_at: z.string().datetime().nullable(),
  risk_score: z.number().int().min(0).max(100),
  risk_tier: riskTierSchema,
  reasons: z.array(z.string()),
})

export type ClientEngagementSnapshotInsert = z.infer<typeof clientEngagementSnapshotSchema>

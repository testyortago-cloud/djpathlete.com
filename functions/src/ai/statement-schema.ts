import { z } from "zod"

export const statementImportSchema = z.object({
  rows: z.array(z.object({
    ref: z.string().nullable(),
    occurred_on: z.string(),
    description: z.string(),
    amount_cents: z.number().int().nonnegative(),
    direction: z.enum(["income", "expense"]),
    is_transfer: z.boolean(),
    suggested_category: z.string().nullable(),
    confidence: z.enum(["low", "medium", "high"]),
  })),
  control_totals: z.object({
    total_deposits_cents: z.number().nullable(),
    total_withdrawals_cents: z.number().nullable(),
    opening_balance_cents: z.number().nullable(),
    closing_balance_cents: z.number().nullable(),
  }).nullable().optional(),
  warnings: z.array(z.string()),
  truncated: z.boolean(),
})
export type StatementImportResult = z.infer<typeof statementImportSchema>

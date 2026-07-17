import { z } from "zod"

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")

export const createEntrySchema = z.object({
  book_id: z.string().uuid(),
  account_id: z.string().uuid().nullable().optional(),
  direction: z.enum(["income", "expense"]),
  amount_cents: z.number().int().nonnegative(),
  currency: z.string().default("usd"),
  occurred_on: DATE,
  memo: z.string().max(500).nullable().optional(),
  business_purpose: z.string().max(1000).nullable().optional(),
  counterparty: z.string().max(200).nullable().optional(),
})

export const updateEntrySchema = z.object({
  account_id: z.string().uuid().nullable().optional(),
  direction: z.enum(["income", "expense"]).optional(),
  amount_cents: z.number().int().nonnegative().optional(),
  occurred_on: DATE.optional(),
  memo: z.string().max(500).nullable().optional(),
  business_purpose: z.string().max(1000).nullable().optional(),
  counterparty: z.string().max(200).nullable().optional(),
})

export const createAccountSchema = z.object({
  book_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  account_type: z.enum(["income", "expense"]),
  service_line: z.string().max(60).nullable().optional(),
  is_deductible_candidate: z.boolean().default(false),
  tax_category: z.string().max(120).nullable().optional(),
})

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  service_line: z.string().max(60).nullable().optional(),
  is_deductible_candidate: z.boolean().optional(),
  tax_category: z.string().max(120).nullable().optional(),
  archived: z.boolean().optional(),
})

export const importPreviewSchema = z.object({
  book_id: z.string().uuid(),
  from: DATE,
  to: DATE,
})

export const importCommitSchema = z.object({
  book_id: z.string().uuid(),
  entries: z.array(z.object({
    direction: z.enum(["income", "expense"]),
    amount_cents: z.number().int().nonnegative(),
    occurred_on: DATE,
    memo: z.string(),
    counterparty: z.string().nullable(),
    service_line: z.string().nullable(),
    source: z.enum(["manual", "platform_import", "statement_import", "receipt"]),
    source_ref: z.string(),
    account_id: z.string().uuid().nullable().optional(),
  })).min(1).max(2000),
})

export const statementDedupeSchema = z.object({
  book_id: z.string().uuid(),
  rows: z.array(z.object({
    occurred_on: DATE,
    amount_cents: z.number().int().nonnegative(),
    direction: z.enum(["income", "expense"]),
    description: z.string(),
    suggested_category: z.string().nullable(),
    is_transfer: z.boolean(),
    confidence: z.enum(["low", "medium", "high"]),
  })).max(500),
})

export const statementCommitSchema = importCommitSchema.extend({
  document_id: z.string().uuid().optional(),
})

import { z } from "zod"
import { PERIOD_RE } from "@/lib/bookkeeping/period-close"

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
  adjusts_period: z.string().regex(PERIOD_RE, "expected YYYY-MM").nullable().optional(),
})

export const updateEntrySchema = z.object({
  account_id: z.string().uuid().nullable().optional(),
  direction: z.enum(["income", "expense"]).optional(),
  amount_cents: z.number().int().nonnegative().optional(),
  occurred_on: DATE.optional(),
  memo: z.string().max(500).nullable().optional(),
  business_purpose: z.string().max(1000).nullable().optional(),
  counterparty: z.string().max(200).nullable().optional(),
  adjusts_period: z.string().regex(PERIOD_RE, "expected YYYY-MM").nullable().optional(),
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
    suggested_category: z.string().nullable().optional(),
    is_transfer: z.boolean(),
    confidence: z.enum(["low", "medium", "high"]),
  })).max(500),
})

export const statementCommitSchema = importCommitSchema.extend({
  document_id: z.string().uuid().optional(),
})

export const receiptCashSchema = z.object({
  book_id: z.string().uuid(),
  account_id: z.string().uuid(),
  amount_cents: z.number().int().nonnegative(),
  occurred_on: DATE,
  counterparty: z.string().max(200).nullable().optional(),
  business_purpose: z.string().max(1000).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
})

export const receiptCommitSchema = z.object({
  book_id: z.string().uuid(),
  document_id: z.string().uuid(),
  account_id: z.string().uuid().nullable().optional(),
  amount_cents: z.number().int().nonnegative(),
  occurred_on: DATE,
  counterparty: z.string().max(200).nullable().optional(),
  business_purpose: z.string().max(1000).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
  source_ref: z.string().min(1),
})

export const amazonCommitSchema = z.object({
  book_id: z.string().uuid(),
  document_id: z.string().uuid().optional(),
  entries: z.array(z.object({
    direction: z.enum(["income", "expense"]),
    amount_cents: z.number().int().nonnegative(),
    occurred_on: DATE,
    memo: z.string().nullable(),
    counterparty: z.string().nullable(),
    business_purpose: z.string().max(1000).nullable().optional(),
    service_line: z.string().nullable(),
    source: z.literal("receipt"),
    source_ref: z.string().min(1),
    account_id: z.string().uuid().nullable().optional(),
  })).min(1).max(2000),
})

const withinFiveYears = (v: { from: string; to: string }) =>
  Number(v.to.slice(0, 4)) - Number(v.from.slice(0, 4)) <= 5

export const reportQuerySchema = z.object({ from: DATE, to: DATE })
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" })
  .refine(withinFiveYears, { message: "window too large (max 5 years)" })

export const quickbooksQuerySchema = z.object({ from: DATE, to: DATE, book_id: z.string().uuid() })
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" })
  .refine(withinFiveYears, { message: "window too large (max 5 years)" })

export const emailPackSchema = z.object({
  from: DATE,
  to: DATE,
  recipient_email: z.string().email().max(200),
  remember: z.boolean().optional(),
})
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" })
  .refine(withinFiveYears, { message: "window too large (max 5 years)" })

export const homeOfficePercentSchema = z.object({
  percent: z.number().min(0.01).max(100).nullable(),
})

export const taxRatePercentSchema = z.object({
  percent: z.number().min(0.01).max(100).nullable(),
})

export const closePeriodSchema = z.object({
  book_id: z.string().uuid(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM"),
})

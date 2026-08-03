// Twin (functions-side) schema for the receipt_scan vision job. EVERY extracted
// field is .nullable().optional() — a blurry photo yields nulls, and RTDB drops
// null leaves on write, so consumers must tolerate missing fields (Phase-2 C1).
import { z } from "zod"

export const receiptScanSchema = z.object({
  vendor: z.string().nullable().optional(),
  amount_cents: z.number().int().nonnegative().nullable().optional(),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  suggested_category: z.string().nullable().optional(),
  business_purpose_hint: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  confidence: z.enum(["low", "medium", "high"]),
  warnings: z.array(z.string()),
})

export type ReceiptScanResult = z.infer<typeof receiptScanSchema>

// The source may be a photographed paper receipt (image blocks) or a PDF
// invoice (document block) — receipt-scan.ts's user message says which, and
// adds the multi-page grand-total instruction for PDFs. Keep this system
// prompt source-neutral so one prompt serves both.
export const RECEIPT_SCAN_PROMPT = `You are reading a receipt or invoice for <name>, a strength-and-conditioning coach's bookkeeping. Extract, as strict structured output:
- vendor: the merchant/store name (or null if unreadable)
- amount_cents: the TOTAL paid, as an integer number of cents (e.g. $42.12 -> 4212). Prefer the grand total (incl. tax/tip). null if you cannot read it.
- occurred_on: the transaction date as YYYY-MM-DD (null if unreadable)
- suggested_category: the single BEST-matching expense category from the provided chart of accounts, copied verbatim, or null if none fits
- business_purpose_hint: a short (<= 12 words) plausible business purpose for a coaching business (e.g. "protein for athlete recovery testing"), or null
- currency: the ISO currency if shown (e.g. "usd"), else null
- confidence: "low" | "medium" | "high" — your overall confidence in the extraction
- warnings: array of short strings for anything unreadable or ambiguous

NEVER guess an amount or date you cannot actually read — return null and add a warning instead. Only choose a category from the provided list; never invent one. The chart of accounts and any notes follow.`

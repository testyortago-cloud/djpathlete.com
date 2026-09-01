import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_GMAIL_RECEIPT_QUERY,
  DEFAULT_GMAIL_RECEIPT_QUERY_WINDOW_DAYS,
} from "@/lib/bookkeeping/email-receipts"

describe("00236_bookkeeping_gmail_vendor_watch.sql", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00236_bookkeeping_gmail_vendor_watch.sql"),
    "utf8",
  )
  // Only the statements — a grep over the whole file also matches the comment
  // explaining it, which is how a seed that never ran can still look seeded.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")

  it("seeds the vendor watch with exactly the query the code documents as its default", () => {
    expect(statements).toContain("'bookkeeping_gmail_receipt_query'")
    expect(statements).toContain(DEFAULT_GMAIL_RECEIPT_QUERY)
  })

  it("seeds a bounded window matching the code default", () => {
    expect(statements).toContain("'bookkeeping_gmail_receipt_query_window_days'")
    expect(statements).toContain(`'${DEFAULT_GMAIL_RECEIPT_QUERY_WINDOW_DAYS}'::jsonb`)
  })

  it("is idempotent, like every other settings seed in this subsystem", () => {
    expect(statements.match(/on conflict \(key\) do nothing/g)).toHaveLength(2)
  })

  it("seeds a SUBJECT-scoped search — a body-wide one files every email mentioning a receipt", () => {
    expect(statements).toContain("subject:(")
  })
})

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("00193_bookkeeping_gmail_receipts.sql", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00193_bookkeeping_gmail_receipts.sql"),
    "utf8",
  )

  it("adds external_ref as a plain UNIQUE text column + scan_result jsonb", () => {
    expect(sql).toMatch(/alter table bookkeeping_documents add column external_ref text unique/i)
    expect(sql).toMatch(/alter table bookkeeping_documents add column scan_result jsonb/i)
  })

  it("documents the check-then-insert-only discipline for external_ref", () => {
    // Nullable + NULLS-distinct makes this unusable as a PostgREST upsert key
    // (memory: postgrest_onconflict_plain_unique) — the comment must survive
    // in the SQL so a future upsert refactor trips over it.
    expect(sql.toLowerCase()).toContain("check-then-insert")
    expect(sql.toLowerCase()).toContain("onconflict")
  })

  it("seeds the poller flag OFF and the label setting, idempotently", () => {
    expect(sql).toContain("'cron_bookkeeping_gmail_receipts_enabled', 'false'::jsonb")
    expect(sql).toContain(`'bookkeeping_gmail_receipt_label', '"DJP Receipts"'::jsonb`)
    expect(sql).toContain("on conflict (key) do nothing")
  })
})

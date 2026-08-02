import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("00197_bookkeeping_gmail_forwarders_since.sql", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00197_bookkeeping_gmail_forwarders_since.sql"),
    "utf8",
  )

  it("seeds the forwarder-watch cutoff at the activation date, idempotently", () => {
    expect(sql).toContain("'bookkeeping_gmail_receipt_forwarders_since'")
    expect(sql).toContain(`'"2026-08-02"'::jsonb`)
    expect(sql).toContain("on conflict (key) do nothing")
  })

  it("documents that the label source stays unbounded (the opt-in backfill path)", () => {
    expect(sql.toLowerCase()).toContain("label")
    expect(sql.toLowerCase()).toContain("unbounded")
  })
})

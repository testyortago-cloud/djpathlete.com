import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("00196_bookkeeping_gmail_forwarders.sql", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00196_bookkeeping_gmail_forwarders.sql"),
    "utf8",
  )

  it("seeds the two yortago forwarder addresses, idempotently", () => {
    expect(sql).toContain("'bookkeeping_gmail_receipt_forwarders'")
    expect(sql).toContain("yortago@gmail.com")
    expect(sql).toContain("testyortago@gmail.com")
    expect(sql).toContain("on conflict (key) do nothing")
  })
})

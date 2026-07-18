import { describe, it, expect } from "vitest"
import { parseAmazonCsv } from "@/lib/bookkeeping/amazon-parse"

const CSV = `Order Date,Order ID,Title,Item Total,Currency
2026-07-01,112-3456789-1111111,"Resistance Bands, Set of 5",$24.99,USD
2026-07-03,112-3456789-2222222,Foam Roller,$31.50,USD
2026-07-03,112-3456789-2222222,Lacrosse Ball,$8.00,USD`

describe("parseAmazonCsv", () => {
  it("parses order lines into expense rows with stable refs", () => {
    const { rows, warnings } = parseAmazonCsv(CSV)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      occurred_on: "2026-07-01", description: "Resistance Bands, Set of 5",
      amount_cents: 2499, direction: "expense", orderId: "112-3456789-1111111",
    })
    expect(rows[0].source_ref).toBe("amazon:112-3456789-1111111:0")
    // two items on the same order get distinct line indexes
    expect(rows[1].source_ref).toBe("amazon:112-3456789-2222222:0")
    expect(rows[2].source_ref).toBe("amazon:112-3456789-2222222:1")
    expect(warnings).toEqual([])
  })

  it("re-parsing the same CSV yields identical refs (idempotent)", () => {
    const a = parseAmazonCsv(CSV).rows.map((r) => r.source_ref)
    const b = parseAmazonCsv(CSV).rows.map((r) => r.source_ref)
    expect(a).toEqual(b)
  })

  it("recognizes the 'Total Owed' / 'Product Name' variant", () => {
    const alt = `Order Date,Order ID,Product Name,Total Owed\n2026-06-15,111-0000000-0000000,Whiteboard,$45.00`
    const { rows } = parseAmazonCsv(alt)
    expect(rows[0]).toMatchObject({ amount_cents: 4500, orderId: "111-0000000-0000000", description: "Whiteboard" })
  })

  it("warns and skips rows with an unreadable amount or missing order id", () => {
    const bad = `Order Date,Order ID,Title,Item Total\n2026-06-15,,Mystery,$10.00\n2026-06-16,111-1,Broken,notanumber`
    const { rows, warnings } = parseAmazonCsv(bad)
    expect(rows).toHaveLength(0)
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  it("returns a warning (no throw) when no Amazon columns are detected", () => {
    const { rows, warnings } = parseAmazonCsv("foo,bar\n1,2")
    expect(rows).toEqual([])
    expect(warnings[0]).toMatch(/could not detect/i)
  })

  it("skips a negative/refund amount with a warning (never posts a wrong-signed expense)", () => {
    const csv = `Order Date,Order ID,Title,Item Total\n2026-06-15,111-1,Refund,-$5.00\n2026-06-16,111-2,Credit,($3.00)`
    const { rows, warnings } = parseAmazonCsv(csv)
    expect(rows).toHaveLength(0)
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })
})

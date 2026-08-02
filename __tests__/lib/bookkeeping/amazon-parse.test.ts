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

  // Amazon's current (2026) "Order History" export — the schema the coach
  // actually downloads today. Header row is verbatim from a real export; the
  // two lines below share one order and one SHIPMENT subtotal (144.98) while
  // their real per-line charges differ (32.09 / 106.99), so a parser that
  // grabbed "Shipment Item Subtotal" instead of "Total Amount" fails here.
  const CURRENT_EXPORT_HEADER =
    "ASIN,Billing Address,Carrier Name & Tracking Number,Currency,Gift Message,Gift Recipient Contact,Gift Sender Name,Item Serial Number,Order Date,Order ID,Order Status,Original Quantity,Payment Method Type,Product Condition,Product Name,Purchase Order Number,Ship Date,Shipment Item Subtotal,Shipment Item Subtotal Tax,Shipment Status,Shipping Address,Shipping Charge,Shipping Option,Total Amount,Total Discounts,Unit Price,Unit Price Tax,Website"
  const CURRENT_EXPORT = [
    CURRENT_EXPORT_HEADER,
    "B0TOMY01,Darren FL,Not Available,USD,Not Available,Not Available,Not Available,Not Available,2026-07-03T19:03:16Z,113-0330859-4505816,Closed,1,Visa - 6225,New,TOMY Bluey Screwball Scramble,Not Applicable,2026-07-05T17:08:47.256Z,144.98,10.15,Shipped,Darren FL,0,Std US D2D Dom,32.09,0,29.99,2.1,Amazon.com",
    "B0PANINI,Darren FL,Not Available,USD,Not Available,Not Available,Not Available,Not Available,2026-07-03T19:03:16Z,113-0330859-4505816,Closed,1,Visa - 6225,New,2026 Panini FIFA World Cup Stickers,Not Applicable,2026-07-05T17:08:47.256Z,144.98,10.15,Shipped,Darren FL,0,Std US D2D Dom,106.99,0,99.99,7,Amazon.com",
    "B0CANCEL,Darren FL,Not Available,USD,Not Available,Not Available,Not Available,Not Available,2026-07-10T12:00:00Z,113-9999999-9999999,Cancelled,1,Visa - 6225,New,Cancelled Thing,Not Applicable,Not Available,Not Available,Not Available,Not Available,Darren FL,0,Std US D2D Dom,25.00,0,25.00,0,Amazon.com",
  ].join("\n")

  it("parses Amazon's current Order History export (Total Amount, ISO timestamps)", () => {
    const { rows } = parseAmazonCsv(CURRENT_EXPORT)
    // Per-LINE charged totals — never the repeated shipment subtotal (14498).
    expect(rows.map((r) => r.amount_cents)).toEqual([3209, 10699])
    expect(rows.map((r) => r.description)).toEqual([
      "TOMY Bluey Screwball Scramble",
      "2026 Panini FIFA World Cup Stickers",
    ])
    // ISO datetime collapses to a tz-independent date-only string.
    expect(rows.every((r) => r.occurred_on === "2026-07-03")).toBe(true)
    expect(rows.map((r) => r.source_ref)).toEqual([
      "amazon:113-0330859-4505816:0",
      "amazon:113-0330859-4505816:1",
    ])
  })

  it("skips a cancelled order line with a warning (it was never charged)", () => {
    const { rows, warnings } = parseAmazonCsv(CURRENT_EXPORT)
    expect(rows.some((r) => r.orderId === "113-9999999-9999999")).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/cancelled/i)
  })

  it("detects columns through a leading UTF-8 BOM", () => {
    const bom = String.fromCharCode(0xfeff)
    const csv = `${bom}Order Date,Order ID,Product Name,Total Amount\n2026-06-15,111-0000000-0000000,Whiteboard,$45.00`
    const { rows, warnings } = parseAmazonCsv(csv)
    expect(warnings).toEqual([])
    expect(rows[0]).toMatchObject({ amount_cents: 4500, occurred_on: "2026-06-15", description: "Whiteboard" })
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

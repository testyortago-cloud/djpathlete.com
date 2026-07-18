import { describe, it, expect } from "vitest"
import { centsToDecimalString, toQuickBooksDate, buildQuickBooksCsv } from "@/lib/bookkeeping/quickbooks-csv"
import type { ReportEntry, ReportAccount } from "@/lib/bookkeeping/reports"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC = "a0000000-0000-4000-8000-000000000001"
const accounts: ReportAccount[] = [
  { id: ACC, book_id: BOOK, name: "Equipment", account_type: "expense", service_line: null, tax_category: null, sort_order: 0 },
]
function entry(over: Partial<ReportEntry>): ReportEntry {
  return {
    book_id: BOOK, account_id: ACC, direction: "expense", amount_cents: 150000,
    occurred_on: "2026-07-05", counterparty: "Rogue Fitness", memo: "squat rack", source: "receipt", ...over,
  }
}

describe("centsToDecimalString", () => {
  it.each([[0, "0.00"], [1, "0.01"], [99, "0.99"], [100, "1.00"], [123456, "1234.56"], [150200, "1502.00"]])(
    "%i → %s", (cents, s) => expect(centsToDecimalString(cents)).toBe(s))
  it("throws on negatives and non-integers (defensive — DB CHECK enforces ≥ 0)", () => {
    expect(() => centsToDecimalString(-1)).toThrow()
    expect(() => centsToDecimalString(1.5)).toThrow()
  })
})

describe("toQuickBooksDate", () => {
  it("YYYY-MM-DD → MM/DD/YYYY", () => expect(toQuickBooksDate("2026-07-05")).toBe("07/05/2026"))
})

describe("buildQuickBooksCsv", () => {
  it("emits the 4-column header and routes amounts by direction (blank, not 0, in the unused column)", () => {
    const csv = buildQuickBooksCsv([
      entry({}),
      entry({ direction: "income", amount_cents: 5000, counterparty: "Client A", memo: null, occurred_on: "2026-07-06" }),
    ], accounts)
    const lines = csv.split("\r\n")
    expect(lines[0]).toBe("Date,Description,Credit,Debit")
    expect(lines[1]).toBe("07/05/2026,Rogue Fitness — squat rack,,1500.00")
    expect(lines[2]).toBe("07/06/2026,Client A,50.00,")
    expect(lines).toHaveLength(3) // no trailing newline
  })
  it("orders rows by occurred_on ascending", () => {
    const csv = buildQuickBooksCsv([entry({ occurred_on: "2026-07-09" }), entry({ occurred_on: "2026-07-01" })], accounts)
    const lines = csv.split("\r\n")
    expect(lines[1].startsWith("07/01/2026")).toBe(true)
    expect(lines[2].startsWith("07/09/2026")).toBe(true)
  })
  it("description falls back counterparty+memo → account name → 'Ledger entry'", () => {
    const csv = buildQuickBooksCsv([
      entry({ counterparty: null, memo: null }),                       // → account name
      entry({ counterparty: null, memo: null, account_id: null }),     // → Ledger entry
    ], accounts)
    const lines = csv.split("\r\n")
    expect(lines[1]).toContain("Equipment")
    expect(lines[2]).toContain("Ledger entry")
  })
  it("CSV-injection: leading = + - @ in text fields are apostrophe-prefixed; amounts stay clean", () => {
    const csv = buildQuickBooksCsv([
      entry({ counterparty: "=cmd()", memo: null }),
      entry({ counterparty: "+1 555 0100", memo: null }),
      entry({ counterparty: "-lead", memo: null }),
      entry({ counterparty: "@handle", memo: null }),
    ], accounts)
    const lines = csv.split("\r\n")
    expect(lines[1]).toContain("'=cmd()")
    expect(lines[2]).toContain("'+1 555 0100")
    expect(lines[3]).toContain("'-lead")
    expect(lines[4]).toContain("'@handle")
    for (const l of lines.slice(1)) {
      expect(l.endsWith("1500.00")).toBe(true) // Debit column unprefixed
      expect(l.split(",").at(-1)!.startsWith("'")).toBe(false) // amount cell itself carries no apostrophe prefix
    }
  })
  it("empty entry list → header only", () => {
    expect(buildQuickBooksCsv([], accounts)).toBe("Date,Description,Credit,Debit")
  })
})

import { describe, it, expect } from "vitest"
import {
  parseCsvStatement, detectStatementColumns, normalizeStatementRows, dropNonTransactionRows,
  transferSuspicion, parseAmountToCents, parseStatementDate, computeStatementSourceRef,
  assignOccurrenceIndexes, normalizeDescription,
} from "@/lib/bookkeeping/statement-parse"

describe("parseAmountToCents", () => {
  it("parses plain decimal to integer cents (no float drift)", () => {
    expect(parseAmountToCents("1234.56")).toEqual({ cents: 123456, negative: false })
    expect(parseAmountToCents("$1,234.56")).toEqual({ cents: 123456, negative: false })
  })
  it("treats parentheses and trailing minus as negative", () => {
    expect(parseAmountToCents("(1,234.56)")).toEqual({ cents: 123456, negative: true })
    expect(parseAmountToCents("1234.56-")).toEqual({ cents: 123456, negative: true })
  })
  it("parses CR/DR suffixes (CR = credit/inflow, DR = debit/outflow)", () => {
    expect(parseAmountToCents("500.00 CR")).toEqual({ cents: 50000, negative: false })
    expect(parseAmountToCents("500.00 DR")).toEqual({ cents: 50000, negative: true })
  })
  it("returns null for non-numeric", () => {
    expect(parseAmountToCents("")).toBeNull()
    expect(parseAmountToCents("abc")).toBeNull()
  })
})

describe("parseStatementDate", () => {
  it("parses common formats to YYYY-MM-DD", () => {
    expect(parseStatementDate("07/04/2026")).toBe("2026-07-04")
    expect(parseStatementDate("2026-07-04")).toBe("2026-07-04")
    expect(parseStatementDate("7/4/26")).toBe("2026-07-04")
  })
  it("slices an ISO datetime tz-independently (no local rollback)", () => {
    expect(parseStatementDate("2026-07-04T23:30:00-04:00")).toBe("2026-07-04")
  })
  it("returns null for garbage", () => { expect(parseStatementDate("nope")).toBeNull() })
})

describe("parseCsvStatement (quote-aware)", () => {
  it("keeps commas inside quoted fields", () => {
    const { headers, rows } = parseCsvStatement('Date,Description,Amount\n07/04/2026,"COFFEE, LLC",-5.00\n')
    expect(headers).toEqual(["Date", "Description", "Amount"])
    expect(rows[0]).toEqual(["07/04/2026", "COFFEE, LLC", "-5.00"])
  })
  it("keeps embedded newlines inside quoted fields", () => {
    const { rows } = parseCsvStatement('Date,Description,Amount\n07/04/2026,"line1\nline2",-5.00\n')
    expect(rows).toHaveLength(1)
    expect(rows[0][1]).toBe("line1\nline2")
  })
})

describe("detectStatementColumns", () => {
  it("maps a generic Date/Description/Amount signed layout", () => {
    const map = detectStatementColumns(["Date", "Description", "Amount"], [["07/04/2026", "COFFEE", "-5.00"]])
    expect(map).toMatchObject({ date: 0, description: 1, amountMode: "signed", amount: 2 })
  })
  it("maps a debit/credit-pair layout", () => {
    const map = detectStatementColumns(["Date", "Description", "Debit", "Credit"], [["07/04/2026", "COFFEE", "5.00", ""]])
    expect(map).toMatchObject({ date: 0, description: 1, amountMode: "debit_credit", debit: 2, credit: 3 })
  })
  it("maps the Venmo export", () => {
    const map = detectStatementColumns(["Datetime", "Type", "Note", "From", "To", "Amount (total)"], [["2026-07-04T10:00:00", "Payment", "lunch", "A", "B", "- $5.00"]])
    expect(map).not.toBeNull()
    expect(map!.amountMode).toBe("signed")
  })
  it("returns null when it cannot confidently find date+amount", () => {
    expect(detectStatementColumns(["foo", "bar"], [["1", "2"]])).toBeNull()
  })
})

describe("normalizeStatementRows", () => {
  it("signed: negative → expense, positive → income", () => {
    const map = { date: 0, description: 1, amountMode: "signed" as const, amount: 2, signConvention: "negative_is_expense" as const }
    const { rows } = normalizeStatementRows([["07/04/2026", "COFFEE", "-5.00"], ["07/05/2026", "REFUND", "5.00"]], map)
    expect(rows[0]).toEqual({ occurred_on: "2026-07-04", description: "COFFEE", amount_cents: 500, direction: "expense" })
    expect(rows[1].direction).toBe("income")
  })
  it("debit_credit: picks the non-zero column, treats 0.00/blank as absent", () => {
    const map = { date: 0, description: 1, amountMode: "debit_credit" as const, debit: 2, credit: 3 }
    const { rows } = normalizeStatementRows([["07/04/2026", "COFFEE", "5.00", "0.00"], ["07/05/2026", "PAY", "", "100.00"]], map)
    expect(rows[0]).toMatchObject({ amount_cents: 500, direction: "expense" })
    expect(rows[1]).toMatchObject({ amount_cents: 10000, direction: "income" })
  })
  it("debit_credit: both columns non-zero → warning, row skipped", () => {
    const map = { date: 0, description: 1, amountMode: "debit_credit" as const, debit: 2, credit: 3 }
    const { rows, warnings } = normalizeStatementRows([["07/04/2026", "AMBIG", "5.00", "5.00"]], map)
    expect(rows).toHaveLength(0)
    expect(warnings.length).toBeGreaterThan(0)
  })
  it("negative value inside the credit column is an income reversal (→ expense direction)", () => {
    const map = { date: 0, description: 1, amountMode: "debit_credit" as const, debit: 2, credit: 3 }
    const { rows } = normalizeStatementRows([["07/04/2026", "CHARGEBACK", "0.00", "(50.00)"]], map)
    expect(rows[0]).toMatchObject({ amount_cents: 5000, direction: "expense" })
  })
})

describe("dropNonTransactionRows", () => {
  it("drops balance/total/subtotal and zero-amount lines", () => {
    const rows = [
      { occurred_on: "2026-07-01", description: "Beginning Balance", amount_cents: 100000, direction: "income" as const },
      { occurred_on: "2026-07-02", description: "COFFEE", amount_cents: 500, direction: "expense" as const },
      { occurred_on: "2026-07-31", description: "Total Withdrawals", amount_cents: 432100, direction: "expense" as const },
      { occurred_on: "2026-07-02", description: "ZERO", amount_cents: 0, direction: "expense" as const },
    ]
    const { rows: kept, dropped } = dropNonTransactionRows(rows)
    expect(kept.map((r) => r.description)).toEqual(["COFFEE"])
    expect(dropped).toBe(3)
  })
})

describe("transferSuspicion", () => {
  it("hard-flags explicit transfer keywords", () => {
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "PAYMENT TO CREDIT CARD", amount_cents: 50000, direction: "expense" })).toBe("hard")
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "Online Transfer to Savings", amount_cents: 20000, direction: "expense" })).toBe("hard")
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "ATM Withdrawal", amount_cents: 10000, direction: "expense" })).toBe("hard")
  })
  it("soft-flags a round outbound to a person-like name with no merchant tokens", () => {
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "John Smith", amount_cents: 100000, direction: "expense" })).toBe("soft")
  })
  it("returns null for an ordinary merchant expense", () => {
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "STARBUCKS #123", amount_cents: 542, direction: "expense" })).toBeNull()
  })
})

describe("computeStatementSourceRef + assignOccurrenceIndexes", () => {
  const rowA = { occurred_on: "2026-07-04", description: "COFFEE", amount_cents: 500, direction: "expense" as const }
  it("is stable for the same input", () => {
    expect(computeStatementSourceRef(rowA, 0)).toBe(computeStatementSourceRef(rowA, 0))
    expect(computeStatementSourceRef(rowA, 0)).toMatch(/^statement:[0-9a-f]{40}$/)
  })
  it("distinguishes two identical same-day rows by occurrence index", () => {
    expect(computeStatementSourceRef(rowA, 0)).not.toBe(computeStatementSourceRef(rowA, 1))
  })
  it("assigns stable 0-based indexes per identical tuple over the full set", () => {
    const rows = [rowA, { ...rowA }, { occurred_on: "2026-07-05", description: "TEA", amount_cents: 300, direction: "expense" as const }]
    expect(assignOccurrenceIndexes(rows)).toEqual([0, 1, 0])
  })
  it("unchecking a subset does not change a row's ref (indexes computed over the full set)", () => {
    const full = [rowA, { ...rowA }]
    const idx = assignOccurrenceIndexes(full)
    const refFull1 = computeStatementSourceRef(full[1], idx[1])
    // simulate re-import of the full file → same indexes → same refs
    expect(computeStatementSourceRef(full[1], assignOccurrenceIndexes(full)[1])).toBe(refFull1)
  })
})

describe("normalizeDescription", () => {
  it("lowercases, collapses whitespace, strips volatile tokens", () => {
    expect(normalizeDescription("SQ *COFFEE   #0007  bal 1,234.56")).toBe("sq coffee")
  })
})

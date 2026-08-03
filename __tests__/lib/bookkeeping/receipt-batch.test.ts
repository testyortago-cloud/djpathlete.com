import { describe, it, expect } from "vitest"
import {
  MAX_BATCH_SIZE,
  applyScanResult,
  batchTotals,
  detectWithinBatchDuplicates,
  isAcceptedReceiptFile,
  isPdfFile,
  newReceiptRow,
  parseAmountCents,
  resolveExpenseAccount,
  rowValidationError,
  safeReceiptResult,
  sortReceiptRows,
  type ReceiptBatchRow,
} from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

// Helpers only read id/name/account_type/requires_business_purpose — cast the rest away.
function acct(over: Partial<BookkeepingAccount>): BookkeepingAccount {
  return {
    id: "a1",
    name: "Meals",
    account_type: "expense",
    requires_business_purpose: false,
    ...over,
  } as BookkeepingAccount
}

function row(over: Partial<ReceiptBatchRow>): ReceiptBatchRow {
  return { ...newReceiptRow("c1", "r.jpg", null), ...over }
}

describe("MAX_BATCH_SIZE", () => {
  it("is 15 per the spec", () => {
    expect(MAX_BATCH_SIZE).toBe(15)
  })
})

describe("isAcceptedReceiptFile", () => {
  const f = (name: string, type: string) => new File(["x"], name, { type })
  it("accepts the four supported types", () => {
    expect(isAcceptedReceiptFile(f("a.jpg", "image/jpeg"))).toBe(true)
    expect(isAcceptedReceiptFile(f("a.png", "image/png"))).toBe(true)
    expect(isAcceptedReceiptFile(f("a.webp", "image/webp"))).toBe(true)
    expect(isAcceptedReceiptFile(f("a.pdf", "application/pdf"))).toBe(true)
  })
  it("accepts by extension when a drop gives no mime", () => {
    expect(isAcceptedReceiptFile(f("invoice.PDF", ""))).toBe(true)
    expect(isAcceptedReceiptFile(f("receipt.JPEG", ""))).toBe(true)
  })
  it("rejects everything else", () => {
    expect(isAcceptedReceiptFile(f("notes.docx", "application/msword"))).toBe(false)
    expect(isAcceptedReceiptFile(f("book.csv", "text/csv"))).toBe(false)
    expect(isAcceptedReceiptFile(f("IMG_1.heic", "image/heic"))).toBe(false)
  })
})

describe("isPdfFile", () => {
  it("detects PDFs by mime or extension, and only PDFs", () => {
    expect(isPdfFile(new File(["x"], "a.pdf", { type: "application/pdf" }))).toBe(true)
    expect(isPdfFile(new File(["x"], "a.PDF", { type: "" }))).toBe(true)
    expect(isPdfFile(new File(["x"], "a.jpg", { type: "image/jpeg" }))).toBe(false)
  })
})

describe("newReceiptRow isPdf", () => {
  it("defaults to false", () => {
    expect(newReceiptRow("c1", "r.jpg", null).isPdf).toBe(false)
  })
  it("carries the flag when set", () => {
    expect(newReceiptRow("c1", "invoice.pdf", null, true).isPdf).toBe(true)
  })
})

describe("safeReceiptResult", () => {
  it("coalesces a fully null-dropped RTDB payload to explicit nulls", () => {
    expect(safeReceiptResult(undefined)).toEqual({
      vendor: null,
      amount_cents: null,
      occurred_on: null,
      suggested_category: null,
      business_purpose_hint: null,
      memo: null,
      currency: null,
      confidence: "low",
      warnings: [],
    })
  })

  it("passes through a complete result and clamps bad confidence", () => {
    const r = safeReceiptResult({
      vendor: "Chevron",
      amount_cents: 4512,
      occurred_on: "2026-07-01",
      suggested_category: "Fuel",
      business_purpose_hint: "Drive to facility",
      memo: "Unleaded fill-up",
      currency: "usd",
      confidence: "bogus",
      warnings: ["glare"],
    })
    expect(r.vendor).toBe("Chevron")
    expect(r.amount_cents).toBe(4512)
    expect(r.memo).toBe("Unleaded fill-up")
    expect(r.confidence).toBe("low")
    expect(r.warnings).toEqual(["glare"])
  })
})

describe("resolveExpenseAccount", () => {
  const accounts = [
    acct({ id: "inc1", name: "Fuel", account_type: "income" }),
    acct({ id: "exp1", name: "Fuel" }),
  ]
  it("matches case-insensitively against expense accounts only", () => {
    expect(resolveExpenseAccount("  fUeL ", accounts)).toBe("exp1")
  })
  it("returns empty string (Uncategorized) with no match or null input", () => {
    expect(resolveExpenseAccount("Travel", accounts)).toBe("")
    expect(resolveExpenseAccount(null, accounts)).toBe("")
  })
})

describe("parseAmountCents", () => {
  it("parses dollars to positive cents", () => {
    expect(parseAmountCents("12.34")).toBe(1234)
    expect(parseAmountCents("0.5")).toBe(50)
  })
  it("rejects blank, zero, negative, and garbage", () => {
    expect(parseAmountCents("")).toBeNull()
    expect(parseAmountCents("  ")).toBeNull()
    expect(parseAmountCents("0")).toBeNull()
    expect(parseAmountCents("-3")).toBeNull()
    expect(parseAmountCents("abc")).toBeNull()
  })
})

describe("applyScanResult", () => {
  const accounts = [acct({ id: "exp1", name: "Fuel" })]
  it("maps a full result into form fields and marks the row scanned", () => {
    const out = applyScanResult(row({}), {
      vendor: "Chevron",
      amount_cents: 4512,
      occurred_on: "2026-07-01",
      suggested_category: "Fuel",
      business_purpose_hint: "Drive to facility",
      memo: "Unleaded fill-up",
      currency: "usd",
      confidence: "high",
      warnings: [],
    }, accounts)
    expect(out.status).toBe("scanned")
    expect(out.counterparty).toBe("Chevron")
    expect(out.amount).toBe("45.12")
    expect(out.occurredOn).toBe("2026-07-01")
    expect(out.accountId).toBe("exp1")
    expect(out.businessPurpose).toBe("Drive to facility")
    expect(out.memo).toBe("Unleaded fill-up")
    expect(out.result?.confidence).toBe("high")
  })
  it("defaults a null-heavy result to blank fields and today's date", () => {
    const out = applyScanResult(row({}), {}, accounts)
    expect(out.status).toBe("scanned")
    expect(out.counterparty).toBe("")
    expect(out.amount).toBe("")
    expect(out.memo).toBe("")
    expect(out.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(out.accountId).toBe("")
  })
})

describe("detectWithinBatchDuplicates", () => {
  it("flags a later row matching an earlier row's vendor+amount+date, normalized", () => {
    const flags = detectWithinBatchDuplicates([
      { counterparty: "Chevron", amount: "45.12", occurredOn: "2026-07-01" },
      { counterparty: " chevron ", amount: "45.12", occurredOn: "2026-07-01" },
      { counterparty: "Chevron", amount: "45.12", occurredOn: "2026-07-02" },
    ])
    expect(flags).toEqual([null, 0, null])
  })
  it("never matches on blank vendor or invalid amount", () => {
    const flags = detectWithinBatchDuplicates([
      { counterparty: "", amount: "45.12", occurredOn: "2026-07-01" },
      { counterparty: "", amount: "45.12", occurredOn: "2026-07-01" },
      { counterparty: "Chevron", amount: "", occurredOn: "2026-07-01" },
      { counterparty: "Chevron", amount: "", occurredOn: "2026-07-01" },
    ])
    expect(flags).toEqual([null, null, null, null])
  })
})

describe("sortReceiptRows", () => {
  it("sorts by occurredOn ascending, stable on ties", () => {
    const rows = [
      { occurredOn: "2026-07-03", tag: "a" },
      { occurredOn: "2026-07-01", tag: "b" },
      { occurredOn: "2026-07-03", tag: "c" },
    ]
    expect(sortReceiptRows(rows).map((r) => (r as { tag: string }).tag)).toEqual(["b", "a", "c"])
  })
})

describe("rowValidationError", () => {
  const purposeAcct = acct({ id: "meals", name: "Meals", requires_business_purpose: true })
  it("requires a valid amount, then a date", () => {
    expect(rowValidationError(row({ amount: "" }), [])).toBe("Enter a valid amount")
    expect(rowValidationError(row({ amount: "10", occurredOn: "" }), [])).toBe("Pick a date")
  })
  it("requires business purpose only for flagged accounts", () => {
    const base = row({ amount: "10", occurredOn: "2026-07-01", accountId: "meals", businessPurpose: " " })
    expect(rowValidationError(base, [purposeAcct])).toBe("Business purpose required for this category")
    expect(rowValidationError({ ...base, businessPurpose: "Client dinner" }, [purposeAcct])).toBeNull()
    expect(rowValidationError({ ...base, accountId: "" }, [purposeAcct])).toBeNull()
  })
})

describe("batchTotals", () => {
  it("sums only included rows, tracks date range over all rows, counts warnings/dupes/posted", () => {
    const rows: ReceiptBatchRow[] = [
      row({ clientId: "1", included: true, amount: "10.00", occurredOn: "2026-07-02", status: "scanned" }),
      row({
        clientId: "2",
        included: false,
        amount: "5.00",
        occurredOn: "2026-07-01",
        duplicateUploadHint: "2026-07-10T00:00:00Z",
        status: "scanned",
      }),
      row({
        clientId: "3",
        included: true,
        amount: "2.50",
        occurredOn: "2026-07-05",
        status: "posted",
        result: {
          vendor: null,
          amount_cents: null,
          occurred_on: null,
          suggested_category: null,
          business_purpose_hint: null,
          currency: null,
          confidence: "low",
          warnings: ["glare", "crumpled"],
        },
      }),
    ]
    const t = batchTotals(rows)
    expect(t.rowCount).toBe(3)
    expect(t.includedCount).toBe(2)
    expect(t.includedTotalCents).toBe(1250)
    expect(t.minDate).toBe("2026-07-01")
    expect(t.maxDate).toBe("2026-07-05")
    expect(t.warningCount).toBe(2)
    expect(t.duplicateCount).toBe(1)
    expect(t.postedCount).toBe(1)
  })
})

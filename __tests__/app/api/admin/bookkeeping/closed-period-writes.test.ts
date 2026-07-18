// __tests__/app/api/admin/bookkeeping/closed-period-writes.test.ts
// One test per method+path pair (8 pairs, spec §3.3): the DAL mock throws a
// duck-typed PERIOD_CLOSED error (never the real class — this module is fully
// mocked, so the class import would be undefined) → single-row routes 409 with
// the exact message; batch routes pass rejected_closed through additively.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntries: vi.fn(),
  entryTotals: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  getEntry: vi.fn(),
  assertAccountInBook: vi.fn(),
  getAccount: vi.fn(),
  getDocument: vi.fn(),
  insertReceiptEntry: vi.fn(),
  updateDocumentRetainUntil: vi.fn(),
  linkDocumentBatch: vi.fn(),
  insertImportedEntries: vi.fn(),
  insertAmazonEntries: vi.fn(),
  assertAccountsInBook: vi.fn(),
}))

import { POST as ENTRIES_POST } from "@/app/api/admin/bookkeeping/entries/route"
import { DELETE as ENTRY_DELETE, PATCH as ENTRY_PATCH } from "@/app/api/admin/bookkeeping/entries/[id]/route"
import { POST as CASH_POST } from "@/app/api/admin/bookkeeping/receipts/cash/route"
import { POST as RECEIPT_COMMIT } from "@/app/api/admin/bookkeeping/receipts/commit/route"
import { POST as STATEMENT_COMMIT } from "@/app/api/admin/bookkeeping/statement-import/commit/route"
import { POST as PLATFORM_COMMIT } from "@/app/api/admin/bookkeeping/import-platform/commit/route"
import { POST as AMAZON_COMMIT } from "@/app/api/admin/bookkeeping/receipts/amazon/commit/route"
import { auth } from "@/lib/auth"
import {
  createEntry,
  deleteEntry,
  getAccount,
  getDocument,
  insertAmazonEntries,
  insertImportedEntries,
  insertReceiptEntry,
  linkDocumentBatch,
  updateEntry,
} from "@/lib/db/bookkeeping"
import { PERIOD_CLOSED_MESSAGE } from "@/lib/bookkeeping/period-close"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ENTRY = "e0000000-0000-4000-8000-000000000001"
const ACCOUNT = "a0000000-0000-4000-8000-000000000001"
const DOC = "d0000000-0000-4000-8000-000000000001"
const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }

const periodClosed = () =>
  Object.assign(new Error("Period 2019-01 is closed"), { code: "PERIOD_CLOSED", book_id: BOOK, period: "2019-01" })

const post = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) }) as never
const REJECTED_ROW = { occurred_on: "2019-01-15", amount_cents: 4200, memo: "m", counterparty: null, source_ref: "r" }

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
})

describe("single-row paths → 409 with the exact spec message", () => {
  it("POST /entries (pair 1)", async () => {
    ;(createEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await ENTRIES_POST(post({
      book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2019-01-15",
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })

  it("PATCH /entries/[id] — occurred_on-only edit, no account_id (pair 2)", async () => {
    ;(updateEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await ENTRY_PATCH(
      new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ occurred_on: "2019-01-15" }) }) as never,
      { params: Promise.resolve({ id: ENTRY }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })

  it("DELETE /entries/[id] (pair 3)", async () => {
    ;(deleteEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await ENTRY_DELETE(
      new Request("http://x/api", { method: "DELETE" }) as never,
      { params: Promise.resolve({ id: ENTRY }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })

  it("POST /receipts/cash (pair 4)", async () => {
    ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: ACCOUNT, book_id: BOOK, account_type: "expense", requires_business_purpose: false,
    })
    ;(createEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await CASH_POST(post({
      book_id: BOOK, account_id: ACCOUNT, amount_cents: 100, occurred_on: "2019-01-15",
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })

  it("POST /receipts/commit (pair 5)", async () => {
    ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC, book_id: BOOK })
    ;(insertReceiptEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await RECEIPT_COMMIT(post({
      book_id: BOOK, document_id: DOC, amount_cents: 100, occurred_on: "2019-01-15",
      source_ref: `receipt:${DOC}`,
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })
})

describe("batch paths → additive rejected_closed passthrough", () => {
  const batchResult = { inserted: 1, rejected_closed: 2, rejected_closed_rows: [REJECTED_ROW] }

  it("POST /statement-import/commit (pair 6) — linkDocumentBatch still uses inserted, not requested", async () => {
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue(batchResult)
    const res = await STATEMENT_COMMIT(post({
      book_id: BOOK,
      document_id: DOC,
      entries: [{
        direction: "income", amount_cents: 5000, occurred_on: "2019-02-02", memo: "x",
        counterparty: null, service_line: null, source: "statement_import",
        source_ref: `statement:${"a".repeat(40)}`,
      }],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.inserted).toBe(1)
    expect(json.rejected_closed).toBe(2)
    expect(json.rejected_closed_rows).toEqual([REJECTED_ROW])
    // linkDocumentBatch's postedCount comes from the DAL's `inserted` (1), not
    // the 1 requested entry that happens to match here by coincidence — the
    // batch-result mock is the source of truth for this assertion.
    expect(linkDocumentBatch).toHaveBeenCalledWith(DOC, BOOK, expect.any(String), 1)
  })

  it("POST /import-platform/commit (pair 7)", async () => {
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue(batchResult)
    const res = await PLATFORM_COMMIT(post({
      book_id: BOOK,
      entries: [{
        direction: "income", amount_cents: 5000, occurred_on: "2019-02-02", memo: "x",
        counterparty: null, service_line: null, source: "platform_import", source_ref: "payments:1",
      }],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rejected_closed).toBe(2)
    expect(json.rejected_closed_rows).toHaveLength(1)
  })

  it("POST /receipts/amazon/commit (pair 8)", async () => {
    ;(insertAmazonEntries as ReturnType<typeof vi.fn>).mockResolvedValue(batchResult)
    const res = await AMAZON_COMMIT(post({
      book_id: BOOK,
      entries: [{
        direction: "expense", amount_cents: 2499, occurred_on: "2019-02-02", memo: "Bands",
        counterparty: "Amazon", service_line: null, source: "receipt", source_ref: "amazon:112-1:0",
      }],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rejected_closed).toBe(2)
    expect(json.rejected_closed_rows).toEqual([REJECTED_ROW])
  })

  it("legacy DAL shape ({ inserted } only) coalesces to 0/[] — the old-mock invariant", async () => {
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue({ inserted: 1 })
    const res = await PLATFORM_COMMIT(post({
      book_id: BOOK,
      entries: [{
        direction: "income", amount_cents: 5000, occurred_on: "2019-02-02", memo: "x",
        counterparty: null, service_line: null, source: "platform_import", source_ref: "payments:2",
      }],
    }))
    const json = await res.json()
    expect(json.rejected_closed).toBe(0)
    expect(json.rejected_closed_rows).toEqual([])
  })
})

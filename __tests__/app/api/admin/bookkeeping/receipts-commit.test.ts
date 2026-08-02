import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getAccount: vi.fn(),
  assertAccountInBook: vi.fn(),
  getDocument: vi.fn(),
  insertReceiptEntry: vi.fn().mockResolvedValue({ inserted: 1, id: "e1" }),
  updateDocumentRetainUntil: vi.fn(),
  linkDocumentBatch: vi.fn(),
  rehomeEmailReceiptDocument: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import {
  getAccount,
  getDocument,
  insertReceiptEntry,
  updateDocumentRetainUntil,
  linkDocumentBatch,
  rehomeEmailReceiptDocument,
} from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/receipts/commit/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const OTHER_BOOK_UUID = "22222222-2222-4333-8444-555555555555"
const admin = { user: { id: UUID, role: "admin" } }
const body = (b: unknown) => ({ json: async () => b }) as never

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, book_id: UUID })
})

describe("POST /api/admin/bookkeeping/receipts/commit", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
    const res = await POST(body({}))
    expect(res.status).toBe(403)
  })

  it("rejects a mangled source_ref", async () => {
    const res = await POST(
      body({
        book_id: UUID,
        document_id: UUID,
        account_id: UUID,
        amount_cents: 100,
        occurred_on: "2026-07-18",
        source_ref: "statement:deadbeef",
        business_purpose: "x",
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 when the document does not exist", async () => {
    ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(
      body({
        book_id: UUID,
        document_id: UUID,
        amount_cents: 100,
        occurred_on: "2026-07-18",
        source_ref: `receipt:${UUID}`,
      }),
    )
    expect(res.status).toBe(404)
    expect(insertReceiptEntry).not.toHaveBeenCalled()
  })

  it("409 when the document belongs to a different book", async () => {
    ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, book_id: OTHER_BOOK_UUID })
    const res = await POST(
      body({
        book_id: UUID,
        document_id: UUID,
        amount_cents: 100,
        occurred_on: "2026-07-18",
        source_ref: `receipt:${UUID}`,
      }),
    )
    expect(res.status).toBe(409)
    expect(insertReceiptEntry).not.toHaveBeenCalled()
    // A photo-flow doc (no gmail external_ref) must never be re-homed.
    expect(rehomeEmailReceiptDocument).not.toHaveBeenCalled()
  })

  it("re-homes an UNPOSTED email-ingested document into the chosen book, then posts", async () => {
    ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: UUID, book_id: OTHER_BOOK_UUID, external_ref: "gmail:m1:body", posted_count: null,
    })
    ;(rehomeEmailReceiptDocument as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    const res = await POST(
      body({
        book_id: UUID,
        document_id: UUID,
        amount_cents: 2000,
        occurred_on: "2026-07-18",
        source_ref: `receipt:${UUID}`,
      }),
    )
    expect(res.status).toBe(200)
    expect(rehomeEmailReceiptDocument).toHaveBeenCalledWith(UUID, UUID)
    expect((insertReceiptEntry as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ book_id: UUID })
  })

  it("an already-posted email document keeps the hard 409 — its tax context is settled", async () => {
    ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: UUID, book_id: OTHER_BOOK_UUID, external_ref: "gmail:m1:body", posted_count: 1,
    })
    const res = await POST(
      body({
        book_id: UUID,
        document_id: UUID,
        amount_cents: 2000,
        occurred_on: "2026-07-18",
        source_ref: `receipt:${UUID}`,
      }),
    )
    expect(res.status).toBe(409)
    expect(rehomeEmailReceiptDocument).not.toHaveBeenCalled()
    expect(insertReceiptEntry).not.toHaveBeenCalled()
  })

  it("409 when the DAL guard rejects the re-home (row changed underneath)", async () => {
    ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: UUID, book_id: OTHER_BOOK_UUID, external_ref: "gmail:m1:body", posted_count: null,
    })
    ;(rehomeEmailReceiptDocument as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const res = await POST(
      body({
        book_id: UUID,
        document_id: UUID,
        amount_cents: 2000,
        occurred_on: "2026-07-18",
        source_ref: `receipt:${UUID}`,
      }),
    )
    expect(res.status).toBe(409)
    expect(insertReceiptEntry).not.toHaveBeenCalled()
  })

  it("422 when sensitive account has no purpose", async () => {
    ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: UUID,
      book_id: UUID,
      account_type: "expense",
      requires_business_purpose: true,
    })
    const res = await POST(
      body({
        book_id: UUID,
        document_id: UUID,
        account_id: UUID,
        amount_cents: 100,
        occurred_on: "2026-07-18",
        source_ref: `receipt:${UUID}`,
      }),
    )
    expect(res.status).toBe(422)
    expect(insertReceiptEntry).not.toHaveBeenCalled()
  })

  it("posts the entry with document_id + business_purpose, retains, and links the batch", async () => {
    ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: UUID,
      book_id: UUID,
      account_type: "expense",
      requires_business_purpose: false,
    })
    const res = await POST(
      body({
        book_id: UUID,
        document_id: UUID,
        account_id: UUID,
        amount_cents: 4212,
        occurred_on: "2026-07-18",
        source_ref: `receipt:${UUID}`,
        business_purpose: "team lunch",
        counterparty: "Cafe",
      }),
    )
    expect(res.status).toBe(200)
    expect((insertReceiptEntry as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      document_id: UUID,
      business_purpose: "team lunch",
      source_ref: `receipt:${UUID}`,
    })
    expect(updateDocumentRetainUntil).toHaveBeenCalledWith(UUID, "2033-12-31")
    expect(linkDocumentBatch).toHaveBeenCalledWith(UUID, UUID, expect.any(String), 1)
  })
})

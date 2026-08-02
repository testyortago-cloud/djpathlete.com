import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getDocument: vi.fn(),
  ignoreEmailReceiptDocument: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { getDocument, ignoreEmailReceiptDocument } from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { POST } from "@/app/api/admin/bookkeeping/receipts/ignore/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const admin = { user: { id: UUID, role: "admin" } }
const body = (b: unknown) => ({ json: async () => b }) as never

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: UUID, book_id: UUID, external_ref: "gmail:m1:body", posted_count: null,
  })
  ;(ignoreEmailReceiptDocument as ReturnType<typeof vi.fn>).mockResolvedValue(true)
})

describe("POST /api/admin/bookkeeping/receipts/ignore", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
    const res = await POST(body({ document_id: UUID }))
    expect(res.status).toBe(403)
    expect(ignoreEmailReceiptDocument).not.toHaveBeenCalled()
  })

  it("400 on a malformed document id", async () => {
    const res = await POST(body({ document_id: "not-a-uuid" }))
    expect(res.status).toBe(400)
  })

  it("404 when the document does not exist", async () => {
    ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(body({ document_id: UUID }))
    expect(res.status).toBe(404)
    expect(ignoreEmailReceiptDocument).not.toHaveBeenCalled()
  })

  it("409 when the DAL guard rejects (not an open email receipt)", async () => {
    ;(ignoreEmailReceiptDocument as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const res = await POST(body({ document_id: UUID }))
    expect(res.status).toBe(409)
  })

  it("ignores an open email receipt and records the audit trail", async () => {
    const res = await POST(body({ document_id: UUID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ignored: true })
    expect(ignoreEmailReceiptDocument).toHaveBeenCalledWith(UUID)
    expect((recordAudit as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      action: "bookkeeping.receipt_ignored",
      outcome: "success",
      target: { type: "bookkeeping_document", id: UUID },
    })
  })
})

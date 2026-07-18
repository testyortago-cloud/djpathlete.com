import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getBook: vi.fn(),
  getClose: vi.fn(),
  getCloseById: vi.fn(),
  insertClose: vi.fn(),
  deleteClose: vi.fn(),
  listCloses: vi.fn(),
  listEntriesForReports: vi.fn(),
  stampCloseEmailSent: vi.fn(),
}))

import { GET, POST } from "@/app/api/admin/bookkeeping/closes/route"
import { DELETE } from "@/app/api/admin/bookkeeping/closes/[id]/route"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import {
  deleteClose,
  getBook,
  getClose,
  getCloseById,
  insertClose,
  listCloses,
  listEntriesForReports,
} from "@/lib/db/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const CLOSE = "c0000000-0000-4000-8000-000000000001"
const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const body = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) }) as never

const closeRow = {
  id: CLOSE, book_id: BOOK, period: "2019-01",
  closed_at: "2026-07-18T10:00:00Z", closed_by: ADMIN.user.id,
  income_cents: 5000, expense_cents: 3000, net_cents: 2000, entry_count: 3,
  email_sent_at: null, created_at: "2026-07-18T10:00:00Z", updated_at: "2026-07-18T10:00:00Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BOOK, name: "Darren — DJP Athlete" })
  ;(getClose as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(insertClose as ReturnType<typeof vi.fn>).mockResolvedValue(closeRow)
  ;(listEntriesForReports as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(listCloses as ReturnType<typeof vi.fn>).mockResolvedValue([closeRow])
  ;(getCloseById as ReturnType<typeof vi.fn>).mockResolvedValue(closeRow)
})

describe("GET /api/admin/bookkeeping/closes", () => {
  it("403 non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)).status).toBe(403)
  })
  it("lists closes for a book, unaudited", async () => {
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(200)
    expect((await res.json()).closes).toHaveLength(1)
    expect(listCloses).toHaveBeenCalledWith(BOOK)
    expect(recordAudit).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/bookkeeping/closes", () => {
  it("403 non-admin; insertClose never called", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await POST(body({ book_id: BOOK, period: "2019-01" }))).status).toBe(403)
    expect(insertClose).not.toHaveBeenCalled()
  })
  it("400 invalid period", async () => {
    expect((await POST(body({ book_id: BOOK, period: "2019-13" }))).status).toBe(400)
  })
  it("404 unknown book", async () => {
    ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(body({ book_id: BOOK, period: "2019-01" }))).status).toBe(404)
  })
  it("422 for a non-past month (real isClosablePeriod, future-proof fixture)", async () => {
    const res = await POST(body({ book_id: BOOK, period: "2999-01" }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe("Only complete past months can be closed.")
    expect(insertClose).not.toHaveBeenCalled()
  })
  it("409 double-close", async () => {
    ;(getClose as ReturnType<typeof vi.fn>).mockResolvedValue(closeRow)
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("That month is already closed for this book.")
    expect(insertClose).not.toHaveBeenCalled()
  })
  it("happy path: month-bounded read, REAL snapshotTotals over mocked entries, audit fires", async () => {
    ;(listEntriesForReports as ReturnType<typeof vi.fn>).mockResolvedValue([
      { direction: "income", amount_cents: 5000 },
      { direction: "expense", amount_cents: 2000 },
      { direction: "expense", amount_cents: 1000 },
    ])
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201)
    expect(listEntriesForReports).toHaveBeenCalledWith("2019-01-01", "2019-01-31", BOOK)
    // sign-flip / trunc discriminator: net must be +2000 from 5000 − 3000
    expect(insertClose).toHaveBeenCalledWith({
      book_id: BOOK, period: "2019-01", closed_by: ADMIN.user.id,
      income_cents: 5000, expense_cents: 3000, net_cents: 2000, entry_count: 3,
    })
    expect((await res.json()).close).toEqual(closeRow)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.period_closed",
        category: "commerce",
        outcome: "success",
        metadata: expect.objectContaining({ book_id: BOOK, period: "2019-01", net_cents: 2000 }),
      }),
    )
  })
  it("empty month closes with a zero snapshot (D-7)", async () => {
    const res = await POST(body({ book_id: BOOK, period: "2019-02" }))
    expect(res.status).toBe(201)
    expect(listEntriesForReports).toHaveBeenCalledWith("2019-02-01", "2019-02-28", BOOK)
    expect(insertClose).toHaveBeenCalledWith(
      expect.objectContaining({ income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 }),
    )
  })
})

describe("DELETE /api/admin/bookkeeping/closes/[id] — reopen", () => {
  const del = () =>
    DELETE(new Request("http://x/api", { method: "DELETE" }) as never, { params: Promise.resolve({ id: CLOSE }) })

  it("403 non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await del()).status).toBe(403)
    expect(deleteClose).not.toHaveBeenCalled()
  })
  it("404 when the close row is gone", async () => {
    ;(getCloseById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await del()).status).toBe(404)
    expect(deleteClose).not.toHaveBeenCalled()
  })
  it("deletes and audits the FULL snapshot (D-1: audit preserves history)", async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reopened: true })
    expect(deleteClose).toHaveBeenCalledWith(CLOSE)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.period_reopened",
        category: "commerce",
        outcome: "success",
        metadata: expect.objectContaining({
          book_id: BOOK, period: "2019-01",
          income_cents: 5000, expense_cents: 3000, net_cents: 2000, entry_count: 3,
          closed_at: closeRow.closed_at, closed_by: closeRow.closed_by, email_sent_at: null,
        }),
      }),
    )
  })
})

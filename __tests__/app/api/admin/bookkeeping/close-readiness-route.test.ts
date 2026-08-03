import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ getBook: vi.fn() }))
vi.mock("@/lib/bookkeeping/close-readiness-server", () => ({ gatherCloseReadiness: vi.fn() }))

import { GET } from "@/app/api/admin/bookkeeping/closes/readiness/route"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { getBook } from "@/lib/db/bookkeeping"
import { gatherCloseReadiness } from "@/lib/bookkeeping/close-readiness-server"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }

const readiness = {
  period: "2026-06",
  checks: [{ key: "uncategorized", title: "Everything categorized", severity: "blocker", status: "flagged", count: 2, detail: "…" }],
  blocking: ["uncategorized"],
  warning: [],
  ready: false,
  totals: { income_cents: 100, expense_cents: 40, net_cents: 60, entry_count: 2 },
}

const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/closes/readiness${qs}`) as never

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BOOK, name: "Darren — DJP Athlete" })
  ;(gatherCloseReadiness as ReturnType<typeof vi.fn>).mockResolvedValue(readiness)
})

describe("GET /api/admin/bookkeeping/closes/readiness", () => {
  it("403 non-admin; the gather never runs", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET(req(`?book_id=${BOOK}&period=2026-06`))).status).toBe(403)
    expect(gatherCloseReadiness).not.toHaveBeenCalled()
  })

  it("403 when unauthenticated", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req(`?book_id=${BOOK}&period=2026-06`))).status).toBe(403)
  })

  it("400 on a missing or malformed period", async () => {
    expect((await GET(req(`?book_id=${BOOK}`))).status).toBe(400)
    expect((await GET(req(`?book_id=${BOOK}&period=2026-13`))).status).toBe(400)
    expect((await GET(req(`?book_id=${BOOK}&period=2026-06-15`))).status).toBe(400)
    expect(gatherCloseReadiness).not.toHaveBeenCalled()
  })

  it("400 on a non-uuid book", async () => {
    expect((await GET(req("?book_id=nope&period=2026-06"))).status).toBe(400)
  })

  it("404 for an unknown book", async () => {
    ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req(`?book_id=${BOOK}&period=2026-06`))).status).toBe(404)
    expect(gatherCloseReadiness).not.toHaveBeenCalled()
  })

  it("returns the readiness for the requested book+period, unaudited", async () => {
    const res = await GET(req(`?book_id=${BOOK}&period=2026-06`))
    expect(res.status).toBe(200)
    expect((await res.json()).readiness).toEqual(readiness)
    expect(gatherCloseReadiness).toHaveBeenCalledWith(BOOK, "2026-06", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("500 when the gather throws", async () => {
    ;(gatherCloseReadiness as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"))
    expect((await GET(req(`?book_id=${BOOK}&period=2026-06`))).status).toBe(500)
  })
})

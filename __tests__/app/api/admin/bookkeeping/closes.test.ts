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
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/bookkeeping/email-close", () => ({ sendBooksClosedEmail: vi.fn() }))
vi.mock("@/lib/bookkeeping/close-readiness-server", () => ({ gatherCloseReadiness: vi.fn() }))

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
  stampCloseEmailSent,
} from "@/lib/db/bookkeeping"
import { getSetting } from "@/lib/db/system-settings"
import { sendBooksClosedEmail } from "@/lib/bookkeeping/email-close"
import { gatherCloseReadiness } from "@/lib/bookkeeping/close-readiness-server"
import { NOT_READY_MESSAGE } from "@/lib/bookkeeping/close-readiness"

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
  ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (_key: string, fallback: unknown) => fallback)
  ;(sendBooksClosedEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
  ;(gatherCloseReadiness as ReturnType<typeof vi.fn>).mockResolvedValue(readyReadiness)
})

const readyReadiness = {
  period: "2019-01", checks: [], blocking: [], warning: [], ready: true,
  totals: { income_cents: 5000, expense_cents: 3000, net_cents: 2000, entry_count: 3 },
}
const notReadyReadiness = { ...readyReadiness, blocking: ["uncategorized"], warning: ["earlier_open"], ready: false }

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
  it("422 when readiness has blockers — nothing is frozen", async () => {
    ;(gatherCloseReadiness as ReturnType<typeof vi.fn>).mockResolvedValue(notReadyReadiness)
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe(NOT_READY_MESSAGE)
    // the panel's own payload rides along so the client never re-fetches to explain the refusal
    expect(json.readiness.blocking).toEqual(["uncategorized"])
    expect(insertClose).not.toHaveBeenCalled()
    expect(listEntriesForReports).not.toHaveBeenCalled()
  })
  it("override:true closes anyway and records WHICH blockers were bypassed", async () => {
    ;(gatherCloseReadiness as ReturnType<typeof vi.fn>).mockResolvedValue(notReadyReadiness)
    const res = await POST(body({ book_id: BOOK, period: "2019-01", override: true }))
    expect(res.status).toBe(201)
    expect(insertClose).toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.period_closed",
        metadata: expect.objectContaining({
          readiness_overridden: ["uncategorized"],
          readiness_warnings: ["earlier_open"],
        }),
      }),
    )
  })
  it("override:false is not a bypass — it still refuses", async () => {
    ;(gatherCloseReadiness as ReturnType<typeof vi.fn>).mockResolvedValue(notReadyReadiness)
    expect((await POST(body({ book_id: BOOK, period: "2019-01", override: false }))).status).toBe(422)
    expect(insertClose).not.toHaveBeenCalled()
  })
  it("warnings alone never block, and are recorded on the audit row", async () => {
    ;(gatherCloseReadiness as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...readyReadiness,
      warning: ["statement_coverage"],
    })
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ readiness_warnings: ["statement_coverage"] }),
      }),
    )
    // a clean close must NOT claim an override happened
    const call = (recordAudit as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as { action: string }).action === "bookkeeping.period_closed",
    )
    expect((call![0] as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty("readiness_overridden")
  })
  it("the readiness gate runs AFTER the already-closed check (no wasted gather)", async () => {
    ;(getClose as ReturnType<typeof vi.fn>).mockResolvedValue(closeRow)
    expect((await POST(body({ book_id: BOOK, period: "2019-01" }))).status).toBe(409)
    expect(gatherCloseReadiness).not.toHaveBeenCalled()
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

describe("POST /closes — books-closed email (D-15)", () => {
  const flagOn = (accountant = "") =>
    (getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string, fallback: unknown) => {
      if (key === "bookkeeping_close_email_enabled") return true
      if (key === "bookkeeping_accountant_email") return accountant
      return fallback
    })
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it("flag OFF (default) → close succeeds, no send attempted", async () => {
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201)
    await settle()
    expect(sendBooksClosedEmail).not.toHaveBeenCalled()
    expect(stampCloseEmailSent).not.toHaveBeenCalled()
  })

  it("flag ON + stored accountant → sends to the accountant, stamps email_sent_at, audits success", async () => {
    flagOn("cpa@example.com")
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201) // response never waits on the send
    await vi.waitFor(() => expect(sendBooksClosedEmail).toHaveBeenCalled())
    expect(sendBooksClosedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "cpa@example.com", bookName: "Darren — DJP Athlete", period: "2019-01" }),
    )
    await vi.waitFor(() => expect(stampCloseEmailSent).toHaveBeenCalledWith(CLOSE))
    await vi.waitFor(() =>
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "bookkeeping.close_emailed", outcome: "success" }),
      ),
    )
  })

  it("flag ON + empty accountant → falls back to the coach alone", async () => {
    // Save/restore idiom (email-pack.test.ts:14-35 precedent) — .env.local
    // defines a real COACH_EMAIL, so an unconditional delete would leak into
    // later tests in this file/worker; this stubs it for one test only.
    const origCoachEmail = process.env.COACH_EMAIL
    flagOn("")
    process.env.COACH_EMAIL = "darren@darrenjpaul.com"
    try {
      const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
      expect(res.status).toBe(201)
      await vi.waitFor(() =>
        expect(sendBooksClosedEmail).toHaveBeenCalledWith(
          expect.objectContaining({ recipient: "darren@darrenjpaul.com" }),
        ),
      )
    } finally {
      if (origCoachEmail !== undefined) {
        process.env.COACH_EMAIL = origCoachEmail
      } else {
        delete process.env.COACH_EMAIL
      }
    }
  })

  it("flag read REJECTS → close STILL 201, no send attempted, no stamp", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string, fallback: unknown) => {
      if (key === "bookkeeping_close_email_enabled") throw new Error("db unreachable")
      return fallback
    })
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201)
    expect((await res.json()).close).toEqual(closeRow)
    await settle()
    expect(sendBooksClosedEmail).not.toHaveBeenCalled()
    expect(stampCloseEmailSent).not.toHaveBeenCalled()
  })

  it("send failure → close STILL 201, close_emailed audited as failure, no stamp", async () => {
    flagOn("cpa@example.com")
    ;(sendBooksClosedEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "boom" })
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201)
    await vi.waitFor(() =>
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "bookkeeping.close_emailed",
          outcome: "failure",
          metadata: expect.objectContaining({ error: "boom" }),
        }),
      ),
    )
    expect(stampCloseEmailSent).not.toHaveBeenCalled()
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

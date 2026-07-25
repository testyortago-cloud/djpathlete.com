import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listBooks: vi.fn(), latestPayoutArrivalDate: vi.fn(), listNonTerminalPayouts: vi.fn(),
  upsertPayouts: vi.fn(), upsertPayoutLines: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/stripe", () => ({
  stripe: {
    payouts: { list: vi.fn(), retrieve: vi.fn() },
    balanceTransactions: { list: vi.fn() },
  },
}))

import { isCronSkipped } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import {
  listBooks, latestPayoutArrivalDate, listNonTerminalPayouts, upsertPayouts, upsertPayoutLines,
} from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { stripe } from "@/lib/stripe"
import { POST } from "@/app/api/admin/internal/bookkeeping-payout-sync/route"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`
const BOOK = "b0000000-0000-4000-8000-000000000001"

const books = [
  { id: "b0000000-0000-4000-8000-000000000003", name: "Household & Personal", book_kind: "household", is_primary: false, owner_label: "Shared", sort_order: 2, archived_at: null },
  { id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, owner_label: "Darren", sort_order: 0, archived_at: null },
]
// 2026-07-07T00:00:00Z = 1783382400 s; 2026-07-03 = 1783036800 s
const stripePayout = { id: "po_1", amount: 9600, arrival_date: 1783382400, status: "paid", currency: "usd", created: 1783036800 }
const chargeTxn = { id: "txn_1", type: "charge", amount: 10000, fee: 400, net: 9600, created: 1783036800, description: "Client payment", source: "ch_1" }
// The payout's OWN balance txn shows up in the per-payout listing — must be filtered out of lines.
const selfTxn = { id: "txn_self", type: "payout", amount: -9600, fee: 0, net: -9600, created: 1783382400, description: "STRIPE PAYOUT", source: "po_1" }
const pager = <T,>(items: T[]) => ({ autoPagingToArray: vi.fn().mockResolvedValue(items) })

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-payout-sync", {
    method: "POST", headers: { authorization: authHeader },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
  ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(books)
  ;(latestPayoutArrivalDate as ReturnType<typeof vi.fn>).mockResolvedValue("2026-07-20")
  ;(listNonTerminalPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(stripe.payouts.list as ReturnType<typeof vi.fn>).mockReturnValue(pager([stripePayout]))
  ;(stripe.balanceTransactions.list as ReturnType<typeof vi.fn>).mockReturnValue(pager([chargeTxn, selfTxn]))
  ;(upsertPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "bp-1", stripe_payout_id: "po_1" }])
  ;(upsertPayoutLines as ReturnType<typeof vi.fn>).mockResolvedValue(1)
})

describe("POST /api/admin/internal/bookkeeping-payout-sync", () => {
  it("401 with a missing bearer token", async () => {
    const res = await POST(makeRequest(""))
    expect(res.status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("401 with a wrong bearer token", async () => {
    expect((await POST(makeRequest("Bearer wrong"))).status).toBe(401)
  })

  it("200 {skipped} with no logCronStart when the flag is off", async () => {
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).skipped).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
    expect(upsertPayouts).not.toHaveBeenCalled()
  })

  it("happy path: watermark-windowed list, self-payout txn filtered, gross/fee derived, audit on upserted > 0", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, upserted: 1, upserted_lines: 1 })
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingPayoutSyncCron")
    // Window from the watermark: 2026-07-20 − 14d = 2026-07-06 = 1783296000 s
    expect(stripe.payouts.list).toHaveBeenCalledWith({ limit: 100, arrival_date: { gte: 1783296000 } })
    // Payout row: amount is NET; gross/fee are Σ over NON-payout lines only
    const payoutRows = (upsertPayouts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payoutRows).toEqual([expect.objectContaining({
      stripe_payout_id: "po_1", book_id: BOOK, amount_cents: 9600,
      gross_cents: 10000, fee_cents: 400, arrival_date: "2026-07-07", status: "paid",
    })])
    // Lines: the type:"payout" self-txn must NOT be stored
    const lineRows = (upsertPayoutLines as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(lineRows).toEqual([expect.objectContaining({
      payout_id: "bp-1", stripe_balance_txn_id: "txn_1", type: "charge",
      amount_cents: 10000, fee_cents: 400, net_cents: 9600, txn_date: "2026-07-03", source_ref: "ch_1",
    })])
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.payout_synced", category: "commerce", outcome: "success",
      actor: expect.objectContaining({ role: "system" }),
    }))
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ upserted: 1, window_from: "2026-07-06" }),
    )
  })

  it("cold start (null watermark) lists with NO arrival_date bound (full history)", async () => {
    ;(latestPayoutArrivalDate as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await POST(makeRequest())
    expect(stripe.payouts.list).toHaveBeenCalledWith({ limit: 100 })
  })

  it("eligibility arm: a stored in_transit payout outside the window is re-pulled by id", async () => {
    ;(stripe.payouts.list as ReturnType<typeof vi.fn>).mockReturnValue(pager([]))
    ;(listNonTerminalPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "bp-2", stripe_payout_id: "po_flip", status: "in_transit", book_id: BOOK, arrival_date: "2026-05-01" },
    ])
    ;(stripe.payouts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue(
      { ...stripePayout, id: "po_flip", status: "paid" },
    )
    ;(upsertPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "bp-2", stripe_payout_id: "po_flip" }])
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(stripe.payouts.retrieve).toHaveBeenCalledWith("po_flip")
    const payoutRows = (upsertPayouts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payoutRows[0]).toMatchObject({ stripe_payout_id: "po_flip", status: "paid" })
  })

  it("gross − fee ≠ payout amount → reconciliation warning in detail (run still succeeds)", async () => {
    ;(stripe.balanceTransactions.list as ReturnType<typeof vi.fn>).mockReturnValue(
      pager([{ ...chargeTxn, fee: 500, net: 9500 }, selfTxn]), // 10000−500=9500 ≠ 9600
    )
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const detail = (logCronEnd as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(detail.warnings.some((w: string) => w.includes("po_1"))).toBe(true)
  })

  it("zero payouts: success, upserted 0, NO audit row", async () => {
    ;(stripe.payouts.list as ReturnType<typeof vi.fn>).mockReturnValue(pager([]))
    ;(upsertPayouts as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(recordAudit).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ upserted: 0 }),
    )
  })

  it("a Stripe read failure → 500 + logCronEnd failed (fail-closed; watchdog is the alarm)", async () => {
    ;(stripe.payouts.list as ReturnType<typeof vi.fn>).mockReturnValue({
      autoPagingToArray: vi.fn().mockRejectedValue(new Error("stripe boom")),
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(upsertPayouts).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed",
      expect.objectContaining({ message: expect.stringContaining("stripe boom") }),
    )
  })

  it("no primary business book → 500 + logCronEnd failed", async () => {
    ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([books[0]])
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed",
      expect.objectContaining({ message: expect.stringContaining("primary business book") }),
    )
  })
})

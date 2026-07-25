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
  { id: "b0000000-0000-4000-8000-000000000003", name: "Household & Personal", book_kind: "household", is_primary: false, owner_label: "Shared", sort_order: 2, archived_at: null, currency: "usd" },
  { id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, owner_label: "Darren", sort_order: 0, archived_at: null, currency: "usd" },
]
// 2026-07-07T00:00:00Z = 1783382400 s; 2026-07-03 = 1783036800 s
const stripePayout = { id: "po_1", amount: 9600, arrival_date: 1783382400, status: "paid", currency: "usd", created: 1783036800 }
const chargeTxn = { id: "txn_1", type: "charge", amount: 10000, fee: 400, net: 9600, created: 1783036800, description: "Client payment", source: "ch_1" }
// The payout's OWN balance txn shows up in the per-payout listing — must be filtered out of lines.
const selfTxn = { id: "txn_self", type: "payout", amount: -9600, fee: 0, net: -9600, created: 1783382400, description: "STRIPE PAYOUT", source: "po_1" }
const refundTxn = { id: "txn_2", type: "refund", amount: -2500, fee: -50, net: -2450, created: 1783036800, description: "Refund", source: "re_1" }
const pager = <T,>(items: T[]) => ({ autoPagingToArray: vi.fn().mockResolvedValue(items) })
const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
/** N payouts, po_000 = OLDEST, returned by Stripe NEWEST-first (as the API does). */
function manyPayouts(n: number) {
  const base = 1783382400 - n * 86400
  return Array.from({ length: n }, (_, i) => ({
    ...stripePayout, id: `po_${String(i).padStart(3, "0")}`, arrival_date: base + i * 86400,
  })).reverse()
}

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
    // Balance txns MUST be scoped to the single payout — an unscoped list would
    // attach the whole account's history to every payout row.
    expect(stripe.balanceTransactions.list).toHaveBeenCalledWith({ payout: "po_1", limit: 100 })
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

  it("multi-line payout: signed gross/fee summed over EVERY non-payout line (refund included)", async () => {
    // 10000 + (−2500) = 7500 gross; 400 + (−50) = 350 fee; 7500 − 350 = 7150 ≠ 9600 → warn
    mockFn(stripe.balanceTransactions.list).mockReturnValue(pager([chargeTxn, refundTxn, selfTxn]))
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const payoutRows = mockFn(upsertPayouts).mock.calls[0][0]
    expect(payoutRows[0]).toMatchObject({ gross_cents: 7500, fee_cents: 350 })
    const lineRows = mockFn(upsertPayoutLines).mock.calls[0][0]
    expect(lineRows.map((r: { stripe_balance_txn_id: string }) => r.stripe_balance_txn_id)).toEqual(["txn_1", "txn_2"])
    expect(lineRows[1]).toMatchObject({ amount_cents: -2500, fee_cents: -50, net_cents: -2450 })
  })

  // ── Finding 1: per-payout write, not a two-phase batch write ──────────────
  it("writes each payout's row and its lines together — a line failure cannot strand earlier committed payouts", async () => {
    const p2 = { ...stripePayout, id: "po_2", arrival_date: 1783382400 + 86400 }
    mockFn(stripe.payouts.list).mockReturnValue(pager([stripePayout, p2]))
    mockFn(upsertPayouts).mockImplementation(async (rows: Array<{ stripe_payout_id: string }>) =>
      rows.map((r) => ({ id: `bp-${r.stripe_payout_id}`, stripe_payout_id: r.stripe_payout_id })))
    mockFn(upsertPayoutLines).mockRejectedValueOnce(new Error("lines boom"))

    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    // Exactly ONE payout row may be committed before the line write is attempted.
    expect(mockFn(upsertPayouts).mock.calls[0][0]).toHaveLength(1)
    expect(mockFn(upsertPayouts).mock.calls[0][0][0]).toMatchObject({ stripe_payout_id: "po_1" })
    // po_2's row must NOT have been committed — its fee lines would be unrecoverable.
    expect(mockFn(upsertPayouts).mock.calls.flatMap((c) => c[0]).map((r: { stripe_payout_id: string }) => r.stripe_payout_id))
      .toEqual(["po_1"])
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed",
      expect.objectContaining({ message: expect.stringContaining("lines boom") }),
    )
  })

  // ── Finding 2: a balance txn shared by two payouts must never collide in ──
  // one upsert (Postgres 21000 "cannot affect row a second time").
  it("a balance txn claimed by two payouts in one batch never lands twice in a single upsert call", async () => {
    const failed = { ...stripePayout, id: "po_old", arrival_date: 1783382400, status: "failed" }
    const replacement = { ...stripePayout, id: "po_new", arrival_date: 1783382400 + 86400 }
    mockFn(stripe.payouts.list).mockReturnValue(pager([failed, replacement]))
    mockFn(stripe.balanceTransactions.list).mockReturnValue(pager([chargeTxn, selfTxn])) // same txn_1 for both
    mockFn(upsertPayouts).mockImplementation(async (rows: Array<{ stripe_payout_id: string }>) =>
      rows.map((r) => ({ id: `bp-${r.stripe_payout_id}`, stripe_payout_id: r.stripe_payout_id })))
    mockFn(upsertPayoutLines).mockResolvedValue(1)

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    for (const call of mockFn(upsertPayoutLines).mock.calls) {
      const ids = call[0].map((r: { stripe_balance_txn_id: string }) => r.stripe_balance_txn_id)
      expect(new Set(ids).size).toBe(ids.length)
    }
    // Oldest-first ⇒ the NEWER payout writes last and owns the shared txn.
    const lastCall = mockFn(upsertPayoutLines).mock.calls.at(-1)![0]
    expect(lastCall[0]).toMatchObject({ stripe_balance_txn_id: "txn_1", payout_id: "bp-po_new" })
  })

  // ── Finding 3: an unresolvable stored payout id must not wedge the cron ───
  it("eligibility re-pull failure → warning + run continues (never a permanent 500 loop)", async () => {
    mockFn(listNonTerminalPayouts).mockResolvedValue([
      { id: "bp-gone", stripe_payout_id: "po_gone", status: "pending", book_id: BOOK, arrival_date: "2026-05-01" },
    ])
    mockFn(stripe.payouts.retrieve).mockRejectedValue(new Error("No such payout: 'po_gone'"))

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.warnings.some((w: string) => w.includes("po_gone"))).toBe(true)
    // The listed payout is still synced — one bad stored id cannot block the run.
    expect(mockFn(upsertPayouts).mock.calls[0][0][0]).toMatchObject({ stripe_payout_id: "po_1" })
  })

  // ── Finding 5: oldest-first ordering + the 200 cap ARE the backlog guarantee ──
  it("cold start with 250 payouts: oldest-first batch of 200, more_pending true", async () => {
    mockFn(latestPayoutArrivalDate).mockResolvedValue(null)
    mockFn(stripe.payouts.list).mockReturnValue(pager(manyPayouts(250)))
    mockFn(upsertPayouts).mockImplementation(async (rows: Array<{ stripe_payout_id: string }>) =>
      rows.map((r) => ({ id: `bp-${r.stripe_payout_id}`, stripe_payout_id: r.stripe_payout_id })))

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, listed: 250, more_pending: true, upserted: 200 })
    const written = mockFn(upsertPayouts).mock.calls
      .flatMap((c) => c[0]).map((r: { stripe_payout_id: string }) => r.stripe_payout_id)
    expect(written).toHaveLength(200)
    expect(written[0]).toBe("po_000")   // OLDEST first — a newest-first batch would strand the backlog
    expect(written[199]).toBe("po_199")
    expect(written).not.toContain("po_249")
  })

  // ── Finding 6: a payout whose upsert returns no row must not drop lines silently ──
  it("upsert returning no row → warning naming the payout (never a silent line drop)", async () => {
    mockFn(upsertPayouts).mockResolvedValue([])
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.upserted).toBe(0)
    expect(body.warnings.some((w: string) => w.includes("po_1"))).toBe(true)
    expect(upsertPayoutLines).not.toHaveBeenCalled()
  })

  // ── Finding 8: a pending payout's ESTIMATED FUTURE arrival_date must not eat the overlap ──
  it("a future watermark is clamped to today so the 14-day overlap is never shortened", async () => {
    mockFn(latestPayoutArrivalDate).mockResolvedValue("2099-01-01")
    const today = new Date().toISOString().slice(0, 10)
    const expected = (Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000) / 1000
    await POST(makeRequest())
    expect(stripe.payouts.list).toHaveBeenCalledWith({ limit: 100, arrival_date: { gte: expected } })
  })

  // ── MANUAL payouts: Stripe enumerates constituent balance transactions for ──
  // AUTOMATIC payouts only, so a dashboard "Pay out now" returns [] and its real
  // processing fees never enter the mirror. That state must be PERSISTED, not
  // just whispered into cron_runs.detail.warnings, because the report layer
  // otherwise cannot tell "$0.00 of fees" from "we have no idea".
  it("a payout whose lines never arrive is stored UNRECONCILED with the signed miss", async () => {
    mockFn(stripe.balanceTransactions.list).mockReturnValue(pager([])) // manual payout
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const row = mockFn(upsertPayouts).mock.calls[0][0][0]
    expect(row).toMatchObject({
      stripe_payout_id: "po_1", gross_cents: 0, fee_cents: 0,
      fees_reconciled: false, reconcile_delta_cents: -9600, // (0 − 0) − 9600
    })
    const body = await res.json()
    expect(body.unreconciled).toBe(1)
    expect(body.warnings.some((w: string) => w.includes("po_1") && w.toLowerCase().includes("automatic"))).toBe(true)
  })

  it("a fully explained payout is stored RECONCILED with a zero delta", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(mockFn(upsertPayouts).mock.calls[0][0][0]).toMatchObject({
      fees_reconciled: true, reconcile_delta_cents: 0,
    })
    expect((await res.json()).unreconciled).toBe(0)
  })

  it("a partially explained payout is unreconciled with the exact signed delta", async () => {
    // 10000 − 500 = 9500 vs net 9600 → delta −100
    mockFn(stripe.balanceTransactions.list).mockReturnValue(pager([{ ...chargeTxn, fee: 500, net: 9500 }, selfTxn]))
    await POST(makeRequest())
    expect(mockFn(upsertPayouts).mock.calls[0][0][0]).toMatchObject({
      fees_reconciled: false, reconcile_delta_cents: -100,
    })
  })

  // ── Foreign-currency payouts must never be summed into a USD book ─────────
  it("a payout in another currency is SKIPPED with a warning — its minor units are not the book's", async () => {
    mockFn(stripe.payouts.list).mockReturnValue(pager([
      { ...stripePayout, id: "po_cad", currency: "cad" },
      stripePayout,
    ]))
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped_currency).toBe(1)
    expect(body.upserted).toBe(1)
    // Never even fetched — an unconvertible payout is not worth a Stripe call.
    expect(stripe.balanceTransactions.list).not.toHaveBeenCalledWith(expect.objectContaining({ payout: "po_cad" }))
    const written = mockFn(upsertPayouts).mock.calls.flatMap((c) => c[0]).map((r: { stripe_payout_id: string }) => r.stripe_payout_id)
    expect(written).toEqual(["po_1"])
    expect(body.warnings.some((w: string) => w.includes("po_cad") && w.includes("cad"))).toBe(true)
  })

  it("currency comparison is case-insensitive (Stripe lowercases; the book column may not)", async () => {
    mockFn(listBooks).mockResolvedValue([books[0], { ...books[1], currency: "USD" }])
    const res = await POST(makeRequest())
    expect((await res.json()).skipped_currency).toBe(0)
    expect(mockFn(upsertPayouts).mock.calls[0][0][0]).toMatchObject({ stripe_payout_id: "po_1" })
  })

  // ── Truncated warnings must announce the truncation ───────────────────────
  it("more warnings than the cap → capped list PLUS a total and a truncation marker", async () => {
    mockFn(latestPayoutArrivalDate).mockResolvedValue(null)
    mockFn(stripe.payouts.list).mockReturnValue(pager(manyPayouts(25)))
    mockFn(stripe.balanceTransactions.list).mockReturnValue(pager([])) // every payout warns
    mockFn(upsertPayouts).mockImplementation(async (rows: Array<{ stripe_payout_id: string }>) =>
      rows.map((r) => ({ id: `bp-${r.stripe_payout_id}`, stripe_payout_id: r.stripe_payout_id })))

    const body = await (await POST(makeRequest())).json()
    expect(body.warnings).toHaveLength(20)
    expect(body.warnings_total).toBe(25)
    expect(body.warnings_truncated).toBe(true)
    expect(body.unreconciled).toBe(25)
  })

  it("warnings under the cap are not marked truncated", async () => {
    const body = await (await POST(makeRequest())).json()
    expect(body.warnings_total).toBe(0)
    expect(body.warnings_truncated).toBe(false)
  })
})

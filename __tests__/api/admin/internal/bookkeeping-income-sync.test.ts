import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listBooks: vi.fn(), listAccounts: vi.fn(), listPlatformIncome: vi.fn(),
  latestPlatformImportDate: vi.fn(), insertImportedEntries: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { isCronSkipped } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import {
  listBooks, listAccounts, listPlatformIncome, latestPlatformImportDate, insertImportedEntries,
} from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { computeSyncWindow } from "@/lib/bookkeeping/income-sync-window"
import { POST } from "@/app/api/admin/internal/bookkeeping-income-sync/route"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`
const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_PACKS = "a0000000-0000-4000-8000-000000000001"

const books = [
  { id: "b0000000-0000-4000-8000-000000000003", name: "Household & Personal", book_kind: "household", is_primary: false, owner_label: "Shared", sort_order: 2, archived_at: null },
  { id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, owner_label: "Darren", sort_order: 0, archived_at: null },
]
const accounts = [
  { id: ACC_PACKS, book_id: BOOK, name: "Session Packs", account_type: "income", service_line: "session_packs", tax_category: null, sort_order: 0, is_deductible_candidate: false, requires_business_purpose: false, archived_at: null },
]
// One paid pack → the REAL adapter emits exactly one session_packs draft; the
// REAL matcher assigns ACC_PACKS. Stripe id present → heuristic-eligible (irrelevant here).
const paidPack = {
  id: "cp000000-0000-4000-8000-000000000001", payment_status: "paid",
  purchased_at: "2026-07-22T15:00:00Z", price_cents: 25000, credits_total: 5,
  product_name: "5-Pack", client_name: "Vikram", stripe_session_id: "cs_1", stripe_payment_id: null,
}
const emptySources = { payments: [], shopOrders: [], clientPackages: [], eventSignups: [], memberships: [] }
const insertOk = { inserted: 1, rejected_closed: 0, rejected_closed_rows: [], skipped_alt_ref: 0 }

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-income-sync", {
    method: "POST",
    headers: { authorization: authHeader },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
  ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(books)
  ;(listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(accounts)
  ;(latestPlatformImportDate as ReturnType<typeof vi.fn>).mockResolvedValue("2026-07-20")
  ;(listPlatformIncome as ReturnType<typeof vi.fn>).mockResolvedValue({ ...emptySources, clientPackages: [paidPack] })
  ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue(insertOk)
})

describe("POST /api/admin/internal/bookkeeping-income-sync", () => {
  it("401 with a missing bearer token", async () => {
    const res = await POST(makeRequest(""))
    expect(res.status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("401 with a wrong bearer token", async () => {
    const res = await POST(makeRequest("Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("200 {skipped} with no logCronStart when the flag is off", async () => {
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).skipped).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
    expect(insertImportedEntries).not.toHaveBeenCalled()
  })

  it("happy path: watermark window, real adapter + matcher, audit on inserted > 0", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, inserted: 1 })
    // Byte-identical cron name (single-owner contract)
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingIncomeSyncCron")
    // Window derived from the watermark: from is deterministic (watermark − 14d)
    const [from, to] = (listPlatformIncome as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(from).toBe("2026-07-06")
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The REAL adapter emitted the pack draft; the REAL matcher assigned the account
    const [bookId, batchId, drafts] = (insertImportedEntries as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(bookId).toBe(BOOK)
    expect(batchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(drafts).toEqual([expect.objectContaining({
      direction: "income", amount_cents: 25000, source: "platform_import",
      source_ref: `client_packages:${paidPack.id}`, service_line: "session_packs",
      account_id: ACC_PACKS,
    })])
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.income_synced", category: "commerce", outcome: "success",
      actor: expect.objectContaining({ role: "system" }),
      metadata: expect.objectContaining({ inserted: 1, import_batch_id: batchId }),
    }))
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ inserted: 1, window_from: "2026-07-06" }),
    )
  })

  it("null watermark → 90-day fallback window", async () => {
    ;(latestPlatformImportDate as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await POST(makeRequest())
    const [from, to] = (listPlatformIncome as ReturnType<typeof vi.fn>).mock.calls[0]
    expect({ from, to }).toEqual(computeSyncWindow(null, to))
    expect(from < to).toBe(true)
  })

  it("zero-new night: success with inserted 0 and NO audit row", async () => {
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue({ ...insertOk, inserted: 0 })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(recordAudit).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ inserted: 0 }),
    )
  })

  it("unmatched service line → account_id null (lands as Uncategorized)", async () => {
    ;(listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await POST(makeRequest())
    const [, , drafts] = (insertImportedEntries as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(drafts[0].account_id).toBeNull()
  })

  it("adapter warnings surface in cron_runs details", async () => {
    ;(listPlatformIncome as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...emptySources,
      payments: [{ id: "p1", status: "refunded", amount_cents: 5000, created_at: "2026-07-21T10:00:00Z", metadata: {}, user_id: null, description: null }],
    })
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue({ ...insertOk, inserted: 0 })
    await POST(makeRequest())
    const detail = (logCronEnd as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(detail.warnings.some((w: string) => w.includes("refunded"))).toBe(true)
  })

  it("no primary business book → 500 + logCronEnd failed", async () => {
    ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([books[0]]) // household only
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(insertImportedEntries).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed",
      expect.objectContaining({ message: expect.stringContaining("primary business book") }),
    )
  })
})

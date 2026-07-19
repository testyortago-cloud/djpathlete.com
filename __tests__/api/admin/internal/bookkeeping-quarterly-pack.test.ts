// __tests__/api/admin/internal/bookkeeping-quarterly-pack.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({
  isCronSkipped: vi.fn(),
  getSetting: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))
vi.mock("@/lib/db/cron-runs", () => ({
  logCronStart: vi.fn(),
  logCronEnd: vi.fn(),
}))
vi.mock("@/lib/bookkeeping/period", () => ({
  presetRange: vi.fn(),
}))
vi.mock("@/lib/bookkeeping/report-data", () => ({
  loadReportBundle: vi.fn(),
}))
vi.mock("@/lib/db/bookkeeping", () => ({
  listAllDocuments: vi.fn(),
  listAssets: vi.fn(),
}))
vi.mock("@/lib/bookkeeping/accountant-pack", () => ({
  buildAccountantPack: vi.fn(),
}))
vi.mock("@/lib/bookkeeping/email-pack", () => ({
  sendAccountantPack: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({
  recordAudit: vi.fn(),
}))

import { isCronSkipped, getSetting } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { presetRange } from "@/lib/bookkeeping/period"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments, listAssets } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { sendAccountantPack } from "@/lib/bookkeeping/email-pack"
import { recordAudit } from "@/lib/audit/record"
import { POST } from "@/app/api/admin/internal/bookkeeping-quarterly-pack/route"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-quarterly-pack", {
    method: "POST",
    headers: { authorization: authHeader },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue("cpa@firm.com")
  ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
  ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(presetRange as ReturnType<typeof vi.fn>).mockReturnValue({ from: "2026-01-01", to: "2026-03-31" })
  ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue({
    books: [],
    accounts: [],
    entries: [{ id: "e1" }, { id: "e2" }],
  })
  ;(listAllDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(listAssets as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(buildAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("xlsx"))
  ;(sendAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
})

describe("POST /api/admin/internal/bookkeeping-quarterly-pack", () => {
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
    const body = await res.json()
    expect(body.skipped).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
    expect(sendAccountantPack).not.toHaveBeenCalled()
  })

  it("200 skipped + logCronEnd success when no accountant email is stored", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue("")
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe("no accountant email configured")
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingQuarterlyPackCron")
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      "success",
      expect.objectContaining({ skipped: "no accountant email configured" }),
    )
    expect(sendAccountantPack).not.toHaveBeenCalled()
  })

  it("happy path: last_quarter window flows to loadReportBundle + sendAccountantPack, logCronEnd success", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.sentTo).toBe("cpa@firm.com")
    expect(body.from).toBe("2026-01-01")
    expect(body.to).toBe("2026-03-31")

    expect(presetRange).toHaveBeenCalledWith("last_quarter", expect.any(String))
    expect(loadReportBundle).toHaveBeenCalledWith("2026-01-01", "2026-03-31")
    expect(buildAccountantPack).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-01-01", to: "2026-03-31" }),
    )
    expect(sendAccountantPack).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "cpa@firm.com", from: "2026-01-01", to: "2026-03-31" }),
    )
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.report_emailed",
        category: "commerce",
        outcome: "success",
        metadata: expect.objectContaining({ recipient_email: "cpa@firm.com", trigger: "quarterly_cron" }),
      }),
    )
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      "success",
      expect.objectContaining({ sentTo: "cpa@firm.com" }),
    )
  })

  it("500 + logCronEnd failed when the send errors", async () => {
    ;(sendAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "resend boom" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      "failed",
      expect.objectContaining({ message: expect.stringContaining("resend boom") }),
    )
  })
})

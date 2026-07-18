import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }))
vi.mock("@/lib/bookkeeping/report-data", () => ({ loadReportBundle: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ listAllDocuments: vi.fn() }))
vi.mock("@/lib/bookkeeping/accountant-pack", () => ({ buildAccountantPack: vi.fn() }))
vi.mock("@/lib/bookkeeping/email-pack", () => ({ sendAccountantPack: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { sendAccountantPack } from "@/lib/bookkeeping/email-pack"
import { recordAudit } from "@/lib/audit/record"
import { POST } from "@/app/api/admin/bookkeeping/reports/email-pack/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const admin = { user: { id: UUID, role: "admin" } }
const body = (b: unknown) => ({ json: async () => b }) as never
const okBody = { from: "2026-01-01", to: "2026-03-31", recipient_email: "cpa@firm.com" }

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(true) // flag ON
  ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue({ books: [], accounts: [], entries: [] })
  ;(listAllDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(buildAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("xlsx"))
  ;(sendAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
})

describe("POST /api/admin/bookkeeping/reports/email-pack", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(body(okBody))).status).toBe(403)
    expect(sendAccountantPack).not.toHaveBeenCalled()
  })
  it("404 when the flag is OFF (outbound stays dark by default)", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    expect((await POST(body(okBody))).status).toBe(404)
    expect(sendAccountantPack).not.toHaveBeenCalled()
  })
  it("400 on invalid recipient", async () => {
    expect((await POST(body({ ...okBody, recipient_email: "nope" }))).status).toBe(400)
  })
  it("502 + failure audit when the send fails", async () => {
    ;(sendAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "boom" })
    const res = await POST(body(okBody))
    expect(res.status).toBe(502)
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.report_emailed", outcome: "failure",
    }))
  })
  it("200: builds, sends, audits success; remember=false leaves the stored address alone", async () => {
    const res = await POST(body(okBody))
    expect(res.status).toBe(200)
    expect(buildAccountantPack).toHaveBeenCalled()
    expect(sendAccountantPack).toHaveBeenCalledWith(expect.objectContaining({ recipient: "cpa@firm.com" }))
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.report_emailed", category: "commerce", outcome: "success",
      metadata: expect.objectContaining({ recipient_email: "cpa@firm.com" }),
    }))
    expect(setSetting).not.toHaveBeenCalled()
  })
  it("remember=true persists bookkeeping_accountant_email", async () => {
    await POST(body({ ...okBody, remember: true }))
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_accountant_email", "cpa@firm.com", UUID)
  })
  it("remember=true + send failure does NOT persist the address", async () => {
    ;(sendAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "boom" })
    const res = await POST(body({ ...okBody, remember: true }))
    expect(res.status).toBe(502)
    expect(setSetting).not.toHaveBeenCalled()
  })
})

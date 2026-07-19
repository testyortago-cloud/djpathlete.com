import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/bookkeeping/report-data", () => ({ loadReportBundle: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ listAllDocuments: vi.fn(), listAssets: vi.fn() }))
vi.mock("@/lib/bookkeeping/accountant-pack", () => ({ buildAccountantPack: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments, listAssets } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { recordAudit } from "@/lib/audit/record"
import { GET } from "@/app/api/admin/bookkeeping/reports/accountant-pack/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const admin = { user: { id: UUID, role: "admin" } }
const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/reports/accountant-pack?${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue({ books: [], accounts: [], entries: [] })
  ;(listAllDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(listAssets as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(buildAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("xlsx-bytes"))
})

describe("GET /api/admin/bookkeeping/reports/accountant-pack", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
  })
  it("400 on a bad window", async () => {
    expect((await GET(req("from=2026-12-31&to=2026-01-01"))).status).toBe(400)
  })
  it("streams the xlsx with attachment headers and audits the export", async () => {
    const res = await GET(req("from=2026-01-01&to=2026-12-31"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="djp-accountant-pack-2026-01-01-2026-12-31.xlsx"')
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(buildAccountantPack).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-01-01", to: "2026-12-31" }))
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.report_exported",
      metadata: expect.objectContaining({ format: "accountant_pack_xlsx" }),
    }))
  })
})

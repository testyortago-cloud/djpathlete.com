import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listAssets: vi.fn(),
  getAsset: vi.fn(),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
  getBook: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { GET, POST } from "@/app/api/admin/bookkeeping/assets/route"
import { PATCH, DELETE } from "@/app/api/admin/bookkeeping/assets/[id]/route"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { listAssets, getAsset, createAsset, updateAsset, deleteAsset, getBook } from "@/lib/db/bookkeeping"

const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const BOOK = "b0000000-0000-4000-8000-000000000001"
const ASSET = "ad000000-0000-4000-8000-000000000001"

const assetRow = {
  id: ASSET, book_id: BOOK, name: "Squat Rack",
  basis_cents: 10000, salvage_cents: 0, in_service_on: "2024-01-15",
  method: "straight_line", convention: "full_month", recovery_years: 3,
  accountant_note: null, created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z",
}
const createBody = {
  book_id: BOOK, name: "Squat Rack", basis_cents: 10000, in_service_on: "2024-01-15",
  method: "straight_line", convention: "full_month", recovery_years: 3,
}

const getReq = (qs: string) => new Request(`http://x/api/admin/bookkeeping/assets?${qs}`)
const body = (b: unknown) => ({ json: async () => b }) as never
const params = { params: Promise.resolve({ id: ASSET }) }

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(listAssets as ReturnType<typeof vi.fn>).mockResolvedValue([assetRow])
  ;(getAsset as ReturnType<typeof vi.fn>).mockResolvedValue(assetRow)
  ;(createAsset as ReturnType<typeof vi.fn>).mockResolvedValue(assetRow)
  ;(updateAsset as ReturnType<typeof vi.fn>).mockResolvedValue(assetRow)
  ;(deleteAsset as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BOOK, name: "Darren — DJP Athlete" })
})

describe("GET /api/admin/bookkeeping/assets", () => {
  it("403 when not admin; DAL untouched", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET(getReq(`book_id=${BOOK}`))).status).toBe(403)
    expect(listAssets).not.toHaveBeenCalled()
  })
  it("400 without book_id", async () => {
    expect((await GET(getReq(""))).status).toBe(400)
  })
  it("200 with the book's assets", async () => {
    const res = await GET(getReq(`book_id=${BOOK}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ assets: [assetRow] })
    expect(listAssets).toHaveBeenCalledWith(BOOK)
  })
})

describe("POST /api/admin/bookkeeping/assets", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(body(createBody))).status).toBe(403)
    expect(createAsset).not.toHaveBeenCalled()
  })
  it("400 on invalid input (salvage > basis caught by the schema refine)", async () => {
    expect((await POST(body({ ...createBody, salvage_cents: 99999 }))).status).toBe(400)
    expect(createAsset).not.toHaveBeenCalled()
  })
  it("404 when the book does not exist — createAsset never runs", async () => {
    ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(body(createBody))).status).toBe(404)
    expect(createAsset).not.toHaveBeenCalled()
  })
  it("201 + bookkeeping.asset_created audit", async () => {
    const res = await POST(body(createBody))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ asset: assetRow })
    expect(createAsset).toHaveBeenCalledWith(
      expect.objectContaining({ book_id: BOOK, salvage_cents: 0, accountant_note: null }),
    )
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.asset_created", category: "commerce" }),
    )
  })
})

describe("PATCH /api/admin/bookkeeping/assets/[id]", () => {
  it("403 when not admin; DAL untouched", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await PATCH(body({ name: "x" }), params)).status).toBe(403)
    expect(getAsset).not.toHaveBeenCalled()
    expect(updateAsset).not.toHaveBeenCalled()
  })
  it("404 when the asset does not exist", async () => {
    ;(getAsset as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await PATCH(body({ name: "x" }), params)).status).toBe(404)
    expect(updateAsset).not.toHaveBeenCalled()
  })
  it("400 on an empty update body", async () => {
    expect((await PATCH(body({}), params)).status).toBe(400)
    expect(updateAsset).not.toHaveBeenCalled()
  })
  it("400 when the MERGED row breaks salvage <= basis (raising salvage past the stored basis)", async () => {
    // Schema alone passes { salvage_cents: 20000 } — only the merged guard can reject it.
    expect((await PATCH(body({ salvage_cents: 20000 }), params)).status).toBe(400)
    expect(updateAsset).not.toHaveBeenCalled()
  })
  it("400 when lowering basis under the stored salvage", async () => {
    ;(getAsset as ReturnType<typeof vi.fn>).mockResolvedValue({ ...assetRow, salvage_cents: 800 })
    expect((await PATCH(body({ basis_cents: 500 }), params)).status).toBe(400)
  })
  it("200 + bookkeeping.asset_updated audit on a legal update", async () => {
    const res = await PATCH(body({ recovery_years: 5 }), params)
    expect(res.status).toBe(200)
    expect(updateAsset).toHaveBeenCalledWith(ASSET, { recovery_years: 5 })
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.asset_updated", category: "commerce" }),
    )
  })
})

describe("DELETE /api/admin/bookkeeping/assets/[id]", () => {
  it("403 when not admin; DAL untouched", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await DELETE({} as never, params)).status).toBe(403)
    expect(getAsset).not.toHaveBeenCalled()
    expect(deleteAsset).not.toHaveBeenCalled()
  })
  it("404 when the asset does not exist", async () => {
    ;(getAsset as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await DELETE({} as never, params)).status).toBe(404)
    expect(deleteAsset).not.toHaveBeenCalled()
  })
  it("200 + bookkeeping.asset_deleted audit carrying a full snapshot (hard delete)", async () => {
    const res = await DELETE({} as never, params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(deleteAsset).toHaveBeenCalledWith(ASSET)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.asset_deleted",
        category: "commerce",
        metadata: expect.objectContaining({ basis_cents: 10000, in_service_on: "2024-01-15", recovery_years: 3 }),
      }),
    )
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const loadInsightsBundleMock = vi.fn()
const getSettingMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/bookkeeping/insight-data", () => ({ loadInsightsBundle: (...a: unknown[]) => loadInsightsBundleMock(...a) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))

import { GET } from "@/app/api/admin/bookkeeping/tax-forecast/route"

const BIZ = "b0000000-0000-4000-8000-000000000001"
const HOUSE = "b0000000-0000-4000-8000-000000000002"

function req(bookId: string) {
  return new Request(`http://test/api/admin/bookkeeping/tax-forecast?book_id=${bookId}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  loadInsightsBundleMock.mockResolvedValue({
    books: [
      { id: BIZ, book_kind: "business", name: "DJP" },
      { id: HOUSE, book_kind: "household", name: "Home" },
    ],
    accounts: [],
    // 12.345 discriminator: income 100000 - expense 40000 = 60000 net.
    entries: [
      { book_id: BIZ, direction: "income", amount_cents: 100_000 },
      { book_id: BIZ, direction: "expense", amount_cents: 40_000 },
      { book_id: HOUSE, direction: "expense", amount_cents: 999_999 },
    ],
  })
  // getSetting(key, fallback): rate 20%, no home-office percent.
  getSettingMock.mockImplementation(async (key: string, fallback: unknown) =>
    key === "bookkeeping_tax_rate_percent" ? 20 : fallback)
})

describe("GET /api/admin/bookkeeping/tax-forecast", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET(req(BIZ))).status).toBe(403)
  })

  it("400s a non-uuid book_id", async () => {
    expect((await GET(req("nope"))).status).toBe(400)
  })

  it("business book → YTD net × rate (60000 × 20% = 12000), with the next safe-harbor date", async () => {
    const body = await (await GET(req(BIZ))).json()
    expect(body.business).toBe(true)
    expect(body.forecast.estimated_tax_cents).toBe(12_000)
    expect(body.forecast.rate_percent).toBe(20)
    expect(body.forecast.next_safe_harbor.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("household book → business:false, no forecast", async () => {
    const body = await (await GET(req(HOUSE))).json()
    expect(body).toEqual({ business: false })
  })

  it("unknown (but valid-uuid) book → business:false", async () => {
    const body = await (await GET(req("b0000000-0000-4000-8000-000000000099"))).json()
    expect(body).toEqual({ business: false })
  })

  it("no rate set → forecast present with estimated_tax_cents null (never a guess)", async () => {
    getSettingMock.mockImplementation(async (_k: string, fallback: unknown) => fallback)
    const body = await (await GET(req(BIZ))).json()
    expect(body.business).toBe(true)
    expect(body.forecast.rate_percent).toBeNull()
    expect(body.forecast.estimated_tax_cents).toBeNull()
  })
})

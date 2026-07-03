import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSettingMock = vi.fn()
const setSettingMock = vi.fn()
const listChargesMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/system-settings", () => ({
  getSetting: (...a: unknown[]) => getSettingMock(...a),
  setSetting: (...a: unknown[]) => setSettingMock(...a),
}))
vi.mock("@/lib/db/session-fee-charges", () => ({ listFeeCharges: (...a: unknown[]) => listChargesMock(...a) }))

import { GET, POST } from "@/app/api/admin/sessions/fees/route"

const req = (b: Record<string, unknown>) =>
  new Request("http://x/api/admin/sessions/fees", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  getSettingMock.mockImplementation(async (_k: string, fallback: number) => fallback)
  listChargesMock.mockResolvedValue([])
  setSettingMock.mockResolvedValue({})
})

describe("GET /api/admin/sessions/fees", () => {
  it("403 for non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET()).status).toBe(403)
  })

  it("returns config + charges", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.config).toMatchObject({ noShowFeeCents: 0, cancelWindowHours: 12 })
    expect(json.charges).toEqual([])
  })
})

describe("POST /api/admin/sessions/fees", () => {
  it("persists the three settings", async () => {
    const res = await POST(req({ noShowFeeCents: 2000, lateCancelFeeCents: 1500, cancelWindowHours: 24 }))
    expect(res.status).toBe(200)
    expect(setSettingMock).toHaveBeenCalledWith("no_show_fee_cents", 2000, "coach-1")
    expect(setSettingMock).toHaveBeenCalledWith("cancel_window_hours", 24, "coach-1")
  })

  it("400 on invalid config", async () => {
    expect((await POST(req({ noShowFeeCents: -5, lateCancelFeeCents: 0, cancelWindowHours: 12 }))).status).toBe(400)
  })
})

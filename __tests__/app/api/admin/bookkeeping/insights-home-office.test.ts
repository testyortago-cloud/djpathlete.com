import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { PATCH } from "@/app/api/admin/bookkeeping/insights/home-office/route"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { getSetting, setSetting } from "@/lib/db/system-settings"

const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const body = (b: unknown) => ({ json: async () => b }) as never

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(setSetting as ReturnType<typeof vi.fn>).mockResolvedValue({})
})

describe("PATCH /api/admin/bookkeeping/insights/home-office", () => {
  it("403 when not admin; setSetting never called", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await PATCH(body({ percent: 25 }))).status).toBe(403)
    expect(setSetting).not.toHaveBeenCalled()
  })
  it("400 on invalid bodies; setSetting never called", async () => {
    for (const b of [{ percent: 0 }, { percent: 101 }, { percent: "25" }, {}, null]) {
      expect((await PATCH(body(b))).status).toBe(400)
    }
    expect(setSetting).not.toHaveBeenCalled()
  })
  it("rounds to 2 decimals, stores under the exact key with the admin id, audits with previous/new", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(10)
    const res = await PATCH(body({ percent: 33.333 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ percent: 33.33 })
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_home_office_percent", 33.33, ADMIN.user.id)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.home_office_percent_set",
        category: "commerce",
        metadata: expect.objectContaining({ previous_value: 10, new_value: 33.33 }),
      }),
    )
  })
  it("uses Math.round (not trunc) to round halves up: 12.555 -> 12.56", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await PATCH(body({ percent: 12.555 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ percent: 12.56 })
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_home_office_percent", 12.56, ADMIN.user.id)
  })
  it("null clears the setting", async () => {
    const res = await PATCH(body({ percent: null }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ percent: null })
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_home_office_percent", null, ADMIN.user.id)
  })
  it("500 when the write fails", async () => {
    ;(setSetting as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"))
    expect((await PATCH(body({ percent: 25 }))).status).toBe(500)
  })
})

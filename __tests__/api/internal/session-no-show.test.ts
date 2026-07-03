import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const isCronSkippedMock = vi.fn()
const listPendingMock = vi.fn()
const markNoShowMock = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: (...a: unknown[]) => isCronSkippedMock(...a) }))
vi.mock("@/lib/db/scheduled-sessions", () => ({ listScheduledPending: (...a: unknown[]) => listPendingMock(...a) }))
vi.mock("@/lib/services/session-schedule", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/session-schedule")>("@/lib/services/session-schedule")
  return { scanNoShows: actual.scanNoShows, markNoShow: (...a: unknown[]) => markNoShowMock(...a) }
})

import { POST } from "@/app/api/admin/internal/session-no-show/route"

const OLD_ENV = process.env.INTERNAL_CRON_TOKEN
beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = "secret"
  isCronSkippedMock.mockResolvedValue({ skipped: false })
})
afterEach(() => {
  process.env.INTERNAL_CRON_TOKEN = OLD_ENV
})

function req(token?: string) {
  return new Request("http://x/api/admin/internal/session-no-show", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }) as never
}

describe("POST /api/admin/internal/session-no-show", () => {
  it("401 without the cron token", async () => {
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req("wrong"))).status).toBe(401)
  })

  it("marks past scheduled sessions no_show", async () => {
    // One long-past scheduled session + one attended (ignored).
    listPendingMock.mockResolvedValue([
      { id: "past", session_date: "2000-01-01", start_time: "05:00:00", duration_minutes: 60, status: "scheduled" },
      { id: "done", session_date: "2000-01-01", start_time: "05:00:00", duration_minutes: 60, status: "attended" },
    ])
    const res = await POST(req("secret"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ marked: 1 })
    expect(markNoShowMock).toHaveBeenCalledWith("past", null)
    expect(markNoShowMock).toHaveBeenCalledTimes(1)
  })

  it("skips when the cron gate is off", async () => {
    isCronSkippedMock.mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(req("secret"))
    expect(await res.json()).toMatchObject({ skipped: "disabled" })
    expect(listPendingMock).not.toHaveBeenCalled()
  })
})

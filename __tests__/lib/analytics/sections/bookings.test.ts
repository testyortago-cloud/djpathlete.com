import { describe, it, expect, vi, beforeEach } from "vitest"

const getBookingsInRangeMock = vi.fn()
const listSignupsCreatedSinceMock = vi.fn()

vi.mock("@/lib/db/bookings", () => ({
  getBookingsInRange: (...args: unknown[]) => getBookingsInRangeMock(...args),
}))
vi.mock("@/lib/db/event-signups", () => ({
  listSignupsCreatedSince: (...args: unknown[]) => listSignupsCreatedSinceMock(...args),
}))

import { buildDailyBookings } from "@/lib/analytics/sections/bookings"

const referenceDate = new Date("2026-05-07T07:00:00-05:00")

describe("buildDailyBookings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBookingsInRangeMock.mockResolvedValue([])
    listSignupsCreatedSinceMock.mockResolvedValue([])
  })

  it("returns null when no calls today and no overnight signups", async () => {
    const result = await buildDailyBookings({ referenceDate })
    expect(result).toBeNull()
  })

  it("returns calls today sorted by time, with overnight signup count", async () => {
    getBookingsInRangeMock.mockResolvedValue([
      {
        booking_date: "2026-05-07T15:00:00Z",
        client_name: "Sarah K.",
        booking_type: "Strategy call",
      },
      {
        booking_date: "2026-05-07T14:00:00Z",
        client_name: "Jordan M.",
        booking_type: "Form review",
      },
    ])
    listSignupsCreatedSinceMock.mockResolvedValue([{ id: "s1" }, { id: "s2" }])

    const result = await buildDailyBookings({ referenceDate })

    expect(result).not.toBeNull()
    expect(result!.callsToday).toHaveLength(2)
    expect(result!.callsToday[0].clientName).toBe("Jordan M.") // 14:00 first
    expect(result!.callsToday[1].clientName).toBe("Sarah K.")
    expect(result!.newSignupsOvernight).toBe(2)
  })

  it("handles only overnight signups (no calls today)", async () => {
    listSignupsCreatedSinceMock.mockResolvedValue([{ id: "s1" }])
    const result = await buildDailyBookings({ referenceDate })
    expect(result).toEqual({ callsToday: [], newSignupsOvernight: 1 })
  })
})

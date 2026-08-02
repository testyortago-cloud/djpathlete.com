import { describe, it, expect } from "vitest"
import { buildMonthlyTraining } from "@/lib/profile-share/monthly"

const NOW = new Date("2026-08-02T12:00:00Z")

describe("buildMonthlyTraining", () => {
  it("sums volume and counts sessions per calendar month", () => {
    const out = buildMonthlyTraining(
      [
        { session_date: "2026-07-01", volume_load_kg: 3000 },
        { session_date: "2026-07-15", volume_load_kg: 4200 },
        { session_date: "2026-08-01", volume_load_kg: 3900 },
      ],
      { monthsBack: 3, now: NOW },
    )
    expect(out.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"])
    const july = out[1]
    expect(july.sessions).toBe(2)
    expect(july.volumeKg).toBe(7200) // 3000 + 4200, not last-write-wins
  })

  it("zero-fills quiet months instead of dropping them", () => {
    const out = buildMonthlyTraining([{ session_date: "2026-08-01", volume_load_kg: 1000 }], {
      monthsBack: 4,
      now: NOW,
    })
    expect(out).toHaveLength(4)
    expect(out[0]).toMatchObject({ month: "2026-05", sessions: 0, volumeKg: 0 })
  })

  it("ignores sessions outside the window and treats null volume as 0 while still counting the session", () => {
    const out = buildMonthlyTraining(
      [
        { session_date: "2025-01-10", volume_load_kg: 99999 }, // out of window
        { session_date: "2026-08-01", volume_load_kg: null },
      ],
      { monthsBack: 2, now: NOW },
    )
    expect(out.map((m) => m.month)).toEqual(["2026-07", "2026-08"])
    expect(out[1].sessions).toBe(1)
    expect(out[1].volumeKg).toBe(0)
  })

  it("returns [] when every month in the window is empty (chart self-hides)", () => {
    expect(buildMonthlyTraining([], { monthsBack: 6, now: NOW })).toEqual([])
  })

  it("labels January with the year so year boundaries read", () => {
    const out = buildMonthlyTraining([{ session_date: "2026-01-05", volume_load_kg: 100 }], {
      monthsBack: 3,
      now: new Date("2026-02-15T00:00:00Z"),
    })
    expect(out.map((m) => m.label)).toEqual(["Dec", "Jan '26", "Feb"])
  })
})

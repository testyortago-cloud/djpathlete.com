import { describe, it, expect } from "vitest"
import { dailyLoads, rollingAverage, acuteLoad, chronicLoad, acwr } from "@/lib/coach-intel/load"

const sessions = [
  { date: "2026-05-10", session_load: 200 },
  { date: "2026-05-10", session_load: 100 },
  { date: "2026-05-12", session_load: 300 },
]

describe("dailyLoads", () => {
  it("sums multiple sessions per day", () => {
    const r = dailyLoads(sessions, "2026-05-10", "2026-05-12")
    expect(r.find((d) => d.date === "2026-05-10")?.load).toBe(300)
  })

  it("fills missing dates with 0", () => {
    const r = dailyLoads(sessions, "2026-05-10", "2026-05-12")
    expect(r).toHaveLength(3)
    expect(r.find((d) => d.date === "2026-05-11")?.load).toBe(0)
  })
})

describe("rollingAverage", () => {
  it("returns simple unweighted means of N-day windows ending each day", () => {
    const dl = [
      { date: "2026-05-10", load: 100 },
      { date: "2026-05-11", load: 200 },
      { date: "2026-05-12", load: 300 },
    ]
    const r = rollingAverage(dl, 2)
    expect(r.find((d) => d.date === "2026-05-12")?.value).toBe(250)
    expect(r.find((d) => d.date === "2026-05-11")?.value).toBe(150)
  })

  it("uses available days when window exceeds data length", () => {
    const dl = [{ date: "2026-05-10", load: 100 }]
    const r = rollingAverage(dl, 7)
    expect(r[0].value).toBe(100)
  })
})

describe("acuteLoad / chronicLoad", () => {
  it("acuteLoad is 7-day mean ending on asOf", () => {
    const dl = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-05-${String(10 + i).padStart(2, "0")}`,
      load: 100,
    }))
    expect(acuteLoad(dl, "2026-05-19")).toBe(100)
  })

  it("chronicLoad is 28-day mean ending on asOf", () => {
    const dl = Array.from({ length: 28 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, "0")}`,
      load: 200,
    }))
    expect(chronicLoad(dl, "2026-04-28")).toBe(200)
  })
})

describe("acwr", () => {
  it("returns acute/chronic when chronic > 0", () => {
    const dl = Array.from({ length: 28 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      load: i < 21 ? 100 : 200,
    }))
    const r = acwr(dl, "2026-05-28")!
    expect(r).toBeGreaterThan(1.0)
  })

  it("returns null when chronic is 0 (no history at all)", () => {
    const dl: { date: string; load: number }[] = []
    expect(acwr(dl, "2026-05-28")).toBeNull()
  })
})

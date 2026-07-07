import { describe, it, expect } from "vitest"
import {
  campHasDailyTimes,
  formatEventDuration,
  formatEventTime,
  formatEventWhen,
} from "@/lib/events/format"
import type { Event } from "@/types/database"

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: "evt-1",
    type: "camp",
    slug: "summer-camp",
    title: "Summer Camp",
    summary: "",
    description: "",
    focus_areas: [],
    audience: [],
    start_date: "2026-07-13T00:00:00.000Z",
    end_date: "2026-07-17T00:00:00.000Z",
    session_schedule: null,
    location_name: "L",
    location_address: null,
    location_map_url: null,
    age_min: null,
    age_max: null,
    capacity: 10,
    signup_count: 0,
    price_cents: null,
    stripe_product_id: null,
    stripe_price_id: null,
    status: "published",
    hero_image_url: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Event
}

describe("formatEventTime", () => {
  it("formats stored wall-clock UTC times", () => {
    expect(formatEventTime("2026-07-13T09:00:00.000Z")).toBe("9:00 AM")
    expect(formatEventTime("2026-07-13T16:30:00.000Z")).toBe("4:30 PM")
  })
})

describe("campHasDailyTimes", () => {
  it("is false for legacy midnight-only camps", () => {
    expect(campHasDailyTimes(makeEvent({}))).toBe(false)
  })

  it("is true when a daily window is encoded in the time-of-day", () => {
    expect(
      campHasDailyTimes(
        makeEvent({
          start_date: "2026-07-13T09:00:00.000Z",
          end_date: "2026-07-17T11:00:00.000Z",
        }),
      ),
    ).toBe(true)
  })

  it("is always false for clinics", () => {
    expect(
      campHasDailyTimes(
        makeEvent({ type: "clinic", start_date: "2026-07-13T09:00:00.000Z" }),
      ),
    ).toBe(false)
  })
})

describe("formatEventWhen", () => {
  it("clinic: date with start – end times", () => {
    const clinic = makeEvent({
      type: "clinic",
      start_date: "2026-05-15T15:00:00.000Z",
      end_date: "2026-05-15T17:00:00.000Z",
    })
    expect(formatEventWhen(clinic)).toContain("May 15, 2026")
    expect(formatEventWhen(clinic)).toContain("3:00 PM – 5:00 PM")
  })

  it("legacy camp without daily times: date range only", () => {
    expect(formatEventWhen(makeEvent({}))).toBe("Jul 13 – Jul 17, 2026")
  })

  it("camp with daily times: date range plus daily window", () => {
    const camp = makeEvent({
      start_date: "2026-07-13T09:00:00.000Z",
      end_date: "2026-07-17T11:00:00.000Z",
    })
    expect(formatEventWhen(camp)).toBe("Jul 13 – Jul 17, 2026 · 9:00 AM – 11:00 AM daily")
  })

  it("single-day camp with times: one date, no 'daily'", () => {
    const camp = makeEvent({
      start_date: "2026-07-13T09:00:00.000Z",
      end_date: "2026-07-13T11:00:00.000Z",
    })
    const label = formatEventWhen(camp)
    expect(label).toContain("Jul 13, 2026")
    expect(label).toContain("9:00 AM – 11:00 AM")
    expect(label).not.toContain("daily")
  })

  it("long style spells the month out", () => {
    const camp = makeEvent({
      start_date: "2026-07-13T09:00:00.000Z",
      end_date: "2026-07-17T11:00:00.000Z",
    })
    expect(formatEventWhen(camp, "long")).toBe("July 13 – July 17, 2026 · 9:00 AM – 11:00 AM daily")
  })

  it("cross-year camp range includes both years", () => {
    const camp = makeEvent({
      start_date: "2026-12-30T00:00:00.000Z",
      end_date: "2027-01-02T00:00:00.000Z",
    })
    expect(formatEventWhen(camp)).toBe("Dec 30, 2026 – Jan 2, 2027")
  })
})

describe("formatEventDuration", () => {
  it("camp day count is inclusive of first and last day", () => {
    expect(formatEventDuration(makeEvent({}))).toBe("5-day camp")
  })

  it("daily session times do not skew the day count", () => {
    const camp = makeEvent({
      start_date: "2026-07-13T09:00:00.000Z",
      end_date: "2026-07-17T11:00:00.000Z",
    })
    expect(formatEventDuration(camp)).toBe("5-day camp")
  })

  it("clinic stays a 2-hour clinic", () => {
    expect(formatEventDuration(makeEvent({ type: "clinic" }))).toBe("2-hour clinic")
  })
})

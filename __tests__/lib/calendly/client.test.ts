// @vitest-environment node
//
// lib/calendly/client.ts against RECORDED fixtures, never the live API. The
// property under test is the one the spec spells out: an empty collection is
// `[]` ("nothing free"), and every way of failing to READ is a thrown
// `CalendlyUnavailable` — never `[]`, because the two answers lead the
// assistant to say different things to a visitor.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

import { AVAILABILITY_WINDOW_DAYS, CalendlyUnavailable, listAvailableTimes } from "@/lib/calendly/client"

const FIXTURE = JSON.parse(readFileSync("__tests__/fixtures/calendly/available-times.json", "utf8"))

const ARGS = {
  eventTypeUri: "https://api.calendly.com/event_types/EVENTTYPE000001",
  from: new Date("2026-09-07T12:00:00Z"),
  to: new Date("2026-09-14T12:00:00Z"),
  apiToken: "test-token",
}

function fetchReturning(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }) {
  const impl: typeof fetch = async (input, init) => {
    if (capture) {
      capture.url = String(input)
      capture.init = init
    }
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  }
  return impl
}

describe("listAvailableTimes", () => {
  it("returns only the available slots, soonest first, with each slot's own booking URL", async () => {
    const slots = await listAvailableTimes({ ...ARGS, fetchImpl: fetchReturning(200, FIXTURE) })
    expect(slots.map((s) => s.startAt)).toEqual([
      "2026-09-08T13:00:00.000000Z",
      "2026-09-08T14:00:00.000000Z",
      "2026-09-09T22:30:00.000000Z",
    ])
    expect(slots[0].schedulingUrl).toBe(
      "https://calendly.com/acme-performance/consultation/2026-09-08T13:00:00Z?month=2026-09&date=2026-09-08",
    )
    expect(slots.every((s) => s.inviteesRemaining === 1)).toBe(true)
  })

  it("sends the bearer token and the three query parameters Calendly requires", async () => {
    const capture: { url?: string; init?: RequestInit } = {}
    await listAvailableTimes({ ...ARGS, fetchImpl: fetchReturning(200, FIXTURE, capture) })
    const url = new URL(capture.url!)
    expect(url.origin).toBe("https://api.calendly.com")
    expect(url.pathname).toBe("/event_type_available_times")
    expect(url.searchParams.get("event_type")).toBe(ARGS.eventTypeUri)
    expect(url.searchParams.get("start_time")).toBe("2026-09-07T12:00:00.000Z")
    expect(url.searchParams.get("end_time")).toBe("2026-09-14T12:00:00.000Z")
    expect((capture.init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token")
  })

  it("clamps the window to seven days after `from`, whatever `to` asks for", async () => {
    const capture: { url?: string } = {}
    await listAvailableTimes({
      ...ARGS,
      to: new Date("2026-10-30T00:00:00Z"),
      fetchImpl: fetchReturning(200, FIXTURE, capture),
    })
    const end = new Date(new URL(capture.url!).searchParams.get("end_time")!)
    expect((end.getTime() - ARGS.from.getTime()) / 86_400_000).toBe(AVAILABILITY_WINDOW_DAYS)
  })

  it("honours a different API base (the acceptance script's fixture server)", async () => {
    const capture: { url?: string } = {}
    await listAvailableTimes({ ...ARGS, apiBase: "http://127.0.0.1:4545", fetchImpl: fetchReturning(200, FIXTURE, capture) })
    expect(capture.url!.startsWith("http://127.0.0.1:4545/event_type_available_times?")).toBe(true)
  })

  it("answers an empty collection with [] — nothing free is a real answer", async () => {
    const slots = await listAvailableTimes({ ...ARGS, fetchImpl: fetchReturning(200, { collection: [] }) })
    expect(slots).toEqual([])
  })

  it("throws CalendlyUnavailable(http) on a 401, never []", async () => {
    await expect(
      listAvailableTimes({ ...ARGS, fetchImpl: fetchReturning(401, { title: "Unauthenticated" }) }),
    ).rejects.toMatchObject({ name: "CalendlyUnavailable", reason: "http", status: 401 })
  })

  it("throws CalendlyUnavailable(http) on a 500", async () => {
    await expect(listAvailableTimes({ ...ARGS, fetchImpl: fetchReturning(500, "boom") })).rejects.toMatchObject({
      reason: "http",
      status: 500,
    })
  })

  it("throws CalendlyUnavailable(network) when fetch itself fails", async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError("fetch failed")
    }
    await expect(listAvailableTimes({ ...ARGS, fetchImpl: failing })).rejects.toBeInstanceOf(CalendlyUnavailable)
    await expect(listAvailableTimes({ ...ARGS, fetchImpl: failing })).rejects.toMatchObject({ reason: "network" })
  })

  it("throws CalendlyUnavailable(shape) when the body is not the documented shape", async () => {
    await expect(
      listAvailableTimes({ ...ARGS, fetchImpl: fetchReturning(200, { slots: [{ when: "later" }] }) }),
    ).rejects.toMatchObject({ reason: "shape" })
  })

  it("throws CalendlyUnavailable(shape) when the body is not JSON at all", async () => {
    await expect(listAvailableTimes({ ...ARGS, fetchImpl: fetchReturning(200, "<html>maintenance</html>") })).rejects.toMatchObject({
      reason: "shape",
    })
  })

  it("tolerates extra fields Calendly may add later", async () => {
    const body = {
      collection: [{ ...FIXTURE.collection[0], brand_new_field: true }],
      pagination: { next_page: null },
    }
    const slots = await listAvailableTimes({ ...ARGS, fetchImpl: fetchReturning(200, body) })
    expect(slots).toHaveLength(1)
  })
})

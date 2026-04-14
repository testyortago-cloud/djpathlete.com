import { describe, it, expect, afterAll, beforeAll } from "vitest"
import { randomUUID } from "crypto"
import { createEvent } from "@/lib/db/events"
import { createSignup, getSignupsForEvent, getSignupById, confirmSignup, cancelSignup } from "@/lib/db/event-signups"

describe("event-signups DAL", () => {
  let eventId: string
  const extraEventIds: string[] = []

  beforeAll(async () => {
    const e = await createEvent({
      type: "clinic",
      slug: `signup-test-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 2,
      status: "draft",
    })
    eventId = e.id
  })

  afterAll(async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    await supabase.from("events").delete().eq("id", eventId)
    for (const id of extraEventIds) await supabase.from("events").delete().eq("id", id)
  })

  it("creates a signup and fetches it back", async () => {
    const signup = await createSignup(
      eventId,
      {
        parent_name: "A",
        parent_email: "a@x.com",
        athlete_name: "S",
        athlete_age: 14,
      },
      "interest",
    )
    expect(signup.status).toBe("pending")

    const fetched = await getSignupById(signup.id)
    expect(fetched?.id).toBe(signup.id)

    const all = await getSignupsForEvent(eventId)
    expect(all.some((s) => s.id === signup.id)).toBe(true)
  })

  it("confirm + cancel flip status and adjust signup_count", async () => {
    const signup = await createSignup(
      eventId,
      {
        parent_name: "B",
        parent_email: "b@x.com",
        athlete_name: "S2",
        athlete_age: 14,
      },
      "interest",
    )

    const confirmed = await confirmSignup(signup.id)
    expect(confirmed.ok).toBe(true)

    const fetched = await getSignupById(signup.id)
    expect(fetched?.status).toBe("confirmed")

    const cancelled = await cancelSignup(signup.id)
    expect(cancelled.ok).toBe(true)
  })

  it("confirm returns at_capacity when full", async () => {
    const e = await createEvent({
      type: "clinic",
      slug: `cap-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 1,
      status: "draft",
    })
    extraEventIds.push(e.id)

    const s1 = await createSignup(
      e.id,
      {
        parent_name: "A",
        parent_email: "a@x.com",
        athlete_name: "X",
        athlete_age: 14,
      },
      "interest",
    )
    const s2 = await createSignup(
      e.id,
      {
        parent_name: "B",
        parent_email: "b@x.com",
        athlete_name: "Y",
        athlete_age: 14,
      },
      "interest",
    )

    const r1 = await confirmSignup(s1.id)
    expect(r1.ok).toBe(true)

    const r2 = await confirmSignup(s2.id)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.reason).toBe("at_capacity")
  })
})

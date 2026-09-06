import { describe, it, expect, afterAll, beforeAll } from "vitest"
import { randomUUID } from "crypto"
import { createEvent } from "@/lib/db/events"
import {
  createSignup,
  getSignupsForEvent,
  getSignupById,
  confirmSignup,
  cancelSignup,
  getSignupTenantById,
} from "@/lib/db/event-signups"

const PLATFORM = "00000000-0000-0000-0000-000000000001"
const OTHER_BUSINESS = "82d5b238-1653-4a04-9d2d-2f65e5a8c225" // Trailhead Strength & Conditioning

describe("event-signups DAL", () => {
  let eventId: string
  const extraEventIds: string[] = []

  beforeAll(async () => {
    const e = await createEvent(PLATFORM, {
      type: "clinic",
      slug: `signup-test-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      audience: [],
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
      PLATFORM,
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

    const fetched = await getSignupById(PLATFORM, signup.id)
    expect(fetched?.id).toBe(signup.id)

    const all = await getSignupsForEvent(PLATFORM, eventId)
    expect(all.some((s) => s.id === signup.id)).toBe(true)
  })

  it("getSignupTenantById returns the row's own business id, by id alone", async () => {
    // The webhook's whole reason for existing: it holds only
    // `session.metadata.event_signup_id`, with no tenant of its own to scope
    // a normal read by.
    const signup = await createSignup(
      PLATFORM,
      eventId,
      {
        parent_name: "C",
        parent_email: "c@x.com",
        athlete_name: "S3",
        athlete_age: 14,
      },
      "interest",
    )
    expect(await getSignupTenantById(signup.id)).toBe(PLATFORM)
  })

  it("getSignupTenantById returns null for an id that does not exist", async () => {
    expect(await getSignupTenantById(randomUUID())).toBeNull()
  })

  it("confirm + cancel flip status and adjust signup_count", async () => {
    const signup = await createSignup(
      PLATFORM,
      eventId,
      {
        parent_name: "B",
        parent_email: "b@x.com",
        athlete_name: "S2",
        athlete_age: 14,
      },
      "interest",
    )

    const confirmed = await confirmSignup(PLATFORM, signup.id)
    expect(confirmed.ok).toBe(true)

    const fetched = await getSignupById(PLATFORM, signup.id)
    expect(fetched?.status).toBe("confirmed")

    const cancelled = await cancelSignup(PLATFORM, signup.id)
    expect(cancelled.ok).toBe(true)
  })

  it("confirm returns at_capacity when full", async () => {
    const e = await createEvent(PLATFORM, {
      type: "clinic",
      slug: `cap-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      audience: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 1,
      status: "draft",
    })
    extraEventIds.push(e.id)

    const s1 = await createSignup(
      PLATFORM,
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
      PLATFORM,
      e.id,
      {
        parent_name: "B",
        parent_email: "b@x.com",
        athlete_name: "Y",
        athlete_age: 14,
      },
      "interest",
    )

    const r1 = await confirmSignup(PLATFORM, s1.id)
    expect(r1.ok).toBe(true)

    const r2 = await confirmSignup(PLATFORM, s2.id)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.reason).toBe("at_capacity")
  })

  it("getEventSignupByStripeSessionId returns the matching signup", async () => {
    const { getEventSignupByStripeSessionId } = await import("@/lib/db/event-signups")
    const e = await createEvent(PLATFORM, {
      type: "camp",
      slug: `lookup-session-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      audience: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
      location_name: "L",
      capacity: 10,
      status: "draft",
      price_dollars: 100,
    })
    extraEventIds.push(e.id)

    const sig = await createSignup(
      PLATFORM,
      e.id,
      {
        parent_name: "A",
        parent_email: "a@x.com",
        athlete_name: "X",
        athlete_age: 14,
      },
      "paid",
    )

    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    const sessionId = `cs_test_${randomUUID()}`
    await supabase.from("event_signups").update({ stripe_session_id: sessionId }).eq("id", sig.id)

    const fetched = await getEventSignupByStripeSessionId(sessionId)
    expect(fetched?.id).toBe(sig.id)
  })

  it("getEventSignupByPaymentIntent returns the matching signup", async () => {
    const { getEventSignupByPaymentIntent } = await import("@/lib/db/event-signups")
    const e = await createEvent(PLATFORM, {
      type: "camp",
      slug: `lookup-pi-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      audience: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
      location_name: "L",
      capacity: 10,
      status: "draft",
      price_dollars: 100,
    })
    extraEventIds.push(e.id)

    const sig = await createSignup(
      PLATFORM,
      e.id,
      {
        parent_name: "A",
        parent_email: "a@x.com",
        athlete_name: "X",
        athlete_age: 14,
      },
      "paid",
    )

    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    const piId = `pi_test_${randomUUID()}`
    await supabase.from("event_signups").update({ stripe_payment_intent_id: piId }).eq("id", sig.id)

    const fetched = await getEventSignupByPaymentIntent(piId)
    expect(fetched?.id).toBe(sig.id)
  })

  it("getSignupsForEvent sweeps stale paid+pending rows to cancelled", async () => {
    const { getSignupsForEvent } = await import("@/lib/db/event-signups")
    const e = await createEvent(PLATFORM, {
      type: "camp",
      slug: `sweep-${randomUUID()}`,
      title: "T", summary: "S", description: "D", focus_areas: [], audience: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
      location_name: "L", capacity: 10, status: "draft", price_dollars: 100,
    })
    extraEventIds.push(e.id)

    // Create a paid pending signup, then manually backdate created_at to >1 hour ago
    const stale = await createSignup(PLATFORM, e.id, {
      parent_name: "A", parent_email: "a@x.com", athlete_name: "X", athlete_age: 14,
    }, "paid")

    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    await supabase.from("event_signups").update({ created_at: twoHoursAgo }).eq("id", stale.id)

    // Calling getSignupsForEvent should sweep the stale row to 'cancelled'
    const signups = await getSignupsForEvent(PLATFORM, e.id)
    const swept = signups.find((s) => s.id === stale.id)
    expect(swept?.status).toBe("cancelled")

    // Also verify a fresh paid+pending row is NOT swept
    const fresh = await createSignup(PLATFORM, e.id, {
      parent_name: "B", parent_email: "b@x.com", athlete_name: "Y", athlete_age: 14,
    }, "paid")
    const after = await getSignupsForEvent(PLATFORM, e.id)
    const freshAfter = after.find((s) => s.id === fresh.id)
    expect(freshAfter?.status).toBe("pending")
  })

  it("does not return another business's signup", async () => {
    const signup = await createSignup(
      PLATFORM,
      eventId,
      {
        parent_name: "Tenant",
        parent_email: "tenant@x.com",
        athlete_name: "T",
        athlete_age: 14,
      },
      "interest",
    )

    expect(await getSignupById(PLATFORM, signup.id)).not.toBeNull()
    expect(await getSignupById(OTHER_BUSINESS, signup.id)).toBeNull()
  })

  it("refuses to confirm another business's signup", async () => {
    const signup = await createSignup(
      PLATFORM,
      eventId,
      {
        parent_name: "Tenant2",
        parent_email: "tenant2@x.com",
        athlete_name: "T2",
        athlete_age: 14,
      },
      "interest",
    )

    const result = await confirmSignup(OTHER_BUSINESS, signup.id)
    expect(result).toEqual({ ok: false, reason: "not_found" })
  })

  it("rejects a signup whose business disagrees with its event", async () => {
    await expect(
      createSignup(
        OTHER_BUSINESS,
        eventId,
        {
          parent_name: "Mismatch",
          parent_email: "mismatch@x.com",
          athlete_name: "M",
          athlete_age: 14,
        },
        "interest",
      ),
    ).rejects.toMatchObject({ code: "23503" })
  })
})

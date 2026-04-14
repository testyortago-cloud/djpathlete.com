import { describe, it, expect, afterAll } from "vitest"
import { randomUUID } from "crypto"
import {
  createEvent,
  updateEvent,
  deleteEvent,
  getEventById,
  getEventBySlug,
  getPublishedEvents,
  setEventStatus,
} from "@/lib/db/events"

describe("events DAL", () => {
  const createdIds: string[] = []

  afterAll(async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    for (const id of createdIds) await supabase.from("events").delete().eq("id", id)
  })

  it("creates and fetches by id + slug", async () => {
    const slug = `test-${randomUUID()}`
    const event = await createEvent({
      type: "clinic",
      slug,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "draft",
    })
    createdIds.push(event.id)
    expect(event.id).toBeDefined()
    expect(event.end_date).not.toBeNull() // clinic auto-end

    const byId = await getEventById(event.id)
    expect(byId?.id).toBe(event.id)

    const bySlug = await getEventBySlug(slug)
    expect(bySlug?.id).toBe(event.id)
  })

  it("rejects duplicate slugs", async () => {
    const slug = `dup-${randomUUID()}`
    const event = await createEvent({
      type: "clinic",
      slug,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "draft",
    })
    createdIds.push(event.id)

    await expect(
      createEvent({
        type: "clinic",
        slug,
        title: "T2",
        summary: "S",
        description: "D",
        focus_areas: [],
        start_date: new Date(Date.now() + 86400000).toISOString(),
        location_name: "L",
        capacity: 5,
        status: "draft",
      }),
    ).rejects.toThrow()
  })

  it("getPublishedEvents returns only published + upcoming", async () => {
    const draft = await createEvent({
      type: "clinic",
      slug: `draft-${randomUUID()}`,
      title: "D",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "draft",
    })
    createdIds.push(draft.id)

    const published = await createEvent({
      type: "clinic",
      slug: `pub-${randomUUID()}`,
      title: "P",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "published",
    })
    createdIds.push(published.id)

    const results = await getPublishedEvents({ type: "clinic" })
    expect(results.some((e) => e.id === published.id)).toBe(true)
    expect(results.some((e) => e.id === draft.id)).toBe(false)
  })

  it("setEventStatus enforces allowed transitions", async () => {
    const event = await createEvent({
      type: "clinic",
      slug: `trans-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "draft",
    })
    createdIds.push(event.id)

    await setEventStatus(event.id, "published")
    await expect(setEventStatus(event.id, "draft")).rejects.toThrow()
  })

  it("deleteEvent rejects non-draft", async () => {
    const event = await createEvent({
      type: "clinic",
      slug: `del-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "published",
    })
    createdIds.push(event.id)
    await expect(deleteEvent(event.id)).rejects.toThrow()
  })

  it("updateEvent converts price_dollars to price_cents", async () => {
    const event = await createEvent({
      type: "camp",
      slug: `camp-${randomUUID()}`,
      title: "C",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
      location_name: "L",
      capacity: 10,
      status: "draft",
      price_dollars: 299,
    })
    createdIds.push(event.id)
    expect(event.price_cents).toBe(29900)

    const updated = await updateEvent(event.id, { price_dollars: 349.5 })
    expect(updated.price_cents).toBe(34950)
  })
})

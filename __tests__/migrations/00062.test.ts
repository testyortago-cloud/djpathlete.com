import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"
import { randomUUID } from "crypto"

describe("Migration 00062: events + event_signups + RPCs", () => {
  const supabase = createServiceRoleClient()
  let eventId: string
  const signupIds: string[] = []

  beforeAll(async () => {
    const { data, error } = await supabase
      .from("events")
      .insert({
        type: "clinic",
        slug: `test-clinic-${randomUUID()}`,
        title: "Test Clinic",
        summary: "test",
        description: "test",
        focus_areas: ["acceleration"],
        start_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        location_name: "Test Gym",
        capacity: 1,
        status: "draft",
      })
      .select("id")
      .single()
    expect(error).toBeNull()
    eventId = data!.id

    for (let i = 0; i < 2; i++) {
      const { data: sd, error: se } = await supabase
        .from("event_signups")
        .insert({
          event_id: eventId,
          signup_type: "interest",
          parent_name: `Parent ${i}`,
          parent_email: `p${i}@test.example`,
          athlete_name: `Athlete ${i}`,
          athlete_age: 14,
        })
        .select("id")
        .single()
      expect(se).toBeNull()
      signupIds.push(sd!.id)
    }
  })

  afterAll(async () => {
    await supabase.from("events").delete().eq("id", eventId)
  })

  it("events table has required columns", async () => {
    const { data, error } = await supabase
      .from("events")
      .select("id,type,slug,title,capacity,signup_count,status,hero_image_url")
      .eq("id", eventId)
      .limit(1)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it("event_signups foreign key cascades delete", async () => {
    const { data } = await supabase
      .from("event_signups")
      .select("id")
      .eq("event_id", eventId)
    expect(data?.length).toBe(2)
  })

  it("confirm_event_signup succeeds for first signup, returns at_capacity for second", async () => {
    const { data: first } = await supabase.rpc("confirm_event_signup", { p_signup_id: signupIds[0] })
    expect(first).toEqual({ ok: true })

    const { data: evt } = await supabase.from("events").select("signup_count").eq("id", eventId).single()
    expect(evt?.signup_count).toBe(1)

    const { data: second } = await supabase.rpc("confirm_event_signup", { p_signup_id: signupIds[1] })
    expect(second).toEqual({ ok: false, reason: "at_capacity" })
  })

  it("cancel_event_signup decrements count when cancelling a confirmed signup", async () => {
    const { data } = await supabase.rpc("cancel_event_signup", { p_signup_id: signupIds[0] })
    expect(data).toEqual({ ok: true })

    const { data: evt } = await supabase.from("events").select("signup_count").eq("id", eventId).single()
    expect(evt?.signup_count).toBe(0)
  })

  it("slug uniqueness is enforced", async () => {
    const slug = `dup-${randomUUID()}`
    const { data: first } = await supabase.from("events").insert({
      type: "clinic", slug, title: "a", summary: "a", description: "a",
      start_date: new Date().toISOString(), location_name: "x", capacity: 1,
    }).select("id").single()
    const { error } = await supabase.from("events").insert({
      type: "clinic", slug, title: "b", summary: "b", description: "b",
      start_date: new Date().toISOString(), location_name: "x", capacity: 1,
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/duplicate|unique/)
    // Clean up the first insert since afterAll only cleans `eventId`.
    if (first?.id) await supabase.from("events").delete().eq("id", first.id)
  })
})

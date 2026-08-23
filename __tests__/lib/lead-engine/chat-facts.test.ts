// @vitest-environment node
//
// The privacy boundary for the chat assistant.
//
// `programs` carries TWO independent visibility columns. In the dev clone 40
// rows are `is_active` and exactly ONE of them is also `is_public`; the other
// 39 are individual clients' personal training plans, named after the athletes,
// with what each of them paid. So `is_active` alone is not "public", and an
// assistant wired to the obvious DAL would read a named client's plan and price
// out to any anonymous visitor.
//
// The Supabase mock below deliberately APPLIES the filters the code under test
// asks for, rather than handing back canned rows. A mock that ignored them
// would pass just as happily with `.eq("is_public", true)` deleted, which is
// the one bug this file exists to catch.
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BusinessSettings } from "@/lib/db/businesses"

const applied: Array<Record<string, unknown>> = []
let rows: Record<string, unknown>[] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = { __table: table }
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        eq(col: string, val: unknown) {
          filters[col] = val
          return chain
        },
        gte(col: string, val: unknown) {
          filters[`${col}__gte`] = val
          return chain
        },
        then(res: (v: unknown) => unknown) {
          applied.push(filters)
          // Only rows matching every applied eq() come back — a mock that
          // ignored the filters could not catch a missing one.
          const matching = rows.filter((r) =>
            Object.entries(filters).every(([k, v]) => k.startsWith("__") || k.endsWith("__gte") || r[k] === v),
          )
          return Promise.resolve({ data: matching, error: null }).then(res)
        },
      }
      return chain
    },
  }),
}))

const SETTINGS: BusinessSettings = {
  business_id: "00000000-0000-0000-0000-000000000001",
  display_name: "Test Business",
  sender_name: "Test Business",
  sender_email: "hello@example.com",
  reply_to: "hello@example.com",
  logo_url: null,
  timezone: "America/New_York",
  quiet_hours_start: 21,
  quiet_hours_end: 8,
  daily_message_cap: 200,
  postal_address: "12 Example Street, Springfield",
  sms_help_text: "Reply HELP for help.",
  sms_messaging_service_sid: "",
  sms_sender_phone: "+15550101234",
}

beforeEach(() => {
  applied.length = 0
  rows = []
})

describe("chat facts never leak a private programme", () => {
  it("filters on is_public as well as is_active", async () => {
    const { listPublicProgrammes } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      {
        name: "Rotational Reboot",
        is_active: true,
        is_public: true,
        price_cents: 7900,
        duration_weeks: 6,
        sessions_per_week: 3,
        payment_type: "one_time",
      },
      {
        name: "Jai Tennis Beast Mode",
        is_active: true,
        is_public: false,
        price_cents: 48000,
        duration_weeks: 8,
        sessions_per_week: 3,
        payment_type: "one_time",
      },
    ]
    const facts = await listPublicProgrammes()
    expect(facts.map((f) => (f as { name: string }).name)).toEqual(["Rotational Reboot"])
    expect(applied[0]).toMatchObject({ is_active: true, is_public: true })
  })

  it("a private programme's price never reaches groundedValues", async () => {
    const { listPublicProgrammes, groundedValuesFor } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      {
        name: "Rotational Reboot",
        is_active: true,
        is_public: true,
        price_cents: 7900,
        duration_weeks: 6,
        sessions_per_week: 3,
        payment_type: "one_time",
      },
      {
        name: "Ellen the English Ego",
        is_active: true,
        is_public: false,
        price_cents: 48000,
        duration_weeks: 8,
        sessions_per_week: 3,
        payment_type: "one_time",
      },
    ]
    const grounded = groundedValuesFor(await listPublicProgrammes(), SETTINGS)
    expect(grounded).toContain("79")
    expect(grounded).not.toContain("480")
    expect(grounded).not.toContain("48000")
  })
})

describe("chat facts respect every other visibility column", () => {
  it("only published FAQs", async () => {
    const { searchPublicFaqs } = await import("@/lib/lead-engine/chat/facts")
    rows = [{ question: "How much?", answer: "It depends", status: "published", page_key: "faq" }]
    await searchPublicFaqs("how much")
    expect(applied[0]).toMatchObject({ status: "published" })
  })

  it("only published events that have not ended, and it computes sold-out from data", async () => {
    const { listPublicEvents } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      {
        title: "Camp",
        type: "camp",
        status: "published",
        start_date: "2026-09-01T12:00:00Z",
        end_date: "2026-09-03T12:00:00Z",
        location_name: "Field",
        price_cents: 16500,
        capacity: 12,
        signup_count: 12,
      },
    ]
    const [fact] = (await listPublicEvents()) as Array<{ soldOut: boolean; spotsLeft: number }>
    expect(applied[0]).toMatchObject({ status: "published" })
    expect(applied[0]).toHaveProperty("end_date__gte")
    expect(fact.soldOut).toBe(true)
    expect(fact.spotsLeft).toBe(0)
  })

  it("only active testimonials", async () => {
    const { listPublicTestimonials } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      { quote: "Best coaching around.", name: "Sam R.", is_active: true, display_order: 0 },
      { quote: "Never published this one.", name: "Pat Q.", is_active: false, display_order: 1 },
    ]
    const facts = (await listPublicTestimonials()) as Array<{ author: string }>
    expect(facts.map((f) => f.author)).toEqual(["Sam R."])
    expect(applied[0]).toMatchObject({ is_active: true })
  })
})

describe("the accumulating fact set", () => {
  it("dedupes a repeated lookup and keeps groundedValues in step with facts", async () => {
    const { emptyFactSet, mergeFacts } = await import("@/lib/lead-engine/chat/facts")
    const fact = {
      kind: "programme" as const,
      name: "Rotational Reboot",
      priceCents: 7900,
      durationWeeks: 6,
      sessionsPerWeek: 3,
      paymentType: "one_time",
    }
    const once = mergeFacts(emptyFactSet(), [fact])
    const twice = mergeFacts(once, [fact])
    expect(twice.facts).toHaveLength(1)
    expect(twice.groundedValues).toContain("79")
    // Empty means empty: a turn where no tool returned anything must ground
    // nothing, or the validator would wave through a number nobody looked up.
    expect(emptyFactSet().facts).toEqual([])
    expect(emptyFactSet().groundedValues).toEqual([])
  })
})

describe("chat facts do not reach for the convenient function", () => {
  it("imports no general DAL", async () => {
    const { readFileSync } = await import("fs")
    const src = readFileSync("lib/lead-engine/chat/facts.ts", "utf8")
    for (const forbidden of ["@/lib/db/programs", "@/lib/db/events", "@/lib/db/faqs", "@/lib/db/testimonials"]) {
      expect(src).not.toContain(forbidden)
    }
  })
})

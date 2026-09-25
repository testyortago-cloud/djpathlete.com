// @vitest-environment node
//
// listPublicEvents() is the one direct `.from()` reader in
// lib/lead-engine/chat/facts.ts that had NO tenant predicate at all before
// this file existed. Every other visibility rule in facts.ts (is_public,
// status='published', is_active) is pinned by chat-facts.test.ts's own
// filter-applying mock — this file adds the same discipline for
// business_id, because before this change a coach's public /ask chat
// answered questions using the PLATFORM's own camps and clinics: a live
// cross-tenant leak, not a hypothetical one.
//
// The mock below deliberately APPLIES the filters the code under test asks
// for (same idiom as chat-facts.test.ts), rather than handing back canned
// rows regardless. A mock that ignored `.eq("business_id", ...)` would pass
// just as happily with the predicate deleted.
import { describe, it, expect, beforeEach, vi } from "vitest"

const applied: Array<Record<string, unknown>> = []
// Every table a reader opened a client on — the proof, for the G35 tests
// below, that another business's lookup never reached the database at all.
const opened: string[] = []
let rows: Record<string, unknown>[] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      opened.push(table)
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

// The seam, mocked to a sentinel that is NOT the singleton's literal, so a
// reader comparing against a hard-coded id instead of asking the seam fails the
// platform controls below. listPublicEvents never consults it.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

const HOST_BIZ = "host-biz"
const OTHER_BIZ = "other-biz"

const CAMP = {
  title: "Camp",
  type: "camp",
  status: "published",
  start_date: "2026-09-01T12:00:00Z",
  end_date: "2026-09-03T12:00:00Z",
  location_name: "Field",
  price_cents: 16500,
  capacity: 12,
  signup_count: 0,
}

beforeEach(() => {
  applied.length = 0
  opened.length = 0
  rows = []
})

describe("listPublicEvents tenancy", () => {
  it("only offers the conversation's own business's events as chat facts", async () => {
    const { listPublicEvents } = await import("@/lib/lead-engine/chat/facts")
    rows = [{ ...CAMP, business_id: HOST_BIZ }]
    const facts = await listPublicEvents(HOST_BIZ)
    expect(applied[0]).toMatchObject({ business_id: HOST_BIZ })
    expect(facts).toHaveLength(1)
  })

  it("never surfaces another business's event, even one published and unended", async () => {
    const { listPublicEvents } = await import("@/lib/lead-engine/chat/facts")
    // Real row belongs to a DIFFERENT tenant than the one asking — the mock
    // APPLIES the business_id filter, so this proves the predicate actually
    // excludes it rather than merely being present in the query builder.
    rows = [{ ...CAMP, business_id: OTHER_BIZ }]
    const facts = await listPublicEvents(HOST_BIZ)
    expect(facts).toHaveLength(0)
  })

  it("never substitutes the platform's own id for the tenant the caller named", async () => {
    const { listPublicEvents } = await import("@/lib/lead-engine/chat/facts")
    rows = [{ ...CAMP, business_id: HOST_BIZ }]
    await listPublicEvents(HOST_BIZ)
    expect(applied[0].business_id).toBe(HOST_BIZ)
    expect(applied[0].business_id).not.toBe("00000000-0000-0000-0000-000000000001")
  })
})

// ---------------------------------------------------------------------------
// G35. `faqs`, `programs` and `testimonials` have NO business_id column, so no
// predicate can scope them: every row is the platform business's own. The
// owner's ruling is that another business's conversation gets NOTHING from
// them, never the platform's rows under that coach's name, and gets it before
// any query is made.
// ---------------------------------------------------------------------------

const PLATFORM_BIZ = "platform-biz"
const COACH_BIZ = "coach-biz"

const FAQ = { question: "How much is the camp?", answer: "Camp pricing", status: "published", page_key: "faq" }
const PROGRAMME = {
  name: "Rotational Reboot",
  is_active: true,
  is_public: true,
  price_cents: 7900,
  duration_weeks: 6,
  sessions_per_week: 3,
  payment_type: "one_time",
}
const TESTIMONIAL = { quote: "Best coaching around.", name: "Sam R.", is_active: true, display_order: 0 }

// Each "nothing" test kills two mutants: the gate deleted (the platform's row
// comes back), and the gate moved AFTER the read, filtering what came back
// (`opened` is no longer empty). Each control beside it proves the reader
// still answers the platform business, so the "nothing" is not a broken reader.
describe("the platform's own FAQs, programmes and testimonials (G35)", () => {
  it("gives another business's conversation no FAQs, and opens no client", async () => {
    const { searchPublicFaqs } = await import("@/lib/lead-engine/chat/facts")
    rows = [FAQ]
    expect(await searchPublicFaqs(COACH_BIZ, "camp pricing")).toEqual([])
    expect(opened).toEqual([])
  })

  it("still answers the platform business's conversation from its FAQs (control)", async () => {
    const { searchPublicFaqs } = await import("@/lib/lead-engine/chat/facts")
    rows = [FAQ]
    const facts = (await searchPublicFaqs(PLATFORM_BIZ, "camp pricing")) as Array<{ question: string }>
    expect(facts.map((f) => f.question)).toEqual(["How much is the camp?"])
    expect(opened).toEqual(["faqs"])
  })

  it("gives another business's conversation no programmes, and opens no client", async () => {
    const { listPublicProgrammes } = await import("@/lib/lead-engine/chat/facts")
    rows = [PROGRAMME]
    expect(await listPublicProgrammes(COACH_BIZ)).toEqual([])
    expect(opened).toEqual([])
  })

  it("still lists the platform business's public programmes (control)", async () => {
    const { listPublicProgrammes } = await import("@/lib/lead-engine/chat/facts")
    rows = [PROGRAMME]
    const facts = (await listPublicProgrammes(PLATFORM_BIZ)) as Array<{ name: string }>
    expect(facts.map((f) => f.name)).toEqual(["Rotational Reboot"])
    expect(opened).toEqual(["programs"])
  })

  it("gives another business's conversation no testimonials, and opens no client", async () => {
    const { listPublicTestimonials } = await import("@/lib/lead-engine/chat/facts")
    rows = [TESTIMONIAL]
    expect(await listPublicTestimonials(COACH_BIZ)).toEqual([])
    expect(opened).toEqual([])
  })

  it("still reads the platform business's testimonials (control)", async () => {
    const { listPublicTestimonials } = await import("@/lib/lead-engine/chat/facts")
    rows = [TESTIMONIAL]
    const facts = (await listPublicTestimonials(PLATFORM_BIZ)) as Array<{ author: string }>
    expect(facts.map((f) => f.author)).toEqual(["Sam R."])
    expect(opened).toEqual(["testimonials"])
  })
})

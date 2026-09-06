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
        name: "Private Plan — Athlete A",
        is_active: true,
        is_public: false,
        price_cents: 31200,
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
        name: "Private Plan — Athlete B",
        is_active: true,
        is_public: false,
        price_cents: 31200,
        duration_weeks: 8,
        sessions_per_week: 3,
        payment_type: "one_time",
      },
    ]
    const grounded = groundedValuesFor(await listPublicProgrammes(), SETTINGS)
    expect(grounded).toContain("79")
    expect(grounded).not.toContain("312")
    expect(grounded).not.toContain("31200")
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
        business_id: SETTINGS.business_id,
        start_date: "2026-09-01T12:00:00Z",
        end_date: "2026-09-03T12:00:00Z",
        location_name: "Field",
        price_cents: 16500,
        capacity: 12,
        signup_count: 12,
      },
    ]
    const [fact] = (await listPublicEvents(SETTINGS.business_id)) as Array<{ soldOut: boolean; spotsLeft: number }>
    expect(applied[0]).toMatchObject({ status: "published", business_id: SETTINGS.business_id })
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

describe("groundedValues cannot be tricked by a unit confusion", () => {
  it("never grounds the RAW CENTS form of a price", async () => {
    // Guards lib/lead-engine/chat/facts.ts moneyForms(). If "7900" were
    // grounded, an assistant writing "$7900" for a $79.00 programme would pass
    // the output validator — a hundredfold error wearing the authority of a
    // database-backed fact. Without this test the omission is invisible:
    // restoring String(cents) breaks nothing else in this file.
    const { listPublicProgrammes, groundedValuesFor } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      {
        name: "Public Programme",
        is_active: true,
        is_public: true,
        price_cents: 7900,
        duration_weeks: 6,
        sessions_per_week: 3,
        payment_type: "one_time",
      },
    ]
    const grounded = groundedValuesFor(await listPublicProgrammes(), SETTINGS)
    expect(grounded).toContain("79")
    expect(grounded).toContain("79.00")
    expect(grounded).not.toContain("7900")
  })
})

describe("date forms cover the shapes a model actually writes", () => {
  it("grounds Sept, day-first-with-year and numeric dates, so the validator cannot block the truth", async () => {
    // Under-generating here does not merely lose a nicety: the validator
    // recognises the reply as carrying a date, finds no grounded form, and
    // discards an ACCURATE answer as a fabrication.
    const { listPublicEvents, groundedValuesFor } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      {
        title: "Camp",
        type: "camp",
        status: "published",
        business_id: SETTINGS.business_id,
        start_date: "2026-09-01T12:00:00Z",
        end_date: "2026-09-03T12:00:00Z",
        location_name: "Field",
        price_cents: 16500,
        capacity: 12,
        signup_count: 0,
      },
    ]
    const grounded = groundedValuesFor(await listPublicEvents(SETTINGS.business_id), SETTINGS)
    for (const form of ["september 1", "sep 1", "sept 1", "1 september 2026", "9/1/2026"]) {
      expect(grounded).toContain(form)
    }
  })
})

// ---------------------------------------------------------------------------
// Review findings 3, 4, 7 and 8.
// ---------------------------------------------------------------------------

/** A camp that is NOT in September — the whole point of the first block below. */
const JULY_CAMP = {
  title: "Camp",
  type: "camp",
  status: "published",
  business_id: SETTINGS.business_id,
  start_date: "2026-07-24T12:00:00Z",
  end_date: "2026-07-26T12:00:00Z",
  location_name: "Field",
  price_cents: 16500,
  capacity: 12,
  signup_count: 0,
}

describe("the Sept form belongs to September and to no other month", () => {
  it("does not ground 'sept 24' for a camp that starts 24 July", async () => {
    // THE DEFECT. `Sept ${day}` was emitted unconditionally, so a July camp
    // grounded "sept 24" — and an assistant writing "The camp starts Sept 24"
    // passed the validator while the card beside it said 24 July.
    //
    // The test that was here could not see this: its fixture was a SEPTEMBER
    // camp, which makes "sept 1" correct whether the form is conditional or
    // not. A fixture that makes the expectation trivially true proves nothing.
    const { listPublicEvents, groundedValuesFor } = await import("@/lib/lead-engine/chat/facts")
    rows = [JULY_CAMP]
    const grounded = groundedValuesFor(await listPublicEvents(SETTINGS.business_id), SETTINGS)
    expect(grounded).not.toContain("sept 24")
    // The honest July forms are all still there, so this is not passing by
    // grounding nothing at all.
    for (const form of ["july 24", "jul 24", "24 july", "24 july 2026", "7/24/2026"]) {
      expect(grounded).toContain(form)
    }
  })

  it("still grounds 'sept 1' for a camp that really does start in September", async () => {
    const { listPublicEvents, groundedValuesFor } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      {
        ...JULY_CAMP,
        start_date: "2026-09-01T12:00:00Z",
        end_date: "2026-09-03T12:00:00Z",
      },
    ]
    const grounded = groundedValuesFor(await listPublicEvents(SETTINGS.business_id), SETTINGS)
    expect(grounded).toContain("sept 1")
  })
})

describe("a price that is not a whole number of dollars", () => {
  it("never grounds the rounded dollar for a price ending in cents", async () => {
    // THE DEFECT. `String(Math.round(dollars))` grounded "80" for a 7950-cent
    // programme, so "It's $80." passed the validator for a $79.50 programme.
    // Every price fixture in this branch was a whole number of dollars, which
    // is why nothing saw it.
    const { listPublicProgrammes, groundedValuesFor } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      {
        name: "Public Programme",
        is_active: true,
        is_public: true,
        price_cents: 7950,
        duration_weeks: 6,
        sessions_per_week: 3,
        payment_type: "one_time",
      },
    ]
    const grounded = groundedValuesFor(await listPublicProgrammes(), SETTINGS)
    // `normalise()` strips the dollar sign on BOTH sides of the comparison, so
    // the grounded list holds "80", never "$80" — asserting the absence of
    // "$80" would be trivially true and would prove nothing.
    expect(grounded).not.toContain("80")
    expect(grounded).not.toContain("79")
    // The true form survives, so the fix is not "ground nothing".
    expect(grounded).toContain("79.50")
  })

  it("still grounds the bare dollar for a whole-dollar price", async () => {
    const { listPublicProgrammes, groundedValuesFor } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      {
        name: "Public Programme",
        is_active: true,
        is_public: true,
        price_cents: 7900,
        duration_weeks: 6,
        sessions_per_week: 3,
        payment_type: "one_time",
      },
    ]
    const grounded = groundedValuesFor(await listPublicProgrammes(), SETTINGS)
    expect(grounded).toContain("79")
    expect(grounded).toContain("79.00")
  })
})

describe("an FAQ is public only on a page the public can open", () => {
  it("never returns an FAQ hung off an unannounced event's page key", async () => {
    // `lib/validators/faq.ts` admits `event/<id>` page keys, and the clone
    // holds three DRAFT events. `status='published'` alone is therefore not
    // the site's visibility rule: a published FAQ about an unannounced camp is
    // invisible on the site and would have been read out to strangers here.
    //
    // The mock filters only on the `.eq()` calls the code makes, and the code
    // makes none for `page_key` here — so the event row IS handed back, and
    // the assertion proves the module dropped it rather than the mock.
    const { searchPublicFaqs } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      { question: "How much is the camp?", answer: "Camp pricing", status: "published", page_key: "faq" },
      {
        question: "How much is the secret camp?",
        answer: "Camp pricing for the unannounced one",
        status: "published",
        page_key: "event/8f1c2d3e-0000-4000-8000-000000000001",
      },
    ]
    const facts = (await searchPublicFaqs("camp pricing")) as Array<{ question: string }>
    expect(facts.map((f) => f.question)).toEqual(["How much is the camp?"])
  })

  it("does not even ask the database when the caller names a page key the public cannot open", async () => {
    const { searchPublicFaqs } = await import("@/lib/lead-engine/chat/facts")
    rows = [
      {
        question: "How much is the secret camp?",
        answer: "Camp pricing",
        status: "published",
        page_key: "event/8f1c2d3e-0000-4000-8000-000000000001",
      },
    ]
    const facts = await searchPublicFaqs("camp pricing", "event/8f1c2d3e-0000-4000-8000-000000000001")
    expect(facts).toEqual([])
    // `applied` is the proof that the SHORT CIRCUIT fired and not merely the
    // row filter downstream of it: narrowing a request must never widen the
    // query behind it into a scan of every published FAQ.
    expect(applied).toEqual([])
  })

  it("still returns the published FAQs on a page the public CAN open", async () => {
    const { searchPublicFaqs } = await import("@/lib/lead-engine/chat/facts")
    rows = [{ question: "How much is the camp?", answer: "Camp pricing", status: "published", page_key: "faq" }]
    const facts = (await searchPublicFaqs("camp pricing", "faq")) as Array<{ question: string }>
    expect(facts.map((f) => f.question)).toEqual(["How much is the camp?"])
  })
})

describe("numbers the visitor supplied", () => {
  it("collects the visitor's own numerals, and nothing else", async () => {
    const { visitorNumerals } = await import("@/lib/lead-engine/chat/facts")
    expect(visitorNumerals(["my son is 14", "he trains 3 days a week"])).toEqual(expect.arrayContaining(["14", "3"]))
  })

  it("does not collect a currency amount the visitor typed", async () => {
    // A visitor can supply their child's age. They cannot supply your prices:
    // "I heard it's $500" must not make $500 a grounded answer.
    const { visitorNumerals } = await import("@/lib/lead-engine/chat/facts")
    expect(visitorNumerals(["I heard it's $500 a month"])).not.toContain("500")
  })
})

describe("a price must come from money, not from any number in an FAQ", () => {
  /**
   * Observed in a REAL captured turn. The grounded values for a question about
   * group sizes included `6585` and `33541` — the street number and postcode
   * out of a "what areas do you serve?" FAQ answer. Either would have let a
   * reply saying "it's $6585" pass the currency rule, which is a fabricated
   * price wearing the authority of a database-backed fact.
   *
   * `groundedValuesFor` stays permissive on purpose, so the assistant is not
   * blocked for quoting its own source material. The CURRENCY rule reads this
   * narrower list instead.
   */
  const ADDRESS_FAQ = {
    kind: "faq" as const,
    question: "What areas do you serve for in-person training?",
    answer: "Our facility is at 6585 Simons Rd, Zephyrhills, FL 33541 — serving the greater Tampa Bay area.",
    pageKey: "faq",
  }

  it("does not let a street number or a postcode ground a price", async () => {
    const { groundedMoneyFor, groundedValuesFor } = await import("@/lib/lead-engine/chat/facts")

    // Still grounded as ordinary numbers — the assistant may read its address out.
    const all = groundedValuesFor([ADDRESS_FAQ], SETTINGS)
    expect(all).toContain("6585")
    expect(all).toContain("33541")

    // But neither is money.
    const money = groundedMoneyFor([ADDRESS_FAQ])
    expect(money).not.toContain("6585")
    expect(money).not.toContain("33541")
  })

  it("still grounds a price that an FAQ actually states as money", async () => {
    const { groundedMoneyFor } = await import("@/lib/lead-engine/chat/facts")
    const priced = {
      kind: "faq" as const,
      question: "How much are group sessions?",
      answer: "Group sessions start at $85 per athlete.",
      pageKey: "faq",
    }
    const money = groundedMoneyFor([priced])
    expect(money).toContain("85")
    expect(money).toContain("85.00")
  })

  it("grounds a programme's own price from its column", async () => {
    const { groundedMoneyFor } = await import("@/lib/lead-engine/chat/facts")
    const programme = {
      kind: "programme" as const,
      name: "Public Programme",
      priceCents: 7900,
      durationWeeks: 6,
      sessionsPerWeek: 3,
      paymentType: "one_time",
    }
    expect(groundedMoneyFor([programme])).toContain("79")
  })
})

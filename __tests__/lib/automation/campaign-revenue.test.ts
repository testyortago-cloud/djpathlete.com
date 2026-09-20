// @vitest-environment node
//
// `readCampaignRevenue` (Task 7) is the read-only aggregator that traces won
// pipeline revenue back to the campaign that produced it. It is NOT mocked
// here — its real logic runs for real against an in-memory Supabase mock,
// same "mock the DAL, run the real logic" shape as
// __tests__/db/pipeline.test.ts and __tests__/lib/automation/pipeline-reconcile.test.ts.
//
// Deliberately no `payments` table in this Store: the reader must derive
// revenue from `opportunities.value_cents` only (see "reads value from
// opportunities, not from payments" below). If the implementation ever
// reaches for a `payments` table, `store["payments"]` is `undefined` and the
// mock's `rows.filter(...)` throws — that failure IS the regression check.
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, any>

type Store = {
  opportunities: Row[]
  marketing_attribution: Row[]
  // G15 reads two more sources: leads come from `contacts`, and registrations
  // include paid `event_signups`. Still no `payments` table, deliberately —
  // see the note above.
  contacts: Row[]
  event_signups: Row[]
}

const store: Store = {
  opportunities: [],
  marketing_attribution: [],
  contacts: [],
  event_signups: [],
}

let seqCounter = 0
function nextId(prefix: string) {
  seqCounter += 1
  return `${prefix}-${seqCounter}`
}

// NOTE ON THE MOCK: copied (structure verbatim) from
// __tests__/lib/automation/pipeline-reconcile.test.ts, itself copied from
// __tests__/db/pipeline.test.ts. The trap this project has shipped twice is
// a `.eq()` that returns the query object without recording the filter, so
// every query resolves to "everything in the table" and every assertion
// passes without ever exercising the real filtering logic. This mock tracks
// every applied `.eq()`/`.gte()`/`.lt()`/`.in()` filter and narrows the row
// set for real.
//
// Column-default note (see task-7 instructions): this reader only selects
// columns every test fixture below sets explicitly (`closed_at`,
// `outcome`, `value_cents`, `source_session_id`, `session_id`, `utm_*`) —
// nothing here depends on a Postgres-side column default the mock would
// need to fake (unlike `opportunity_stage_events.occurred_at` in the
// pipeline-reconcile harness).
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: keyof Store) => {
      const rows = store[table]
      const filters: Array<[string, any]> = []
      const gteFilters: Array<[string, any]> = []
      const ltFilters: Array<[string, any]> = []
      const inFilters: Array<[string, any[]]> = []
      // `range` SLICES rather than being recorded and ignored. A mock that
      // accepted it and returned everything would make the paging loops look
      // correct while never exercising a second page — and would spin forever
      // the day a loop's exit condition broke.
      let range: [number, number] | null = null

      const passesFilters = (row: Row) =>
        filters.every(([col, val]) => row[col] === val) &&
        gteFilters.every(([col, val]) => row[col] >= val) &&
        ltFilters.every(([col, val]) => row[col] < val) &&
        inFilters.every(([col, vals]) => vals.includes(row[col]))

      // THE MOCK ENFORCES POSTGREST'S LIMITS, it does not merely accept the
      // calls that respect them. A fake that returned everything made
      // `PAGE = 1000` and `IN_CHUNK = 200` free to be any number at all: a
      // mutation raising both to 100000 passed every test in this file,
      // because nothing in the harness ever truncated. The two caps below are
      // what make the paging and chunking tests mean anything.
      const ROW_CAP = 1000
      /** Past this an `.in(...)` list is too long for the query string. */
      const IN_CAP = 200

      const matched = (): Row[] => {
        const hits = rows.filter(passesFilters)
        const windowed = range ? hits.slice(range[0], range[1] + 1) : hits
        // TRUNCATES, exactly as PostgREST does. It does not error, which is
        // precisely what makes an unpaged read fail silently in production.
        return windowed.slice(0, ROW_CAP)
      }

      const execute = (): { data: any; error: any } => {
        const tooLong = inFilters.find(([, vals]) => vals.length > IN_CAP)
        if (tooLong) {
          // The real failure is a 414 on the URL's length, not a Postgres
          // error — loud rather than silent, but still a broken page.
          return {
            data: null,
            error: { code: "414", message: `URI too long: ${tooLong[1].length} ids in one .in()` },
          }
        }
        return { data: matched(), error: null }
      }

      const api: any = {
        select: () => api,
        eq: (col: string, val: any) => {
          filters.push([col, val])
          return api
        },
        gte: (col: string, val: any) => {
          gteFilters.push([col, val])
          return api
        },
        lt: (col: string, val: any) => {
          ltFilters.push([col, val])
          return api
        },
        in: (col: string, vals: any[]) => {
          inFilters.push([col, vals])
          return api
        },
        range: (from: number, to: number) => {
          range = [from, to]
          return api
        },
        // Makes a bare `await supabase.from(...).select(...).eq(...)` (no
        // terminal .single()/.maybeSingle()) resolve like the real client.
        then: (resolve: (v: { data: any; error: any }) => void, reject?: (e: any) => void) => {
          try {
            resolve(execute())
          } catch (e) {
            if (reject) reject(e)
            else throw e
          }
        },
      }
      return api
    },
  }),
}))

import { funnelSlugFromLandingUrl, readCampaignRevenue } from "@/lib/automation/campaign-revenue"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

const DAY_MS = 86_400_000

beforeEach(() => {
  store.opportunities = []
  store.marketing_attribution = []
  store.contacts = []
  store.event_signups = []
  seqCounter = 0
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function seedWonOpportunity(overrides: Row = {}): Row {
  const opp = {
    id: nextId("opp"),
    business_id: SINGLETON_BUSINESS_ID,
    outcome: "won",
    value_cents: 10_000,
    currency: "usd",
    source_session_id: null,
    closed_at: new Date().toISOString(),
    ...overrides,
  }
  store.opportunities.push(opp)
  return opp
}

function seedOpenOpportunity(overrides: Row = {}): Row {
  const opp = {
    id: nextId("opp"),
    business_id: SINGLETON_BUSINESS_ID,
    outcome: null,
    value_cents: null,
    currency: "usd",
    source_session_id: null,
    closed_at: null,
    ...overrides,
  }
  store.opportunities.push(opp)
  return opp
}

function seedLostOpportunity(overrides: Row = {}): Row {
  const opp = {
    id: nextId("opp"),
    business_id: SINGLETON_BUSINESS_ID,
    outcome: "lost",
    value_cents: null,
    currency: "usd",
    source_session_id: null,
    closed_at: new Date().toISOString(),
    ...overrides,
  }
  store.opportunities.push(opp)
  return opp
}

function seedAttribution(sessionId: string, overrides: Row = {}): Row {
  const row = {
    id: nextId("attr"),
    session_id: sessionId,
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "spring-sale",
    utm_term: null,
    utm_content: null,
    gclid: null,
    first_seen_at: new Date().toISOString(),
    ...overrides,
  }
  store.marketing_attribution.push(row)
  return row
}

function sum(rows: Array<{ wonValueCents: number }>): number {
  return rows.reduce((total, r) => total + r.wonValueCents, 0)
}

function findUnattributed(rows: Awaited<ReturnType<typeof readCampaignRevenue>>) {
  // Fix round 1, Finding 2: `unattributedCount > 0` is NOT the discriminator
  // — it returns `undefined` in exactly the case that must stay visible
  // (every deal attributed cleanly, bucket row present with a zero count).
  // `isUnattributed` is the contract; it is `true` on the bucket row
  // regardless of its counts.
  return rows.find((r) => r.isUnattributed)
}

// ---------------------------------------------------------------------------

describe("readCampaignRevenue", () => {
  const since = new Date(Date.now() - 7 * DAY_MS)
  const until = new Date(Date.now() + DAY_MS)

  it("groups won value by utm_campaign", async () => {
    seedAttribution("sess-a", { utm_source: "google", utm_campaign: "spring-sale" })
    seedAttribution("sess-b", { utm_source: "google", utm_campaign: "spring-sale" })
    seedAttribution("sess-c", { utm_source: "facebook", utm_campaign: "summer-push" })

    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 5_000 })
    seedWonOpportunity({ source_session_id: "sess-b", value_cents: 7_500 })
    seedWonOpportunity({ source_session_id: "sess-c", value_cents: 2_000 })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    const spring = rows.find((r) => r.utmCampaign === "spring-sale")
    const summer = rows.find((r) => r.utmCampaign === "summer-push")

    expect(spring).toBeDefined()
    expect(spring?.wonCount).toBe(2)
    expect(spring?.wonValueCents).toBe(12_500)
    expect(spring?.utmSource).toBe("google")
    expect(spring?.isUnattributed).toBe(false)

    expect(summer).toBeDefined()
    expect(summer?.wonCount).toBe(1)
    expect(summer?.wonValueCents).toBe(2_000)
    expect(summer?.isUnattributed).toBe(false)
  })

  // Final review, Minor: spec §7 groups by utm_campaign / utm_source / gclid,
  // not utm_medium. Before this fix, two won deals with the SAME gclid but no
  // utm_* params at all (a plain Google Ads text ad, no UTM tagging) grouped
  // into the utm_source/utm_medium/utm_campaign-only key `[null, null, null]`
  // — identical to (and merged with) genuinely unattributed deals, even
  // though every one of them has a real, distinguishing click id.
  it("groups a gclid-only paid click as its own campaign row, not folded into utm_medium or Unattributed", async () => {
    seedAttribution("sess-gclid-a", {
      utm_source: null,
      utm_campaign: null,
      gclid: "Cj0KCQjw-click-1",
    })
    seedAttribution("sess-gclid-b", {
      utm_source: null,
      utm_campaign: null,
      gclid: "Cj0KCQjw-click-1",
    })

    seedWonOpportunity({ source_session_id: "sess-gclid-a", value_cents: 10_000 })
    seedWonOpportunity({ source_session_id: "sess-gclid-b", value_cents: 20_000 })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    const gclidRow = rows.find((r) => !r.isUnattributed && r.gclid === "Cj0KCQjw-click-1")
    expect(gclidRow).toBeDefined()
    expect(gclidRow?.wonCount).toBe(2)
    expect(gclidRow?.wonValueCents).toBe(30_000)

    const unattributed = findUnattributed(rows)
    // The gclid clicks must NOT have landed in the unattributed bucket —
    // they matched a real marketing_attribution row.
    expect(unattributed?.unattributedCount).toBe(0)
  })

  it("reads value from opportunities, not from payments", async () => {
    seedAttribution("sess-a")
    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 42_000 })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(sum(rows)).toBe(42_000)
  })

  it("counts a won deal with no session id as unattributed rather than dropping it", async () => {
    seedWonOpportunity({ source_session_id: null, value_cents: 9_900 })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    const unattributed = findUnattributed(rows)
    expect(unattributed).toBeDefined()
    expect(unattributed?.isUnattributed).toBe(true)
    expect(unattributed?.unattributedCount).toBe(1)
    expect(unattributed?.wonValueCents).toBe(9_900)
    expect(unattributed?.utmSource).toBeNull()
    expect(unattributed?.gclid).toBeNull()
    expect(unattributed?.utmCampaign).toBeNull()
  })

  it("counts a session id with no attribution row as unattributed", async () => {
    // "sess-orphan" never gets a marketing_attribution row.
    seedWonOpportunity({ source_session_id: "sess-orphan", value_cents: 15_000 })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    const unattributed = findUnattributed(rows)
    expect(unattributed).toBeDefined()
    expect(unattributed?.unattributedCount).toBe(1)
    expect(unattributed?.wonValueCents).toBe(15_000)
  })

  it("both unattributed failure modes accumulate into the same bucket", async () => {
    seedWonOpportunity({ source_session_id: null, value_cents: 1_000 })
    seedWonOpportunity({ source_session_id: "sess-orphan", value_cents: 2_000 })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    const unattributed = findUnattributed(rows)
    expect(unattributed?.unattributedCount).toBe(2)
    expect(unattributed?.wonValueCents).toBe(3_000)
  })

  // Fix round 1, Finding 2: this is the case both the implementation and
  // the original `findUnattributed` discriminator missed — every won deal
  // attributes cleanly, so `unattributedCount` stays 0 on the bucket row.
  // The row must still exist and be findable, or a UI following the old
  // `unattributedCount > 0` contract silently omits "Unattributed: $0" in
  // exactly the month it would be reassuring to see it.
  it("still surfaces a findable, zeroed unattributed bucket when every won deal attributes cleanly", async () => {
    seedAttribution("sess-a")
    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 6_000 })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    const unattributed = findUnattributed(rows)
    expect(unattributed).toBeDefined()
    expect(unattributed?.isUnattributed).toBe(true)
    expect(unattributed?.unattributedCount).toBe(0)
    expect(unattributed?.wonValueCents).toBe(0)
  })

  it("excludes open and lost deals", async () => {
    seedAttribution("sess-a")
    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 8_000 })
    seedOpenOpportunity({ source_session_id: "sess-a", value_cents: null })
    seedLostOpportunity({ source_session_id: "sess-a" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(sum(rows)).toBe(8_000)
    const spring = rows.find((r) => r.utmCampaign === "spring-sale")
    expect(spring?.wonCount).toBe(1)
  })

  it("excludes deals closed outside the window", async () => {
    seedAttribution("sess-a")
    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 3_000, closed_at: new Date().toISOString() })
    seedWonOpportunity({
      source_session_id: "sess-a",
      value_cents: 99_000,
      closed_at: new Date(since.getTime() - DAY_MS).toISOString(), // before the window
    })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(sum(rows)).toBe(3_000)
  })

  it("returns an empty list, not an error, when nothing is won yet", async () => {
    seedOpenOpportunity({ source_session_id: "sess-a" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(rows).toEqual([])
  })

  // Task 7 (multi-tenancy): `readCampaignRevenue` used to scope its opportunities
  // read to the hardcoded SINGLETON_BUSINESS_ID regardless of who asked. This
  // seeds a SECOND business's won deal in the SAME window and proves each call
  // sees only its own business's revenue — a test that only ever seeded one
  // business could pass just as well against the old hardcoded scope.
  it("scopes to the businessId it was given, not always the singleton", async () => {
    const OTHER_BUSINESS = "33333333-3333-3333-3333-333333333333"

    seedAttribution("sess-mine", { utm_campaign: "mine-campaign" })
    seedWonOpportunity({ business_id: SINGLETON_BUSINESS_ID, source_session_id: "sess-mine", value_cents: 5_000 })

    seedAttribution("sess-theirs", { utm_campaign: "their-campaign" })
    seedWonOpportunity({ business_id: OTHER_BUSINESS, source_session_id: "sess-theirs", value_cents: 99_000 })

    const mine = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })
    expect(sum(mine)).toBe(5_000)
    expect(mine.some((r) => r.utmCampaign === "their-campaign")).toBe(false)

    const theirs = await readCampaignRevenue({ since, until, businessId: OTHER_BUSINESS })
    expect(sum(theirs)).toBe(99_000)
    expect(theirs.some((r) => r.utmCampaign === "mine-campaign")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// G15 — the three numbers that are not "won".
//
// Production holds 2 won opportunities against 572 attribution rows, so a page
// reporting only won deals cannot tell a campaign nobody clicked from one with
// forty leads and no sale yet. Every assertion below names the number it
// expects on the row it expects: "a row came back" passes just as happily when
// one campaign's leads are counted against another's.
// ---------------------------------------------------------------------------

function seedContact(overrides: Row = {}): Row {
  const contact = {
    id: nextId("contact"),
    business_id: SINGLETON_BUSINESS_ID,
    first_touch_session_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
  store.contacts.push(contact)
  return contact
}

function seedSignup(overrides: Row = {}): Row {
  const signup = {
    id: nextId("signup"),
    business_id: SINGLETON_BUSINESS_ID,
    gclid: null,
    amount_paid_cents: 9_900,
    created_at: new Date().toISOString(),
    ...overrides,
  }
  store.event_signups.push(signup)
  return signup
}

describe("readCampaignRevenue — leads, registrations and organic funnels", () => {
  const since = new Date(Date.now() - 7 * DAY_MS)
  const until = new Date(Date.now() + DAY_MS)
  const campaignOf = (rows: Awaited<ReturnType<typeof readCampaignRevenue>>, name: string) =>
    rows.find((r) => r.utmCampaign === name)

  it("counts LEADS — contacts first touched by the campaign, created in the window", async () => {
    seedAttribution("sess-a", { utm_campaign: "spring-sale" })
    seedAttribution("sess-b", { utm_campaign: "summer-push" })
    seedContact({ first_touch_session_id: "sess-a" })
    seedContact({ first_touch_session_id: "sess-a" })
    seedContact({ first_touch_session_id: "sess-b" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(campaignOf(rows, "spring-sale")?.leadCount).toBe(2)
    expect(campaignOf(rows, "summer-push")?.leadCount).toBe(1)
  })

  it("counts a lead created OUTSIDE the window against neither campaign", async () => {
    seedAttribution("sess-a", { utm_campaign: "spring-sale" })
    seedContact({ first_touch_session_id: "sess-a", created_at: new Date(Date.now() - 30 * DAY_MS).toISOString() })
    seedContact({ first_touch_session_id: "sess-a" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(campaignOf(rows, "spring-sale")?.leadCount).toBe(1)
  })

  it("counts a contact with no first touch as unattributed rather than dropping it", async () => {
    seedContact({ first_touch_session_id: null })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(findUnattributed(rows)?.leadCount).toBe(1)
  })

  it("counts REGISTRATIONS from opportunities of ANY outcome, by when they were CREATED", async () => {
    seedAttribution("sess-a", { utm_campaign: "spring-sale" })
    const created = new Date().toISOString()
    seedOpenOpportunity({ source_session_id: "sess-a", created_at: created })
    seedLostOpportunity({ source_session_id: "sess-a", created_at: created })
    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 1_000, created_at: created })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    // Three people asked; one of them bought. The won deal is a registration
    // too — it did not stop being an enquiry by succeeding.
    expect(campaignOf(rows, "spring-sale")?.registrationCount).toBe(3)
    expect(campaignOf(rows, "spring-sale")?.wonCount).toBe(1)
  })

  it("keeps the two windows apart — created counts registrations, closed counts revenue", async () => {
    // A deal that ARRIVED before the window and CLOSED inside it is this
    // window's revenue and last window's registration. Collapsing the two
    // would make a good month look like a bad one.
    seedAttribution("sess-a", { utm_campaign: "spring-sale" })
    seedWonOpportunity({
      source_session_id: "sess-a",
      value_cents: 4_000,
      created_at: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      closed_at: new Date().toISOString(),
    })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(campaignOf(rows, "spring-sale")?.wonCount).toBe(1)
    expect(campaignOf(rows, "spring-sale")?.wonValueCents).toBe(4_000)
    expect(campaignOf(rows, "spring-sale")?.registrationCount).toBe(0)
  })

  it("counts a paid camp ticket ONCE — as its opportunity, never twice", async () => {
    // THE FIRST CUT OF THIS FILE DOUBLE-COUNTED THESE. The ledger row said
    // registrations were opportunities "plus paid event_signups", but a
    // completed `event_signup` checkout already mints a pipeline card —
    // `NO_PIPELINE_CARD_CHECKOUT_TYPES` is `{shop_order, save_card}` and the
    // webhook's own comment says so outright. Worse than the double count: the
    // two halves attributed through DIFFERENT KEYS (`source_session_id` vs
    // `gclid`), so one ticket could be counted into two different campaigns.
    seedAttribution("sess-a", { utm_campaign: "spring-sale", gclid: "CLICK-1" })
    const created = new Date().toISOString()
    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 9_900, created_at: created })
    // The signup row that opportunity came from. Present in the store, so a
    // reader that went looking for it would find it and count it again.
    seedSignup({ gclid: "CLICK-1", amount_paid_cents: 9_900 })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(campaignOf(rows, "spring-sale")?.registrationCount).toBe(1)
    expect(campaignOf(rows, "spring-sale")?.wonCount).toBe(1)
    // And nothing leaked into the bucket through the second key either.
    expect(findUnattributed(rows)?.registrationCount).toBe(0)
  })

  it("does not read event_signups at all — a signup with no opportunity changes no number", async () => {
    // The control for the test above. If this ever counts 1, the separate read
    // is back and so is the double count.
    seedAttribution("sess-a", { utm_campaign: "spring-sale", gclid: "CLICK-1" })
    seedSignup({ gclid: "CLICK-1", amount_paid_cents: 9_900 })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(rows).toEqual([])
  })

  it("PAGES past PostgREST's 1000-row cap rather than being silently truncated", async () => {
    // The cap truncates, it does not error. A truncated attribution read is the
    // nastier half of this: dropped rows do not vanish from the report, they
    // re-classify a campaign's leads as Unattributed.
    seedAttribution("sess-a", { utm_campaign: "spring-sale" })
    for (let i = 0; i < 1500; i += 1) seedContact({ first_touch_session_id: "sess-a" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(campaignOf(rows, "spring-sale")?.leadCount).toBe(1500)
  })

  it("CHUNKS the attribution lookup, so the id list never outgrows the query string", async () => {
    // 250 distinct sessions is more than one chunk. Every one of them must
    // still be found — a chunking bug shows up as leads sliding into the
    // unattributed bucket, not as an error.
    for (let i = 0; i < 250; i += 1) {
      seedAttribution(`sess-${i}`, { utm_campaign: "spring-sale" })
      seedContact({ first_touch_session_id: `sess-${i}` })
    }

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(campaignOf(rows, "spring-sale")?.leadCount).toBe(250)
    expect(findUnattributed(rows)?.leadCount).toBe(0)
  })

  it("gives an ORGANIC FUNNEL landing its own row, keyed by slug, not the unattributed bucket", async () => {
    // 37 sessions in production landed on one funnel with no utm and no click
    // id — more than every paid campaign put together, and invisible while
    // they sat inside "Unattributed".
    seedAttribution("sess-a", {
      utm_source: null,
      utm_campaign: null,
      gclid: null,
      landing_url: "https://example.test/go/athlete-quiz",
    })
    seedContact({ first_touch_session_id: "sess-a" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    const funnel = rows.find((r) => r.landingSlug === "athlete-quiz")
    expect(funnel?.leadCount).toBe(1)
    expect(funnel?.isUnattributed).toBe(false)
    expect(findUnattributed(rows)?.leadCount).toBe(0)
  })

  it("counts a funnel's STEPS as one funnel, not as several campaigns", async () => {
    seedAttribution("sess-a", {
      utm_source: null,
      utm_campaign: null,
      gclid: null,
      landing_url: "https://example.test/go/athlete-quiz",
    })
    seedAttribution("sess-b", {
      utm_source: null,
      utm_campaign: null,
      gclid: null,
      landing_url: "https://example.test/go/athlete-quiz/start?ref=x",
    })
    seedContact({ first_touch_session_id: "sess-a" })
    seedContact({ first_touch_session_id: "sess-b" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(rows.filter((r) => r.landingSlug === "athlete-quiz")).toHaveLength(1)
    expect(rows.find((r) => r.landingSlug === "athlete-quiz")?.leadCount).toBe(2)
  })

  it("does NOT give every organic landing its own row — only funnels", async () => {
    // The presence control for the two tests above, and the reason the line is
    // drawn at `/go/`: turning each marketing page into a row would empty the
    // unattributed bucket of its meaning.
    seedAttribution("sess-a", {
      utm_source: null,
      utm_campaign: null,
      gclid: null,
      landing_url: "https://example.test/in-person",
    })
    seedContact({ first_touch_session_id: "sess-a" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(rows.every((r) => r.landingSlug === null)).toBe(true)
    expect(findUnattributed(rows)?.leadCount).toBe(1)
  })

  it("prefers the utm campaign over the funnel slug, so one campaign is never described twice", async () => {
    seedAttribution("sess-a", {
      utm_campaign: "spring-sale",
      landing_url: "https://example.test/go/athlete-quiz",
    })
    seedContact({ first_touch_session_id: "sess-a" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(campaignOf(rows, "spring-sale")?.leadCount).toBe(1)
    expect(campaignOf(rows, "spring-sale")?.landingSlug).toBeNull()
    expect(rows.some((r) => r.landingSlug === "athlete-quiz")).toBe(false)
  })

  it("reports a window with leads but NO won deal, instead of an empty list", async () => {
    // Before G15 an empty return meant "nothing WON", which hid a window full
    // of leads behind "No won deals yet".
    seedAttribution("sess-a", { utm_campaign: "spring-sale" })
    seedContact({ first_touch_session_id: "sess-a" })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(rows.length).toBeGreaterThan(0)
    expect(campaignOf(rows, "spring-sale")?.leadCount).toBe(1)
    expect(campaignOf(rows, "spring-sale")?.wonCount).toBe(0)
  })

  it("still returns an empty list when the window held nothing at all", async () => {
    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })

    expect(rows).toEqual([])
  })

  it("the ledger's worked example: one campaign with 14 leads, 6 registrations and $2,340", async () => {
    seedAttribution("sess-a", { utm_source: "google", utm_campaign: "spring-sale" })
    for (let i = 0; i < 14; i += 1) seedContact({ first_touch_session_id: "sess-a" })
    const created = new Date().toISOString()
    for (let i = 0; i < 5; i += 1) seedOpenOpportunity({ source_session_id: "sess-a", created_at: created })
    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 234_000, created_at: created })

    const rows = await readCampaignRevenue({ since, until, businessId: SINGLETON_BUSINESS_ID })
    const row = campaignOf(rows, "spring-sale")

    expect(row?.leadCount).toBe(14)
    expect(row?.registrationCount).toBe(6)
    expect(row?.wonCount).toBe(1)
    expect(row?.wonValueCents).toBe(234_000)
  })
})

describe("funnelSlugFromLandingUrl", () => {
  it("reads the slug out of a funnel landing", () => {
    expect(funnelSlugFromLandingUrl("https://example.test/go/athlete-quiz")).toBe("athlete-quiz")
    expect(funnelSlugFromLandingUrl("https://example.test/go/athlete-quiz/start")).toBe("athlete-quiz")
    expect(funnelSlugFromLandingUrl("https://example.test/go/athlete-quiz?utm=x")).toBe("athlete-quiz")
  })

  it("answers null for anything that is not a funnel landing", () => {
    expect(funnelSlugFromLandingUrl("https://example.test/")).toBeNull()
    expect(funnelSlugFromLandingUrl("https://example.test/in-person")).toBeNull()
    expect(funnelSlugFromLandingUrl("https://example.test/gonzo")).toBeNull()
    expect(funnelSlugFromLandingUrl("https://example.test/go/")).toBeNull()
    expect(funnelSlugFromLandingUrl(null)).toBeNull()
    expect(funnelSlugFromLandingUrl("")).toBeNull()
  })

  it("does not throw on a url that will not parse — this is a reporting path", () => {
    expect(funnelSlugFromLandingUrl("not a url at all")).toBeNull()
    expect(funnelSlugFromLandingUrl("/go/athlete-quiz")).toBe("athlete-quiz")
  })

  it("does not throw on a slug that is not valid percent-encoding", () => {
    // `decodeURIComponent("100%off")` raises a URIError. `landing_url` is
    // written from the browser and reachable by anybody who can request a `/go`
    // page, so without this one junk row would 500 the whole report — the exact
    // opposite of the tolerance this function's doc comment promises.
    expect(funnelSlugFromLandingUrl("https://example.test/go/100%off")).toBe("100%off")
    expect(funnelSlugFromLandingUrl("https://example.test/go/%E0%A4%A")).toBe("%E0%A4%A")
    // The presence control: valid encoding is still decoded.
    expect(funnelSlugFromLandingUrl("https://example.test/go/spring%20sale")).toBe("spring sale")
  })
})

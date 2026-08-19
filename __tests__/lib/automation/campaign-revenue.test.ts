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
}

const store: Store = {
  opportunities: [],
  marketing_attribution: [],
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

      const passesFilters = (row: Row) =>
        filters.every(([col, val]) => row[col] === val) &&
        gteFilters.every(([col, val]) => row[col] >= val) &&
        ltFilters.every(([col, val]) => row[col] < val) &&
        inFilters.every(([col, vals]) => vals.includes(row[col]))

      const matched = (): Row[] => rows.filter(passesFilters)

      const execute = (): { data: any; error: any } => ({ data: matched(), error: null })

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

import { readCampaignRevenue } from "@/lib/automation/campaign-revenue"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

const DAY_MS = 86_400_000

beforeEach(() => {
  store.opportunities = []
  store.marketing_attribution = []
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
    seedAttribution("sess-a", { utm_source: "google", utm_medium: "cpc", utm_campaign: "spring-sale" })
    seedAttribution("sess-b", { utm_source: "google", utm_medium: "cpc", utm_campaign: "spring-sale" })
    seedAttribution("sess-c", { utm_source: "facebook", utm_medium: "social", utm_campaign: "summer-push" })

    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 5_000 })
    seedWonOpportunity({ source_session_id: "sess-b", value_cents: 7_500 })
    seedWonOpportunity({ source_session_id: "sess-c", value_cents: 2_000 })

    const rows = await readCampaignRevenue({ since, until })

    const spring = rows.find((r) => r.utmCampaign === "spring-sale")
    const summer = rows.find((r) => r.utmCampaign === "summer-push")

    expect(spring).toBeDefined()
    expect(spring?.wonCount).toBe(2)
    expect(spring?.wonValueCents).toBe(12_500)
    expect(spring?.utmSource).toBe("google")
    expect(spring?.utmMedium).toBe("cpc")
    expect(spring?.isUnattributed).toBe(false)

    expect(summer).toBeDefined()
    expect(summer?.wonCount).toBe(1)
    expect(summer?.wonValueCents).toBe(2_000)
    expect(summer?.isUnattributed).toBe(false)
  })

  it("reads value from opportunities, not from payments", async () => {
    seedAttribution("sess-a")
    seedWonOpportunity({ source_session_id: "sess-a", value_cents: 42_000 })

    const rows = await readCampaignRevenue({ since, until })

    expect(sum(rows)).toBe(42_000)
  })

  it("counts a won deal with no session id as unattributed rather than dropping it", async () => {
    seedWonOpportunity({ source_session_id: null, value_cents: 9_900 })

    const rows = await readCampaignRevenue({ since, until })

    const unattributed = findUnattributed(rows)
    expect(unattributed).toBeDefined()
    expect(unattributed?.isUnattributed).toBe(true)
    expect(unattributed?.unattributedCount).toBe(1)
    expect(unattributed?.wonValueCents).toBe(9_900)
    expect(unattributed?.utmSource).toBeNull()
    expect(unattributed?.utmMedium).toBeNull()
    expect(unattributed?.utmCampaign).toBeNull()
  })

  it("counts a session id with no attribution row as unattributed", async () => {
    // "sess-orphan" never gets a marketing_attribution row.
    seedWonOpportunity({ source_session_id: "sess-orphan", value_cents: 15_000 })

    const rows = await readCampaignRevenue({ since, until })

    const unattributed = findUnattributed(rows)
    expect(unattributed).toBeDefined()
    expect(unattributed?.unattributedCount).toBe(1)
    expect(unattributed?.wonValueCents).toBe(15_000)
  })

  it("both unattributed failure modes accumulate into the same bucket", async () => {
    seedWonOpportunity({ source_session_id: null, value_cents: 1_000 })
    seedWonOpportunity({ source_session_id: "sess-orphan", value_cents: 2_000 })

    const rows = await readCampaignRevenue({ since, until })

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

    const rows = await readCampaignRevenue({ since, until })

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

    const rows = await readCampaignRevenue({ since, until })

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

    const rows = await readCampaignRevenue({ since, until })

    expect(sum(rows)).toBe(3_000)
  })

  it("returns an empty list, not an error, when nothing is won yet", async () => {
    seedOpenOpportunity({ source_session_id: "sess-a" })

    const rows = await readCampaignRevenue({ since, until })

    expect(rows).toEqual([])
  })
})

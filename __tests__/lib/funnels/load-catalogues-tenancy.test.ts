// Task 8 (funnel tenancy): `loadCatalogues()` unfrozen.
//
// THE BUG THIS CLOSES, quoted from lib/tenancy/platform.ts before this task:
// the AI funnel builder and the publish gate validated an event CTA against a
// PLATFORM-ONLY catalogue while the live page resolved a real per-host
// tenant. Pre-phase both sides were unscoped and agreed; the day a second
// tenant published a funnel with an event CTA, the builder and the gate
// passed and the live render was silent absence.
//
// This file is a NARROW, TENANCY-ONLY suite -- it does not re-litigate the
// recognition/offer split or the truncation guard, both already pinned by
// __tests__/lib/funnels/sections/resolve.test.ts's `loadCatalogues` block.
// It exists to prove exactly one thing that block does not: the businessId
// PASSED IN is the businessId the event and quiz reads are SCOPED BY, with a
// permissive control (tenant B legitimately sees B's own rows, not an empty
// list) so a predicate that rejects everyone could not pass this by accident.
//
// MOCKS: same `vi.doMock` + scoped dynamic import pattern as resolve.test.ts's
// `loadCatalogues` block, for the same reason -- `loadCatalogues` is a thin
// DAL wrapper with no pure part to test without substituting the DAL. Programs,
// session packs and FAQs are stubbed as fixed, tenant-blind fixtures: Task 8's
// own investigation found none of `programs`, `session_pack_products` or
// `faqs` carries a `business_id` column, so there is no per-tenant predicate
// to prove there for those three reads.
import { describe, it, expect, vi, afterEach } from "vitest"

const BUSINESS_A = "aaaaaaaa-0000-4000-8000-000000000001"
const BUSINESS_B = "bbbbbbbb-0000-4000-8000-000000000002"

interface EventRow {
  id: string
  title: string
}

/** Per-tenant fixtures. Deliberately DISJOINT ids so a leak is visible as "the wrong tenant's id showed up", not just "a count changed". */
const EVENTS_BY_BUSINESS: Record<string, EventRow[]> = {
  [BUSINESS_A]: [{ id: "event-a", title: "Tenant A's Camp" }],
  [BUSINESS_B]: [{ id: "event-b", title: "Tenant B's Clinic" }],
}

const QUIZZES_BY_BUSINESS: Record<string, { id: string; status: string }[]> = {
  [BUSINESS_A]: [{ id: "quiz-a", status: "draft" }],
  [BUSINESS_B]: [{ id: "quiz-b", status: "draft" }],
}

async function stubTenantedDal(
  quizzesByBusiness: Record<string, { id: string; status: string }[]> = QUIZZES_BY_BUSINESS,
) {
  const getEventsCalls: string[] = []
  const getPublishedEventsCalls: string[] = []
  const listQuizzesCalls: string[] = []
  const getQuizDefinitionCalls: unknown[][] = []

  vi.resetModules()
  vi.doMock("@/lib/db/programs", () => ({
    getPrograms: async () => [],
    getAllPrograms: async () => [],
  }))
  vi.doMock("@/lib/db/session-pack-products", () => ({
    listActiveProducts: async () => [],
    listAllProducts: async () => [],
  }))
  // Both fetchers filter by the businessId ARGUMENT, exactly like the real
  // lib/db/events.ts does with `.eq("business_id", businessId)` -- a fake DB,
  // not an argument-blind mock, so a caller that passed the wrong tenant (or
  // none) gets the WRONG tenant's rows back, not a coincidentally-empty list.
  vi.doMock("@/lib/db/events", () => ({
    getEvents: async (businessId: string) => {
      getEventsCalls.push(businessId)
      return EVENTS_BY_BUSINESS[businessId] ?? []
    },
    getPublishedEvents: async (businessId: string) => {
      getPublishedEventsCalls.push(businessId)
      return EVENTS_BY_BUSINESS[businessId] ?? []
    },
  }))
  vi.doMock("@/lib/db/faqs", () => ({
    getFaqCountsByPage: async () => ({}),
  }))
  vi.doMock("@/lib/db/quizzes", () => ({
    listQuizzes: async (businessId: string) => {
      listQuizzesCalls.push(businessId)
      return quizzesByBusiness[businessId] ?? []
    },
    // The default fixtures are all `status: "draft"`, so `loadCatalogues`
    // never calls this for them. It only assembles a definition for an ACTIVE
    // quiz. The G35 test below passes an active one. Every call is recorded
    // WHOLE, so the tenant argument is visible as a call shape.
    getQuizDefinition: async (...args: unknown[]) => {
      getQuizDefinitionCalls.push(args)
      return null
    },
  }))

  const { loadCatalogues } = await import("@/lib/funnels/sections/resolve")
  return { loadCatalogues, getEventsCalls, getPublishedEventsCalls, listQuizzesCalls, getQuizDefinitionCalls }
}

describe("loadCatalogues tenancy", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/db/programs")
    vi.doUnmock("@/lib/db/session-pack-products")
    vi.doUnmock("@/lib/db/events")
    vi.doUnmock("@/lib/db/faqs")
    vi.doUnmock("@/lib/db/quizzes")
    vi.resetModules()
  })

  it("offers only the asking tenant's events to the builder", async () => {
    const { loadCatalogues } = await stubTenantedDal()

    const cat = await loadCatalogues(BUSINESS_B)

    // THE PREDICATE'S VALUE, not merely that a call happened: tenant B's own
    // event id, and nothing from tenant A's fixture (which this file never
    // makes RED by returning A's rows for B -- see the mutation note below).
    expect(cat.recognition.event.map((e) => e.id)).toEqual(["event-b"])
    expect(cat.offer.event.map((e) => e.id)).toEqual(["event-b"])
  })

  // THE PERMISSIVE CONTROL. A predicate that rejected every tenant (e.g. a
  // dropped `.eq("business_id", ...)` that happened to filter on a column no
  // row matches) would make the test above pass by returning `[]` for a
  // businessId nobody's mock recognises. Proving tenant B sees B's OWN rows --
  // not zero rows -- is what rules that out.
  it("is not merely rejecting every tenant -- tenant B sees a real, non-empty catalogue of its own", async () => {
    const { loadCatalogues } = await stubTenantedDal()

    const cat = await loadCatalogues(BUSINESS_B)

    expect(cat.recognition.event).not.toEqual([])
    expect(cat.recognition.event.map((e) => e.id)).toContain("event-b")
  })

  it("switches catalogues when the asking tenant switches -- tenant A gets A's event, not B's", async () => {
    const { loadCatalogues } = await stubTenantedDal()

    const catA = await loadCatalogues(BUSINESS_A)
    const catB = await loadCatalogues(BUSINESS_B)

    expect(catA.recognition.event.map((e) => e.id)).toEqual(["event-a"])
    expect(catB.recognition.event.map((e) => e.id)).toEqual(["event-b"])
  })

  it("threads the same businessId into getEvents, getPublishedEvents AND listQuizzes -- the seam the comment says they share", async () => {
    const { loadCatalogues, getEventsCalls, getPublishedEventsCalls, listQuizzesCalls } = await stubTenantedDal()

    await loadCatalogues(BUSINESS_A)

    expect(getEventsCalls).toEqual([BUSINESS_A])
    expect(getPublishedEventsCalls).toEqual([BUSINESS_A])
    expect(listQuizzesCalls).toEqual([BUSINESS_A])
  })

  it("assembles an ACTIVE quiz's definition under the asking tenant, not by id alone (G35)", async () => {
    // MUTANT: `getQuizDefinition(row.id)`, the id-only read this seam had
    // before G35.
    const { loadCatalogues, getQuizDefinitionCalls } = await stubTenantedDal({
      [BUSINESS_A]: [{ id: "quiz-a", status: "active" }],
    })

    await loadCatalogues(BUSINESS_A)

    expect(getQuizDefinitionCalls).toEqual([[BUSINESS_A, "quiz-a"]])
  })
})

// ---------------------------------------------------------------------------
// MUTATION RECORD (per Task 8's brief -- not executable, a paper trail).
//
// ACTUALLY RUN during development, not just reasoned about: temporarily
// reverted `loadCatalogues`'s event and quiz reads to
// `getEvents(platformBusinessId(), {})`, `getPublishedEvents(platformBusinessId())`
// and `listQuizzes(platformBusinessId())` (re-adding the import). Result: all
// FOUR tests in this file went RED --
// `EVENTS_BY_BUSINESS[platformBusinessId()]` and
// `QUIZZES_BY_BUSINESS[platformBusinessId()]` are both `undefined` (the
// platform constant is `00000000-0000-0000-0000-000000000001`, neither
// `BUSINESS_A` nor `BUSINESS_B`), the fake DB fell back to `[]`, and the
// "threads the same businessId" test caught the literal platform uuid arriving
// instead of `BUSINESS_A`. Reverting the mutation restored all four to GREEN.
// ---------------------------------------------------------------------------

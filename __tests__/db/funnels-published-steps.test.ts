// @vitest-environment node
//
// __tests__/db/funnels-published-steps.test.ts
//
// `listPublishedFunnelSteps` decides which pages Google is invited to index.
// Getting it wrong in either direction is expensive: too loose and the sitemap
// advertises draft funnels that 404, too tight and the feature does nothing.
//
// These assert the PREDICATE — which filters were applied, with which VALUES —
// not that a row came back. A mock that returns a row proves nothing about
// which rows the database would have matched, and a test that only counts the
// filters passes just as happily with `.eq("noindex", true)`.

import { beforeEach, describe, expect, it, vi } from "vitest"

interface Applied {
  eqs: Array<[string, unknown]>
  nots: Array<[string, string, unknown]>
  ins: Array<[string, unknown[]]>
  tables: string[]
}

let applied: Applied
let funnelRows: unknown[]
let stepRows: unknown[]
let funnelError: { message: string } | null
let stepError: { message: string } | null

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      applied.tables.push(table)
      const isFunnels = table === "funnels"
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          applied.eqs.push([col, val])
          return chain
        },
        not: (col: string, op: string, val: unknown) => {
          applied.nots.push([col, op, val])
          return chain
        },
        in: (col: string, vals: unknown[]) => {
          applied.ins.push([col, vals])
          return chain
        },
        then: (resolve: (value: { data: unknown; error: unknown }) => void) =>
          resolve(isFunnels ? { data: funnelRows, error: funnelError } : { data: stepRows, error: stepError }),
      })
      return chain
    },
  }),
}))

import { listPublishedFunnelSteps } from "@/lib/db/funnels"

const FUNNEL = { id: "f1", name: "Athlete Performance Insight", slug: "athlete-quiz" }
const STEP = {
  funnel_id: "f1",
  name: "Start",
  slug: "start",
  is_entry: true,
  seo_title: "Find Your Power Gap",
  seo_description: "A description.",
  og_image_url: null,
  noindex: false,
  updated_at: "2026-09-19T00:00:00.000Z",
  published_version_id: "v1",
}

describe("listPublishedFunnelSteps", () => {
  beforeEach(() => {
    applied = { eqs: [], nots: [], ins: [], tables: [] }
    funnelRows = [FUNNEL]
    stepRows = [STEP]
    funnelError = null
    stepError = null
  })

  it("asks only for published funnels", async () => {
    await listPublishedFunnelSteps()
    // MUTANT KILLED: `.eq("status", "draft")` and dropping the filter
    // entirely. Pins the VALUE — a test that only counted one `.eq()` would
    // pass for either.
    expect(applied.eqs).toContainEqual(["status", "published"])
  })

  it("asks only for steps that are not noindexed", async () => {
    await listPublishedFunnelSteps()
    // MUTANT KILLED: `.eq("noindex", true)`, which would put ONLY the hidden
    // pages in the sitemap — the precise inversion that reads as working
    // because rows still come back.
    expect(applied.eqs).toContainEqual(["noindex", false])
  })

  it("asks only for steps that have a live version", async () => {
    await listPublishedFunnelSteps()
    // A step with no version row 404s even inside a published funnel.
    expect(applied.nots).toContainEqual(["published_version_id", "is", null])
  })

  it("scopes the step read to the published funnels it just found", async () => {
    funnelRows = [FUNNEL, { id: "f2", name: "Second", slug: "second" }]
    await listPublishedFunnelSteps()
    // MUTANT KILLED: dropping the `.in()`, which would read every step in the
    // account and join only the ones whose funnel happened to be published —
    // correct output, but an unbounded read that grows with the drafts.
    expect(applied.ins).toContainEqual(["funnel_id", ["f1", "f2"]])
  })

  it("returns the funnel and step fields the sitemap and metadata need", async () => {
    const rows = await listPublishedFunnelSteps()
    expect(rows).toHaveLength(1)
    expect(rows[0].funnel.slug).toBe("athlete-quiz")
    expect(rows[0].step.is_entry).toBe(true)
    expect(rows[0].step.seo_title).toBe("Find Your Power Gap")
    expect(rows[0].updatedAt).toBe("2026-09-19T00:00:00.000Z")
  })

  it("skips the step read entirely when nothing is published", async () => {
    funnelRows = []
    const rows = await listPublishedFunnelSteps()
    expect(rows).toEqual([])
    // MUTANT KILLED: removing the early return. `.in("funnel_id", [])` is a
    // pointless round trip, and some builders treat an empty `in` as no
    // filter at all — which would return every step in the database.
    expect(applied.tables).toEqual(["funnels"])
  })

  it("throws with the column name when the step read errors", async () => {
    // A PostgREST error comes back as `{ data: null, error }`, which reads
    // exactly like "no rows matched" if the error is not checked. This repo
    // has already shipped a confident, wrong refusal built on that.
    stepError = { message: 'column "noindex" does not exist' }
    stepRows = null as unknown as unknown[]
    await expect(listPublishedFunnelSteps()).rejects.toThrow(/noindex/)
  })

  it("throws rather than returning [] when the funnel read errors", async () => {
    funnelError = { message: "connection refused" }
    funnelRows = null as unknown as unknown[]
    // MUTANT KILLED: swallowing the error into `return []`. The sitemap's own
    // try/catch is what degrades; a DAL that reports "nothing is published"
    // when it could not read would silently empty the funnel section and look
    // like a correct answer.
    await expect(listPublishedFunnelSteps()).rejects.toThrow(/connection refused/)
  })
})

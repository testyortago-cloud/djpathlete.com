// Pins /go's two-condition serve rule (audit §3.6) — the load-bearing
// invariant of the whole funnel-serving subsystem had no test before this.
// Both conditions are asserted by which table got QUERIED, not just by the
// return value: a mutant that drops the status gate or the includeUnpublished
// check can still return null by coincidence (e.g. no rows exist), so the
// real signal is whether the DAL went on to touch the next table at all.
//
// Also pins the `.ilike()` escaping fix: PostgREST treats `%` and `_` as LIKE
// wildcards, so an unescaped slug turns a URL segment into a pattern —
// `/go/%25` decodes to a literal "%", matches every funnel, and
// `.maybeSingle()` throws (500) the moment more than one row comes back.

import { describe, it, expect, vi, beforeEach } from "vitest"

const BUSINESS_ID = "55555555-5555-4555-8555-555555555555"

const from = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

/** A thenable query builder: chainable, and awaits to `{ data, error }`. */
function queryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = (fn: ReturnType<typeof vi.fn>) => fn.mockImplementation(() => builder as never)
  builder.select = chain(vi.fn())
  builder.eq = chain(vi.fn())
  builder.ilike = chain(vi.fn())
  builder.order = chain(vi.fn())
  builder.limit = chain(vi.fn())
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return builder
}

/**
 * Wires `from` to hand out a SEPARATE builder per table, so a test can assert
 * both "which table got queried" and "what did THAT table's `.eq()` receive"
 * without one table's calls being confused for another's.
 */
function mockTables(overrides: {
  funnel?: { data: unknown; error: unknown }
  steps?: { data: unknown; error: unknown }
  versions?: { data: unknown; error: unknown }
}) {
  const funnels = queryBuilder(overrides.funnel ?? { data: null, error: null })
  const steps = queryBuilder(overrides.steps ?? { data: null, error: null })
  const versions = queryBuilder(overrides.versions ?? { data: null, error: null })
  from.mockImplementation((table: string) => {
    if (table === "funnels") return funnels
    if (table === "funnel_steps") return steps
    if (table === "funnel_step_versions") return versions
    throw new Error(`funnel-serve-rule test: unmocked table ${table}`)
  })
  return { funnels, steps, versions }
}

describe("getPublishedStep", () => {
  it("returns null and never queries funnel_steps when the funnel is a draft", async () => {
    // MUTANT: dropping `funnel.status !== "published"` from the gate. Without
    // it, a direct request (or a stale /go link) would serve whatever step a
    // draft funnel happens to have instead of 404ing — the exact hole §3.6
    // flags for this read path.
    mockTables({ funnel: { data: { id: "f1", slug: "camp", status: "draft" }, error: null } })
    const { getPublishedStep } = await import("@/lib/db/funnels")

    const result = await getPublishedStep(BUSINESS_ID, "camp")

    expect(result).toBeNull()
    expect(from).not.toHaveBeenCalledWith("funnel_steps")
  })

  it("returns null and never queries funnel_step_versions when the step has no published_version_id", async () => {
    // MUTANT: falling back to the latest version whenever published_version_id
    // is null, without checking `includeUnpublished` first — that is the
    // preview path's OWN behaviour, and leaking it onto /go would serve a page
    // that was never published. A version row exists in the fixture below, so
    // a mutant that queries it anyway would return it instead of null.
    const { versions } = mockTables({
      funnel: { data: { id: "f1", slug: "camp", status: "published" }, error: null },
      steps: {
        data: { id: "s1", funnel_id: "f1", slug: "index", published_version_id: null },
        error: null,
      },
      versions: { data: [{ id: "should-not-serve", nodes: [], css: "" }], error: null },
    })
    const { getPublishedStep } = await import("@/lib/db/funnels")

    const result = await getPublishedStep(BUSINESS_ID, "camp")

    expect(result).toBeNull()
    expect(versions.eq).not.toHaveBeenCalled()
  })

  it("returns the published version's nodes and css, queried by its own id", async () => {
    const { versions } = mockTables({
      funnel: { data: { id: "f1", slug: "camp", status: "published" }, error: null },
      steps: {
        data: { id: "s1", funnel_id: "f1", slug: "index", published_version_id: "v1" },
        error: null,
      },
      versions: { data: [{ id: "v1", nodes: [{ t: "el" }], css: "body{color:red}" }], error: null },
    })
    const { getPublishedStep } = await import("@/lib/db/funnels")

    const result = await getPublishedStep(BUSINESS_ID, "camp")

    expect(result).toMatchObject({ nodes: [{ t: "el" }], css: "body{color:red}" })
    expect(versions.eq).toHaveBeenCalledWith("id", "v1")
  })

  it("falls back to the latest version by step_id when includeUnpublished is true, even on a draft funnel", async () => {
    // Regression control for the preview path (/preview, /funnel-preview):
    // this is the ONE case where a draft funnel must still resolve a step —
    // that is the entire point of previewing a draft.
    const { versions } = mockTables({
      funnel: { data: { id: "f1", slug: "camp", status: "draft" }, error: null },
      steps: {
        data: { id: "s1", funnel_id: "f1", slug: "index", published_version_id: null },
        error: null,
      },
      versions: { data: [{ id: "v9", nodes: [], css: "" }], error: null },
    })
    const { getPublishedStep } = await import("@/lib/db/funnels")

    const result = await getPublishedStep(BUSINESS_ID, "camp", undefined, { includeUnpublished: true })

    expect(result).not.toBeNull()
    expect(versions.eq).toHaveBeenCalledWith("step_id", "s1")
    expect(versions.order).toHaveBeenCalledWith("version", { ascending: false })
    expect(versions.limit).toHaveBeenCalledWith(1)
  })
})

describe("getFunnelBySlug", () => {
  it("escapes a bare % before handing the slug to ilike", async () => {
    // MUTANT: no escaping. `/go/%25` decodes to a literal "%", which as an
    // UNESCAPED ilike pattern matches every row — and .maybeSingle() throws
    // (500) the moment more than one funnel exists.
    const { funnels } = mockTables({ funnel: { data: null, error: null } })
    const { getFunnelBySlug } = await import("@/lib/db/funnels")

    await getFunnelBySlug(BUSINESS_ID, "%")

    expect(funnels.ilike).toHaveBeenCalledWith("slug", "\\%")
  })

  it("escapes an underscore before handing the slug to ilike", async () => {
    const { funnels } = mockTables({ funnel: { data: null, error: null } })
    const { getFunnelBySlug } = await import("@/lib/db/funnels")

    await getFunnelBySlug(BUSINESS_ID, "a_b")

    expect(funnels.ilike).toHaveBeenCalledWith("slug", "a\\_b")
  })

  it("leaves a plain slug unchanged", async () => {
    // Stored slugs are validated as [a-z0-9-] on write, so this is the
    // overwhelmingly common case and must not gain spurious backslashes.
    const { funnels } = mockTables({ funnel: { data: null, error: null } })
    const { getFunnelBySlug } = await import("@/lib/db/funnels")

    await getFunnelBySlug(BUSINESS_ID, "plain-slug")

    expect(funnels.ilike).toHaveBeenCalledWith("slug", "plain-slug")
  })
})

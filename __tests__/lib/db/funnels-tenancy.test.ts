// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const A = "aaaaaaaa-0000-0000-0000-00000000000a"
const B = "bbbbbbbb-0000-0000-0000-00000000000b"

// Rows from two tenants. A reader that drops its predicate returns both.
const ROWS = [
  { id: "f1", slug: "free-guide", business_id: A, status: "published" },
  { id: "f2", slug: "free-guide", business_id: B, status: "published" },
]

let captured: { col: string; val: unknown }[] = []
function makeQuery(rows: Record<string, unknown>[]) {
  const q: Record<string, unknown> = {}
  let current = [...rows]
  const chain = (fn: () => void) => {
    fn()
    return q
  }
  q.select = () => q
  q.order = () => q
  q.limit = () => q
  q.ilike = (col: string, val: string) =>
    chain(() => {
      captured.push({ col, val })
      current = current.filter((r) => String(r[col]).toLowerCase() === val.toLowerCase())
    })
  q.eq = (col: string, val: unknown) =>
    chain(() => {
      captured.push({ col, val })
      current = current.filter((r) => r[col] === val)
    })
  // Needed by listPublishedFunnelSteps's `.in("funnel_id", [...])`.
  q.in = (col: string, vals: unknown[]) =>
    chain(() => {
      captured.push({ col, val: vals })
      current = current.filter((r) => vals.includes(r[col]))
    })
  // Needed by listPublishedFunnelSteps's `.not("published_version_id", "is", null)`.
  // Only the `is` operator is implemented — the only one this file ever calls.
  q.not = (col: string, op: string, val: unknown) =>
    chain(() => {
      captured.push({ col: `not.${col}.${op}`, val })
      if (op === "is" && val === null) {
        current = current.filter((r) => r[col] !== null && r[col] !== undefined)
      }
    })
  q.maybeSingle = async () => ({ data: current[0] ?? null, error: null })
  q.then = (res: (v: unknown) => void) => res({ data: current, error: null })
  return q
}

// Dedicated fake for the per-tenant slug-collision paths: createFunnel's
// insert (Step 4 / Review Focus #4) and updateFunnel's update (added fix
// round 1 — a RENAME hits the same funnels_business_id_slug_key index).
// Both probe `hasIntakeColumns` first — a plain `.select().limit()` on the
// same table — before ever reaching the write, so that probe has to resolve
// cleanly or the write is never attempted. It is answered "present" (no
// error) so the intake columns are included and the write itself is what
// fails, the same way it would against a real database with migration 00210
// already applied.
function makeSlugCollisionClient() {
  const collision = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "funnels_business_id_slug_key"',
  }
  // `.eq()` may be chained any number of times before `.select().single()` —
  // updateFunnel chains two (business_id, id) where createFunnel's insert
  // chains none, so this has to tolerate either.
  const updateChain: Record<string, unknown> = {
    eq: () => updateChain,
    select: () => ({ single: async () => ({ data: null, error: collision }) }),
  }
  return {
    from: (table: string) => {
      if (table !== "funnels") {
        throw new Error(`slug-collision fake only stubs "funnels", got "${table}"`)
      }
      const probe: Record<string, unknown> = {
        select: () => probe,
        limit: async () => ({ error: null }),
        insert: () => ({
          select: () => ({ single: async () => ({ data: null, error: collision }) }),
        }),
        update: () => updateChain,
      }
      return probe
    },
  }
}

// Per-table fixture for functions that read across the funnel -> step ->
// version chain (getPublishedStep, listPublishedFunnelSteps). One row per
// tenant at EACH table, and the two tenants' content genuinely differs (css,
// funnel name) so a cross-tenant mix-up is visible in the OUTPUT and not only
// in a captured call.
const STEP_FIXTURE: Record<string, Record<string, unknown>[]> = {
  funnels: [
    { id: "f1", slug: "free-guide", business_id: A, status: "published", name: "A Free Guide" },
    { id: "f2", slug: "free-guide", business_id: B, status: "published", name: "B Free Guide" },
  ],
  funnel_steps: [
    {
      id: "s1",
      funnel_id: "f1",
      business_id: A,
      is_entry: true,
      slug: "start",
      name: "A entry",
      published_version_id: "v1",
      seo_title: null,
      seo_description: null,
      og_image_url: null,
      noindex: false,
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "s2",
      funnel_id: "f2",
      business_id: B,
      is_entry: true,
      slug: "start",
      name: "B entry",
      published_version_id: "v2",
      seo_title: null,
      seo_description: null,
      og_image_url: null,
      noindex: false,
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  funnel_step_versions: [
    { id: "v1", business_id: A, nodes: [], css: "a{color:red}" },
    { id: "v2", business_id: B, nodes: [], css: "b{color:blue}" },
  ],
}
function makeTableAwareClient() {
  return { from: (table: string) => makeQuery(STEP_FIXTURE[table] ?? []) }
}

// Insert-capturing fake for createSubmission — a WRITE, so the thing to prove
// is what got STAMPED onto the row, not what got read back.
let capturedInserts: { table: string; payload: Record<string, unknown> }[] = []
function makeInsertCapturingClient() {
  return {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        capturedInserts.push({ table, payload })
        return {
          select: () => ({
            single: async () => ({ data: { id: "sub-1", ...payload }, error: null }),
          }),
        }
      },
    }),
  }
}

// Asymmetric, id-colliding fixture for updateFunnel's business_id predicate
// (fix wave item 3). Two tenants, one SHARED id across them — "shared-id"
// names a DIFFERENT row per tenant, the same way a coincidence (or a UUID
// collision, however unlikely) would if the predicate were the only thing
// telling the two apart. A dropped or mistyped `.eq("business_id", ...)`
// leaves only `.eq("id", "shared-id")` to filter on, which — since
// `Array.prototype.find` returns the FIRST match — resolves to tenant A's
// row regardless of which tenant asked, exactly the "coach B renames coach
// A's funnel by id" failure this test exists to catch.
function makeUpdateRows(): Record<string, unknown>[] {
  return [
    { id: "shared-id", slug: "a-one", name: "A One", business_id: A },
    { id: "a-two", slug: "a-two", name: "A Two", business_id: A },
    { id: "shared-id", slug: "b-one", name: "B One", business_id: B },
  ]
}
let updateRows: Record<string, unknown>[] = makeUpdateRows()

/**
 * A real `.update(patch).eq(...).eq(...).select("*").single()` chain: only a
 * row matching EVERY captured `.eq()` filter is mutated and returned. Unlike
 * `makeSlugCollisionClient` (which always fails), this actually applies the
 * patch, so it can tell a correctly-scoped update apart from one that landed
 * on the wrong tenant's row.
 */
function makeUpdateRowsClient() {
  return {
    from: (table: string) => {
      if (table !== "funnels") {
        throw new Error(`update-rows fake only stubs "funnels", got "${table}"`)
      }
      return {
        // hasIntakeColumns' probe (`.select(col).limit(n)`), answered
        // "present" so the write below runs exactly as it would once
        // migration 00210 has landed.
        select: () => ({ limit: async () => ({ error: null }) }),
        update: (patch: Record<string, unknown>) => {
          const filters: { col: string; val: unknown }[] = []
          const chain = {
            eq: (col: string, val: unknown) => {
              filters.push({ col, val })
              captured.push({ col, val })
              return chain
            },
            select: () => ({
              single: async () => {
                const match = updateRows.find((r) => filters.every((f) => r[f.col] === f.val))
                if (!match) return { data: null, error: { code: "PGRST116", message: "no rows matched the filter" } }
                Object.assign(match, patch)
                return { data: { ...match }, error: null }
              },
            }),
          }
          return chain
        },
      }
    },
  }
}

type MockMode = "rows" | "slugCollision" | "tableAware" | "insertCapture" | "updateRows"
let mode: MockMode = "rows"

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => {
    if (mode === "slugCollision") return makeSlugCollisionClient()
    if (mode === "tableAware") return makeTableAwareClient()
    if (mode === "insertCapture") return makeInsertCapturingClient()
    if (mode === "updateRows") return makeUpdateRowsClient()
    return { from: () => makeQuery(ROWS) }
  },
}))

import {
  getFunnelBySlug,
  listFunnels,
  createFunnel,
  updateFunnel,
  getPublishedStep,
  listPublishedFunnelSteps,
  createSubmission,
} from "@/lib/db/funnels"
import { SlugTakenError } from "@/lib/db/businesses"
import { __resetIntakeColumnCache } from "@/lib/db/funnel-schema-support"

beforeEach(() => {
  captured = []
  capturedInserts = []
  mode = "rows"
  updateRows = makeUpdateRows()
  __resetIntakeColumnCache()
})

describe("funnels DAL is tenant-scoped", () => {
  it("getFunnelBySlug returns tenant A's row for a slug both tenants own", async () => {
    const f = await getFunnelBySlug(A, "free-guide")
    expect(f?.id).toBe("f1")
  })

  it("getFunnelBySlug returns tenant B's row for the same slug", async () => {
    // THE PERMISSIVE CONTROL. Without it, a predicate hard-coded to A passes
    // the test above and every absence assertion below.
    const f = await getFunnelBySlug(B, "free-guide")
    expect(f?.id).toBe("f2")
  })

  it("filters on business_id with the VALUE it was given, not merely some value", async () => {
    // MUTANT: `.eq("business_id", A)` hard-coded, or `.eq("id", businessId)`.
    // Asserting only that .eq was called would survive both.
    await getFunnelBySlug(B, "free-guide")
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })

  it("listFunnels returns only the named tenant's funnels", async () => {
    expect((await listFunnels(A)).map((f) => f.id)).toEqual(["f1"])
    expect((await listFunnels(B)).map((f) => f.id)).toEqual(["f2"])
  })
})

describe("createFunnel surfaces a per-tenant slug collision (Review Focus #4)", () => {
  it("throws SlugTakenError, not a bare 500, when the insert hits 23505", async () => {
    mode = "slugCollision"
    await expect(createFunnel(A, { slug: "free-guide", name: "Free Guide" })).rejects.toBeInstanceOf(SlugTakenError)
  })

  it("names the taken slug in the error", async () => {
    mode = "slugCollision"
    await expect(createFunnel(A, { slug: "free-guide", name: "Free Guide" })).rejects.toThrow(/free-guide/)
  })
})

describe("updateFunnel surfaces the same slug collision on a rename (fix round 1)", () => {
  it("throws SlugTakenError, not a bare 500, when the update hits 23505", async () => {
    mode = "slugCollision"
    await expect(updateFunnel(A, "f1", { slug: "free-guide" })).rejects.toBeInstanceOf(SlugTakenError)
  })
})

// `Funnel` (types/database.ts) does not expose `business_id` in its public
// shape — `updateFunnel`'s return type is `Funnel`, cast from the raw row —
// so the tests below read it off the row through this narrow escape hatch
// rather than widening the real type just for a test assertion.
function businessIdOf(funnel: { id: string }): unknown {
  return (funnel as unknown as { business_id: unknown }).business_id
}

describe("updateFunnel's business_id predicate is a real tenant guard (fix wave item 3)", () => {
  // Whole-branch review: this predicate is the SOLE tenant guard on
  // PATCH /api/admin/funnels/[id] for any body that is not
  // `status:"published"` — that route never calls getFunnelById first, it
  // goes straight to updateFunnel(businessId, id, ...). Drop or mistype the
  // `.eq("business_id", ...)` and coach B renames coach A's funnel by id.
  //
  // The fixture's two rows share the literal id "shared-id" across tenants —
  // see makeUpdateRows() above — so a value-correctness check has something
  // to fail against; a fixture with no id overlap would pass even with the
  // predicate silently dropped, because `.eq("id", id)` alone would still
  // happen to pick the right row.

  it("updates tenant A's row when called with A's businessId, not tenant B's same-id row", async () => {
    mode = "updateRows"
    const updated = await updateFunnel(A, "shared-id", { name: "A One Renamed" })
    expect(updated.name).toBe("A One Renamed")
    expect(businessIdOf(updated)).toBe(A)
  })

  it("PERMISSIVE CONTROL: updates tenant B's row with the SAME id when called with B's businessId", async () => {
    // Without this, a predicate hard-coded to A (or one that always resolves
    // to A's row first) would pass the test above and every test in this repo
    // that never calls updateFunnel as tenant B.
    mode = "updateRows"
    const updated = await updateFunnel(B, "shared-id", { name: "B One Renamed" })
    expect(updated.name).toBe("B One Renamed")
    expect(businessIdOf(updated)).toBe(B)
  })

  it("filters the update on the exact business_id VALUE it was given, not merely a present value", async () => {
    // MUTANT: `.eq("business_id", A)` hard-coded, or the predicate reordered
    // to `.eq("id", businessId).eq("business_id", id)` (swapped columns).
    // Asserting only that `.eq` was called some number of times would survive
    // both; this pins the actual value passed for the business_id column.
    mode = "updateRows"
    await updateFunnel(B, "shared-id", { name: "B One Renamed" })
    const businessIdCalls = captured.filter((c) => c.col === "business_id")
    expect(businessIdCalls.length).toBeGreaterThanOrEqual(1)
    for (const call of businessIdCalls) expect(call.val).toBe(B)
  })

  it("does not touch tenant A's row when renaming tenant B's row of the same id", async () => {
    // A second angle on the same guard: prove the OTHER tenant's row was left
    // alone, not just that the right one came back.
    mode = "updateRows"
    await updateFunnel(B, "shared-id", { name: "B One Renamed" })
    expect(updateRows.find((r) => r.business_id === A && r.id === "shared-id")?.name).toBe("A One")
  })
})

describe("getPublishedStep is tenant-scoped across all three tables it reads (fix round 1)", () => {
  it("returns tenant A's page for tenant A, tenant B's page for tenant B (permissive control)", async () => {
    mode = "tableAware"
    const forA = await getPublishedStep(A, "free-guide")
    const forB = await getPublishedStep(B, "free-guide")
    expect(forA?.css).toBe("a{color:red}")
    expect(forB?.css).toBe("b{color:blue}")
  })

  it("filters funnels, funnel_steps AND funnel_step_versions by the VALUE it was given", async () => {
    mode = "tableAware"
    await getPublishedStep(B, "free-guide")
    const businessIdCalls = captured.filter((c) => c.col === "business_id")
    // One call per table touched: funnels (via getFunnelBySlug), funnel_steps,
    // funnel_step_versions. A DROPPED predicate on funnel_steps or
    // funnel_step_versions still returns the right row here, because
    // funnel_id/published_version_id already disambiguate on this fixture —
    // that's exactly why the permissive-control test above is not enough on
    // its own, and why this asserts the call count and every value directly.
    expect(businessIdCalls.length).toBeGreaterThanOrEqual(3)
    for (const call of businessIdCalls) expect(call.val).toBe(B)
  })
})

describe("listPublishedFunnelSteps is tenant-scoped across both tables it reads (fix round 1)", () => {
  it("lists only the named tenant's published funnel steps (permissive control)", async () => {
    mode = "tableAware"
    const forA = await listPublishedFunnelSteps(A)
    const forB = await listPublishedFunnelSteps(B)
    expect(forA.map((r) => r.funnel.name)).toEqual(["A Free Guide"])
    expect(forB.map((r) => r.funnel.name)).toEqual(["B Free Guide"])
  })

  it("filters both funnels and funnel_steps by the VALUE it was given", async () => {
    mode = "tableAware"
    await listPublishedFunnelSteps(B)
    const businessIdCalls = captured.filter((c) => c.col === "business_id")
    expect(businessIdCalls.length).toBeGreaterThanOrEqual(2)
    for (const call of businessIdCalls) expect(call.val).toBe(B)
  })
})

describe("createSubmission stamps the tenant it was given, not merely a present column (fix round 1)", () => {
  const submissionInput = {
    funnel_id: "f-x",
    step_id: "s-x",
    form_key: "k",
    payload: {},
  }

  it("stamps business_id with the exact value passed", async () => {
    mode = "insertCapture"
    await createSubmission(B, submissionInput)
    expect(capturedInserts[0].payload.business_id).toBe(B)
  })

  it("stamps each tenant's own id — permissive control", async () => {
    mode = "insertCapture"
    await createSubmission(A, submissionInput)
    await createSubmission(B, submissionInput)
    expect(capturedInserts[0].payload.business_id).toBe(A)
    expect(capturedInserts[1].payload.business_id).toBe(B)
  })
})

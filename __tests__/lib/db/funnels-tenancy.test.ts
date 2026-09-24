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
  q.maybeSingle = async () => ({ data: current[0] ?? null, error: null })
  q.then = (res: (v: unknown) => void) => res({ data: current, error: null })
  return q
}

// Dedicated fake for createFunnel's per-tenant slug-collision path (Step 4 /
// Review Focus #4). `createFunnel` probes `hasIntakeColumns` first — a plain
// `.select().limit()` on the same table — before ever reaching the insert, so
// that probe has to resolve cleanly or the insert is never attempted. It is
// answered "present" (no error) so the intake columns are included and the
// insert itself is what fails, the same way it would against a real database
// with migration 00210 already applied.
let useSlugCollisionClient = false
function makeSlugCollisionClient() {
  return {
    from: (table: string) => {
      if (table !== "funnels") {
        throw new Error(`slug-collision fake only stubs "funnels", got "${table}"`)
      }
      const probe: Record<string, unknown> = {
        select: () => probe,
        limit: async () => ({ error: null }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: "23505",
                message: 'duplicate key value violates unique constraint "funnels_business_id_slug_key"',
              },
            }),
          }),
        }),
      }
      return probe
    },
  }
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => (useSlugCollisionClient ? makeSlugCollisionClient() : { from: () => makeQuery(ROWS) }),
}))

import { getFunnelBySlug, listFunnels, createFunnel } from "@/lib/db/funnels"
import { SlugTakenError } from "@/lib/db/businesses"
import { __resetIntakeColumnCache } from "@/lib/db/funnel-schema-support"

beforeEach(() => {
  captured = []
  useSlugCollisionClient = false
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
    useSlugCollisionClient = true
    await expect(createFunnel(A, { slug: "free-guide", name: "Free Guide" })).rejects.toBeInstanceOf(SlugTakenError)
  })

  it("names the taken slug in the error", async () => {
    useSlugCollisionClient = true
    await expect(createFunnel(A, { slug: "free-guide", name: "Free Guide" })).rejects.toThrow(/free-guide/)
  })
})

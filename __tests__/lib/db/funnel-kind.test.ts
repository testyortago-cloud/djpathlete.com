// The DAL half of the page/funnel split. Both tests here read the arguments
// actually handed to Supabase, because the cheap version of each — asserting
// the function resolved without throwing — passes against a DAL that ignores
// `kind` entirely, which is the exact bug worth catching.

import { describe, it, expect, vi, beforeEach } from "vitest"

const eq = vi.fn()
const order = vi.fn()
const insert = vi.fn()
const single = vi.fn()
const select = vi.fn()
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
  builder.select = chain(select)
  builder.order = chain(order)
  builder.eq = chain(eq)
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return builder
}

describe("listFunnels({ kind })", () => {
  it("filters on the kind column when a kind is given", async () => {
    // MUTANT KILLED: a listFunnels that accepts `kind` and never applies it —
    // which would show every funnel on the landing pages screen and vice versa.
    from.mockReturnValue(queryBuilder({ data: [], error: null }))
    const { listFunnels } = await import("@/lib/db/funnels")

    await listFunnels({ kind: "page" })

    expect(eq).toHaveBeenCalledWith("kind", "page")
  })

  it("does not filter on kind when none is given", async () => {
    // MUTANT KILLED: defaulting to kind='page', which would hide every funnel
    // from callers that legitimately want both (e.g. the leads inbox).
    from.mockReturnValue(queryBuilder({ data: [], error: null }))
    const { listFunnels } = await import("@/lib/db/funnels")

    await listFunnels()

    expect(eq).not.toHaveBeenCalledWith("kind", expect.anything())
  })
})

describe("createFunnel", () => {
  // The two inserts no longer share a chain shape: the funnel insert still ends
  // in `.single()`, while the step insert writes a PLAN — one row or ten — and
  // so ends in a plain `.select("id, slug")` that awaits to an array. Mocking
  // one shape for both stopped being possible when steps became a list
  // (2026-08-16). The claims below are unchanged; only the plumbing moved.
  const funnelInsert = vi.fn()
  const stepInsert = vi.fn()

  function mockBothTables() {
    funnelInsert.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "f1" }, error: null }) }),
    })
    stepInsert.mockReturnValue({
      select: () => ({
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: [{ id: "s1", slug: "index" }], error: null }),
      }),
    })
    from.mockImplementation((table: string) =>
      table === "funnels" ? { insert: funnelInsert } : { insert: stepInsert },
    )
  }

  it("persists kind and goal on the inserted row", async () => {
    // MUTANT KILLED: dropping kind/goal from the insert. The row would fall
    // back to the column default 'page' with a null goal, so a funnel created
    // from the Funnels screen would appear under Landing pages instead.
    mockBothTables()

    const { createFunnel } = await import("@/lib/db/funnels")
    await createFunnel({
      slug: "camp-2026",
      name: "Camp 2026",
      kind: "funnel",
      goal: "event",
    })

    expect(funnelInsert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "funnel", goal: "event" }),
    )
  })

  it("returns the entry step id so the caller can open the builder", async () => {
    // MUTANT KILLED: keeping the old fire-and-forget entry-step insert. Without
    // the id the create dialog cannot route into the builder and would have to
    // dump the owner back on the list — the behaviour this feature replaces.
    mockBothTables()

    const { createFunnel } = await import("@/lib/db/funnels")
    const result = await createFunnel({ slug: "free-trial", name: "Free Trial" })

    expect(result.entryStepId).toBe("s1")
  })
})

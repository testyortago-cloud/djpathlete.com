// createFunnel used to insert a funnel and exactly one hard-coded entry step.
// It now inserts a whole plan. Every test here reads the rows actually handed
// to Supabase, because the cheap version — asserting it resolved — passes
// against a DAL that silently drops every step after the first.

import { describe, it, expect, vi, beforeEach } from "vitest"

const funnelInsert = vi.fn()
const stepInsert = vi.fn()
const from = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from }),
}))

/** What the step insert returns: a chainable `.select()` that awaits to rows. */
function stepResult(rows: { id: string; slug: string }[] | null, error: unknown = null) {
  return {
    select: () => ({
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error }),
    }),
  }
}

/**
 * Deliberately returns the step rows IN A DIFFERENT ORDER than they were
 * inserted. Postgres does not promise RETURNING order matches VALUES order, and
 * the entry step must be found by slug rather than by position — see the last
 * test in this file.
 */
function shuffledSteps(slugs: string[]) {
  const rows = slugs.map((slug) => ({ id: `step-${slug}-id`, slug }))
  return [...rows].reverse()
}

function mockSupabase(stepRows: { id: string; slug: string }[] | null, stepError: unknown = null) {
  funnelInsert.mockReturnValue({
    select: () => ({ single: () => Promise.resolve({ data: { id: "f1" }, error: null }) }),
  })
  stepInsert.mockReturnValue(stepResult(stepRows, stepError))
  from.mockImplementation((table: string) =>
    table === "funnels" ? { insert: funnelInsert } : { insert: stepInsert },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

const threeSteps = [
  { name: "Details", slug: "index", goal: "event" as const },
  { name: "Register", slug: "register", goal: "leads" as const },
  { name: "Payment", slug: "payment", goal: "event" as const },
]

describe("createFunnel with a step plan", () => {
  it("writes one row per planned step, in order", async () => {
    // MUTANT KILLED: inserting only the first step and ignoring the rest, which
    // leaves the owner exactly where this feature started — one step called
    // "Step 1" and a list to fill in by hand.
    mockSupabase(shuffledSteps(["index", "register", "payment"]))
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "camp", name: "Camp", kind: "funnel", steps: threeSteps })

    const rows = stepInsert.mock.calls[0][0] as Record<string, unknown>[]
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.slug)).toEqual(["index", "register", "payment"])
    expect(rows.map((row) => row.name)).toEqual(["Details", "Register", "Payment"])
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2])
  })

  it("carries each step's goal onto its row", async () => {
    // MUTANT KILLED: dropping goal from the insert. Every step would then tell
    // the builder it has no job, and the payment step drafts as a generic page.
    mockSupabase(shuffledSteps(["index", "register", "payment"]))
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "camp", name: "Camp", kind: "funnel", steps: threeSteps })

    const rows = stepInsert.mock.calls[0][0] as Record<string, unknown>[]
    expect(rows.map((row) => row.goal)).toEqual(["event", "leads", "event"])
  })

  it("marks only the first step as the entry", async () => {
    // MUTANT KILLED: is_entry: true on every row. Two entry steps make
    // /go/<slug> ambiguous, and StepList would offer two "delete the funnel"
    // buttons on one screen.
    mockSupabase(shuffledSteps(["index", "register", "payment"]))
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "camp", name: "Camp", kind: "funnel", steps: threeSteps })

    const rows = stepInsert.mock.calls[0][0] as Record<string, unknown>[]
    expect(rows.filter((row) => row.is_entry)).toHaveLength(1)
    expect(rows[0].is_entry).toBe(true)
  })

  it("forces the first step's slug to the entry slug whatever it was sent", async () => {
    // Defence in depth: the validator already refuses this, and the address
    // /go/<slug> is unreachable if it slips through.
    mockSupabase(shuffledSteps(["index"]))
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({
      slug: "camp",
      name: "Camp",
      kind: "funnel",
      steps: [{ name: "Start", slug: "start", goal: null }],
    })

    expect((stepInsert.mock.calls[0][0] as Record<string, unknown>[])[0].slug).toBe("index")
  })

  it("persists the intake columns on the funnel row", async () => {
    mockSupabase(shuffledSteps(["index"]))
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({
      slug: "camp",
      name: "Camp",
      kind: "funnel",
      template: "event",
      audience: "High-school tennis players",
      offer: { kind: "event", ref: "Summer Camp 2026" },
      starts_at: "2026-06-01T00:00:00.000Z",
      ends_at: "2026-08-15T00:00:00.000Z",
      auto_offline_at_end: true,
      notify_emails: ["darren@example.com"],
    })

    expect(funnelInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "event",
        audience: "High-school tennis players",
        offer_kind: "event",
        offer_ref: "Summer Camp 2026",
        starts_at: "2026-06-01T00:00:00.000Z",
        ends_at: "2026-08-15T00:00:00.000Z",
        auto_offline_at_end: true,
        notify_emails: ["darren@example.com"],
      }),
    )
  })

  it("writes both halves of the offer or neither", async () => {
    // MUTANT KILLED: writing offer_kind and leaving offer_ref null. The
    // migration's paired CHECK rejects it, so this would be a 500 at create.
    mockSupabase(shuffledSteps(["index"]))
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "c", name: "C", kind: "funnel", template: "leads" })

    const row = funnelInsert.mock.calls[0][0] as Record<string, unknown>
    expect(row.offer_kind).toBeNull()
    expect(row.offer_ref).toBeNull()
  })

  it("returns the ENTRY step's id, not whichever row came back first", async () => {
    // MUTANT KILLED: `stepRows[0].id`. Postgres does not promise RETURNING
    // order matches VALUES order — the mock here returns them reversed on
    // purpose. The dialog routes the owner into whichever step this names, so
    // getting it wrong opens the confirmation page as if it were step one.
    mockSupabase(shuffledSteps(["index", "register", "payment"]))
    const { createFunnel } = await import("@/lib/db/funnels")

    const result = await createFunnel({
      slug: "camp",
      name: "Camp",
      kind: "funnel",
      steps: threeSteps,
    })

    expect(result.entryStepId).toBe("step-index-id")
  })

  it("throws rather than returning a funnel with no entry step", async () => {
    // A funnel whose entry step is missing has no front door and no way for the
    // caller to route anywhere. Failing loudly beats returning a broken id.
    mockSupabase([{ id: "x", slug: "register" }])
    const { createFunnel } = await import("@/lib/db/funnels")

    await expect(
      createFunnel({ slug: "camp", name: "Camp", kind: "funnel", steps: threeSteps }),
    ).rejects.toThrow(/entry step/i)
  })
})

describe("createFunnel without a step plan — what must not change", () => {
  it("creates exactly the single landing page step it created before", async () => {
    // MUTANT KILLED: making `steps` required, or defaulting it to a template.
    // CreatePageDialog sends neither and is explicitly out of scope.
    mockSupabase(shuffledSteps(["index"]))
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "trial", name: "Trial", kind: "page" })

    const rows = stepInsert.mock.calls[0][0] as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        slug: "index",
        name: "Landing page",
        position: 0,
        is_entry: true,
        goal: null,
      }),
    )
  })

  it("still names a funnel's lone entry step 'Step 1'", async () => {
    // The kind-dependent naming from the 2026-08-12 split, unchanged.
    mockSupabase(shuffledSteps(["index"]))
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "f", name: "F", kind: "funnel" })

    expect((stepInsert.mock.calls[0][0] as Record<string, unknown>[])[0].name).toBe("Step 1")
  })

  it("still surfaces a step insert failure as an error", async () => {
    mockSupabase(null, { message: "boom" })
    const { createFunnel } = await import("@/lib/db/funnels")

    await expect(createFunnel({ slug: "f", name: "F" })).rejects.toThrow(/boom/)
  })
})

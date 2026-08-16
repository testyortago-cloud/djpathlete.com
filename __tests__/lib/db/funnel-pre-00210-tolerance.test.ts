// What createFunnel/updateFunnel do on a database that has not seen 00210.
//
// This is the half of the contract `.github/workflows/apply-migrations.yml`
// asks every change to hold up: "Keep migrations additive and let code tolerate
// the old schema for one deploy."
//
// The stake is bigger than the feature. `createFunnel` is shared with
// `CreatePageDialog`, so getting this wrong takes LANDING PAGE creation down
// too — and `.env.local` points at a clone that has never had 00210, so it
// would be down locally right now.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { __resetIntakeColumnCache, INTAKE_PROBE_COLUMN } from "@/lib/db/funnel-schema-support"

const funnelInsert = vi.fn()
const funnelUpdate = vi.fn()
const stepInsert = vi.fn()
const probeLimit = vi.fn()
const from = vi.fn()

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({ from }) }))

/** Every new column 00210 adds to `funnels`. None may appear pre-migration. */
const INTAKE_COLUMNS = [
  "template",
  "audience",
  "offer_kind",
  "offer_ref",
  "starts_at",
  "ends_at",
  "auto_offline_at_end",
  "notify_emails",
]

function mockSupabase({ migrated }: { migrated: boolean }) {
  probeLimit.mockResolvedValue(
    migrated
      ? { data: [], error: null }
      : { data: null, error: { code: "42703", message: `column funnels.${INTAKE_PROBE_COLUMN} does not exist` } },
  )
  funnelInsert.mockReturnValue({
    select: () => ({ single: () => Promise.resolve({ data: { id: "f1" }, error: null }) }),
  })
  funnelUpdate.mockReturnValue({
    eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "f1" }, error: null }) }) }),
  })
  stepInsert.mockReturnValue({
    select: () => ({
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: [{ id: "s1", slug: "index" }], error: null }),
    }),
  })
  from.mockImplementation((table: string) =>
    table === "funnels"
      ? { insert: funnelInsert, update: funnelUpdate, select: () => ({ limit: probeLimit }) }
      : { insert: stepInsert },
  )
}

const PLAN = [
  { name: "Details", slug: "index", goal: "event" as const },
  { name: "Register", slug: "register", goal: "leads" as const },
]

beforeEach(() => {
  vi.clearAllMocks()
  __resetIntakeColumnCache()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("createFunnel before 00210 lands", () => {
  it("writes none of the intake columns", async () => {
    // MUTANT KILLED: inserting the new columns unconditionally. Postgres
    // rejects the whole statement with "column does not exist", so creating
    // ANY funnel or landing page 500s until the migration catches up.
    mockSupabase({ migrated: false })
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({
      slug: "camp",
      name: "Camp",
      kind: "funnel",
      template: "event",
      audience: "Tennis players",
      offer: { kind: "event", ref: "Summer Camp 2026" },
      starts_at: "2026-06-01T00:00:00.000Z",
      steps: PLAN,
    })

    const row = funnelInsert.mock.calls[0][0] as Record<string, unknown>
    for (const column of INTAKE_COLUMNS) expect(row, column).not.toHaveProperty(column)
  })

  it("still writes everything that predates 00210", async () => {
    mockSupabase({ migrated: false })
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "camp", name: "Camp", kind: "funnel", template: "event", steps: PLAN })

    expect(funnelInsert.mock.calls[0][0]).toMatchObject({
      slug: "camp",
      name: "Camp",
      kind: "funnel",
    })
  })

  it("still creates the whole multi-step plan, just without goals", async () => {
    // The shape survives; only the intent is lost. slug/name/position/is_entry
    // all predate 00210, so there is no reason to fall back to one step.
    mockSupabase({ migrated: false })
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "camp", name: "Camp", kind: "funnel", steps: PLAN })

    const rows = stepInsert.mock.calls[0][0] as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.slug)).toEqual(["index", "register"])
    expect(rows.map((row) => row.position)).toEqual([0, 1])
    for (const row of rows) expect(row).not.toHaveProperty("goal")
  })

  it("still creates a landing page, which is the wider blast radius", async () => {
    // CreatePageDialog calls this same function with no template and no steps.
    // If tolerance were only wired into the funnel path, landing page creation
    // would still be down.
    mockSupabase({ migrated: false })
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "free-trial", name: "Free Trial", kind: "page", goal: "leads" })

    const row = funnelInsert.mock.calls[0][0] as Record<string, unknown>
    expect(row).toMatchObject({ kind: "page", goal: "leads" })
    expect(row).not.toHaveProperty("template")
    expect((stepInsert.mock.calls[0][0] as Record<string, unknown>[])[0].name).toBe("Landing page")
  })

  it("says so in the log rather than degrading silently", async () => {
    mockSupabase({ migrated: false })
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({ slug: "camp", name: "Camp", kind: "funnel" })

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("00210"))
  })
})

describe("createFunnel once 00210 has landed", () => {
  it("writes the intake columns again", async () => {
    // MUTANT KILLED: leaving the degraded path permanently on. The feature
    // would be inert on a fully migrated database and every test above would
    // still pass.
    mockSupabase({ migrated: true })
    const { createFunnel } = await import("@/lib/db/funnels")

    await createFunnel({
      slug: "camp",
      name: "Camp",
      kind: "funnel",
      template: "event",
      offer: { kind: "event", ref: "Summer Camp 2026" },
      steps: PLAN,
    })

    expect(funnelInsert.mock.calls[0][0]).toMatchObject({
      template: "event",
      offer_kind: "event",
      offer_ref: "Summer Camp 2026",
    })
    expect((stepInsert.mock.calls[0][0] as Record<string, unknown>[])[0].goal).toBe("event")
  })
})

describe("updateFunnel before 00210 lands", () => {
  it("still renames, which must not depend on a migration", async () => {
    mockSupabase({ migrated: false })
    const { updateFunnel } = await import("@/lib/db/funnels")

    await updateFunnel("f1", { name: "Renamed", audience: "Tennis players" })

    const row = funnelUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(row.name).toBe("Renamed")
    expect(row).not.toHaveProperty("audience")
  })

  it("still publishes, which is the one that would hurt most", async () => {
    // Status changes go through here. A funnel that cannot be published
    // because a column is missing is a page nobody can reach.
    mockSupabase({ migrated: false })
    const { updateFunnel } = await import("@/lib/db/funnels")

    await updateFunnel("f1", { status: "published" })

    expect((funnelUpdate.mock.calls[0][0] as Record<string, unknown>).status).toBe("published")
  })

  it("writes the intake columns once the migration has landed", async () => {
    mockSupabase({ migrated: true })
    const { updateFunnel } = await import("@/lib/db/funnels")

    await updateFunnel("f1", { audience: "Tennis players", ends_at: "2026-08-15T00:00:00.000Z" })

    expect(funnelUpdate.mock.calls[0][0]).toMatchObject({
      audience: "Tennis players",
      ends_at: "2026-08-15T00:00:00.000Z",
    })
  })
})

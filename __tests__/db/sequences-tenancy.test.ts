// @vitest-environment node
//
// exitRunsForContact is the one scoped-table write in the booking chain that
// had no business_id predicate. It was correct only by accident — contact_id
// happens to be tenant-unique today — and the accident ends the moment two
// businesses exist. This suite is the predicate's only proof.
import { describe, it, expect, vi, beforeEach } from "vitest"

const BUSINESS_A = "00000000-0000-0000-0000-000000000001"
const BUSINESS_B = "00000000-0000-0000-0000-0000000000b2"

// Records every .eq() applied to the update, so the test can assert the
// PREDICATE and not merely the return value. A mock that returns rows proves
// nothing about which rows the database would have matched.
let appliedEqs: Array<[string, unknown]>

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "sequence_runs") throw new Error(`unmocked table ${table}`)
      const chain: any = {
        update: () => chain,
        eq: (col: string, val: unknown) => {
          appliedEqs.push([col, val])
          return chain
        },
        select: () => Promise.resolve({ data: [{ id: "run-1" }], error: null }),
      }
      return chain
    },
  }),
}))

import { exitRunsForContact } from "@/lib/db/sequences"

describe("exitRunsForContact tenancy", () => {
  beforeEach(() => {
    appliedEqs = []
  })

  it("filters on business_id, not just contact_id and status", async () => {
    await exitRunsForContact("c-1", "booking", BUSINESS_B)
    expect(appliedEqs).toContainEqual(["business_id", BUSINESS_B])
    expect(appliedEqs).toContainEqual(["contact_id", "c-1"])
    expect(appliedEqs).toContainEqual(["status", "active"])
  })

  it("writes the reason into exit_reason and never the business id", async () => {
    let updatePayload: Record<string, unknown> | null = null
    vi.resetModules()
    vi.doMock("@/lib/supabase", () => ({
      createServiceRoleClient: () => ({
        from: () => {
          const chain: any = {
            update: (p: Record<string, unknown>) => {
              updatePayload = p
              return chain
            },
            eq: () => chain,
            select: () => Promise.resolve({ data: [], error: null }),
          }
          return chain
        },
      }),
    }))
    const { exitRunsForContact: fresh } = await import("@/lib/db/sequences")
    await fresh("c-1", "booking", BUSINESS_A)
    expect(updatePayload).toMatchObject({ exit_reason: "booking", status: "exited" })
    expect(JSON.stringify(updatePayload)).not.toContain(BUSINESS_A)
  })
})

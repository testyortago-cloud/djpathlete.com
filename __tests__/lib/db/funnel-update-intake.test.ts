// PATCHing the intake fields.
//
// This file exists because a self-review found the gap it guards: widening
// `updateFunnelSchema` to accept `offer` TYPE-CHECKED against the old
// `updateFunnel` signature — excess-property checks do not apply to a variable,
// and the route passes `parsed.data` — so a clean 200-looking request reached
// Supabase with a key named `offer`, which is not a column.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { __resetIntakeColumnCache } from "@/lib/db/funnel-schema-support"

const update = vi.fn()
const from = vi.fn()

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({ from }) }))

beforeEach(() => {
  vi.clearAllMocks()
  __resetIntakeColumnCache()
  update.mockReturnValue({
    eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "f1" }, error: null }) }) }),
  })
  // The 00210 presence probe answers "migrated" — the degraded path is covered
  // in funnel-pre-00210-tolerance.test.ts.
  from.mockReturnValue({
    update,
    select: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
  })
})

async function patch(input: Record<string, unknown>) {
  const { updateFunnel } = await import("@/lib/db/funnels")
  await updateFunnel("f1", input)
  return update.mock.calls[0][0] as Record<string, unknown>
}

describe("updateFunnel — the offer", () => {
  it("never sends a column called offer", async () => {
    // MUTANT KILLED: spreading the parsed body straight through. Postgres has
    // no `offer` column, so this 500s on a request the validator called valid.
    const row = await patch({ offer: { kind: "event", ref: "Summer Camp 2026" } })
    expect(row).not.toHaveProperty("offer")
  })

  it("splits an offer into its two columns", async () => {
    const row = await patch({ offer: { kind: "event", ref: "Summer Camp 2026" } })
    expect(row.offer_kind).toBe("event")
    expect(row.offer_ref).toBe("Summer Camp 2026")
  })

  it("clears both columns when the offer is explicitly null", async () => {
    // Both or neither — `funnels_offer_paired_check` rejects a half-cleared row.
    const row = await patch({ offer: null })
    expect(row.offer_kind).toBeNull()
    expect(row.offer_ref).toBeNull()
  })

  it("touches neither column when no offer is supplied", async () => {
    // MUTANT KILLED: treating "not supplied" as "clear it", which would drop
    // the linked offer from any funnel whose name was edited.
    const row = await patch({ name: "Renamed" })
    expect(row).not.toHaveProperty("offer_kind")
    expect(row).not.toHaveProperty("offer_ref")
  })
})

describe("updateFunnel — the rest of the intake", () => {
  it("writes the run window and the audience", async () => {
    const row = await patch({
      audience: "High-school tennis players",
      starts_at: "2026-06-01T00:00:00.000Z",
      ends_at: "2026-08-15T00:00:00.000Z",
      auto_offline_at_end: true,
      notify_emails: ["darren@example.com"],
    })
    expect(row).toMatchObject({
      audience: "High-school tennis players",
      starts_at: "2026-06-01T00:00:00.000Z",
      ends_at: "2026-08-15T00:00:00.000Z",
      auto_offline_at_end: true,
      notify_emails: ["darren@example.com"],
    })
  })

  it("still stamps updated_at", async () => {
    const row = await patch({ name: "Renamed" })
    expect(typeof row.updated_at).toBe("string")
  })
})

// __tests__/lib/db/lead-magnets-tenancy.test.ts
//
// Covers lib/db/funnel-checkout-grants.ts (hasProcessedCheckoutSession,
// hasGrantedOpportunity, recordCheckoutGrant) and lib/db/lead-magnets.ts
// (listLeadMagnets, getLeadMagnetById, createLeadMagnet, updateLeadMagnet,
// deleteLeadMagnet, findRelevantLeadMagnet) -- Task 5 of G31 / migration
// 00278. Neither table has a foreign key into the funnel tables (00278
// couldn't give either a composite FK the way it did for funnel_step_turns or
// funnel_submissions), so the `.eq("business_id", ...)` predicate below is the
// ONLY thing standing between one coach and another's checkout grants and
// lead magnets.
//
// THE FAKE IS FILTER-AWARE AND STATEFUL: `.eq()` narrows the in-memory row
// set, `.update()`/`.delete()` actually mutate the backing array (in place),
// and `.insert()` records what was stamped. That statefulness is what proves
// deleteLeadMagnet -- a delete matching zero rows does not error, so the only
// way to prove a wrong-tenant delete was a no-op is to read the row back
// afterward and find it still there.
//
// lead_magnets IS ASYMMETRIC (tenant A has more rows than tenant B) so a
// count-shaped bug can't hide behind an equal-sized fixture there.
// funnel_checkout_grants ends up row-count-symmetric (2 and 2) once tenant B
// has its own opportunity grant alongside its own session grant -- and that
// is fine, not a regression of the asymmetry rule: every read on this table
// is a single-row existence check (.maybeSingle() on one id), never a count
// or a list, so an equal row COUNT cannot make a wrong predicate coincidentally
// return the right answer the way it could for a list/count read. What has to
// differ instead, and does, is which VALUE each tenant's row carries: tenant
// A's session grant uses "cs_1" while tenant B's uses "cs_9", and tenant A's
// opportunity grant uses "opp_1" while tenant B's uses "opp_9" -- so a reader
// that drops its business_id predicate answers tenant B's "has cs_1 /
// opp_1 been processed?" with a wrong "yes", which is the exact double-grant
// this file exists to prevent.

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const A = "aaaaaaaa-0000-0000-0000-00000000000a"
const B = "bbbbbbbb-0000-0000-0000-00000000000b"

let captured: { col: string; val: unknown }[] = []
let capturedInserts: { table: string; payload: Record<string, unknown> }[] = []
let insertCounter = 0

const FIXTURE: Record<string, Record<string, unknown>[]> = {}

function resetFixture() {
  // A has 2 grants, B has 2. A's g1 and B's g3 use DIFFERENT Stripe session
  // ids on purpose -- see file header. B also gets its OWN opportunity grant
  // (g4) rather than sharing A's "opp_1": without it, hasGrantedOpportunity's
  // "does not see another tenant's grant" case was true only because "opp_1"
  // happened to exist nowhere under B, not because the predicate was proven
  // to narrow anything -- coverage by coincidence, not by construction.
  FIXTURE.funnel_checkout_grants = [
    {
      id: "g1",
      business_id: A,
      stripe_session_id: "cs_1",
      opportunity_id: null,
      user_id: "u1",
      email: "a1@example.com",
      product_kind: "program",
      product_id: "prog-1",
      funnel_id: null,
      step_id: null,
      lead_id: null,
      account_created: false,
    },
    {
      id: "g2",
      business_id: A,
      stripe_session_id: null,
      opportunity_id: "opp_1",
      user_id: "u2",
      email: "a2@example.com",
      product_kind: "program",
      product_id: "prog-2",
      funnel_id: null,
      step_id: null,
      lead_id: null,
      account_created: false,
    },
    {
      id: "g3",
      business_id: B,
      stripe_session_id: "cs_9",
      opportunity_id: null,
      user_id: "u3",
      email: "b1@example.com",
      product_kind: "program",
      product_id: "prog-3",
      funnel_id: null,
      step_id: null,
      lead_id: null,
      account_created: false,
    },
    {
      id: "g4",
      business_id: B,
      stripe_session_id: null,
      opportunity_id: "opp_9",
      user_id: "u4",
      email: "b2@example.com",
      product_kind: "program",
      product_id: "prog-4",
      funnel_id: null,
      step_id: null,
      lead_id: null,
      account_created: false,
    },
  ]

  // Asymmetric: A has 2 magnets (one inactive), B has 1.
  FIXTURE.lead_magnets = [
    {
      id: "m1",
      business_id: A,
      slug: "a-speed-guide",
      title: "A's Speed Guide",
      description: "d",
      asset_url: "https://example.com/a.pdf",
      category: null,
      tags: ["speed", "strength"],
      active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "m1-inactive",
      business_id: A,
      slug: "a-old-offer",
      title: "A's Retired Offer",
      description: "d",
      asset_url: "https://example.com/a-old.pdf",
      category: null,
      tags: [],
      active: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "m2",
      business_id: B,
      slug: "b-speed-guide",
      title: "B's Speed Guide",
      description: "d",
      asset_url: "https://example.com/b.pdf",
      category: null,
      tags: ["speed"],
      active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]
}

function makeQuery(table: string, rows: Record<string, unknown>[]) {
  const q: Record<string, unknown> = {}
  let current = [...rows]
  let pendingUpdate: Record<string, unknown> | null = null
  let pendingDelete = false

  const chain = (fn: () => void) => {
    fn()
    return q
  }

  q.select = () => q
  q.order = () => q
  q.eq = (col: string, val: unknown) =>
    chain(() => {
      captured.push({ col, val })
      current = current.filter((r) => r[col] === val)
    })
  q.update = (payload: Record<string, unknown>) => chain(() => (pendingUpdate = payload))
  q.delete = () => chain(() => (pendingDelete = true))
  q.insert = (payload: Record<string, unknown>) =>
    chain(() => {
      capturedInserts.push({ table, payload })
      const row = { id: `new-${++insertCounter}`, ...payload }
      rows.push(row) // mutates the ORIGINAL backing array, visible to later .from() calls
      current = [row]
    })

  const applyPendingUpdate = () => {
    if (!pendingUpdate) return
    for (const row of current) Object.assign(row, pendingUpdate)
  }
  const applyPendingDelete = () => {
    if (!pendingDelete) return
    for (const row of current) {
      const idx = rows.indexOf(row)
      if (idx !== -1) rows.splice(idx, 1)
    }
  }

  q.maybeSingle = async () => {
    applyPendingUpdate()
    return { data: current[0] ?? null, error: null }
  }
  q.single = async () => {
    applyPendingUpdate()
    if (current.length === 0) return { data: null, error: { message: `no rows matched in ${table}` } }
    return { data: current[0], error: null }
  }
  q.then = (resolve: (v: unknown) => void) => {
    if (pendingDelete) {
      applyPendingDelete()
      resolve({ data: null, error: null })
      return
    }
    applyPendingUpdate()
    resolve({ data: current, error: null })
  }
  return q
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => makeQuery(table, FIXTURE[table] ?? []),
  }),
}))

import {
  hasProcessedCheckoutSession,
  hasGrantedOpportunity,
  recordCheckoutGrant,
} from "@/lib/db/funnel-checkout-grants"
import {
  listLeadMagnets,
  getLeadMagnetById,
  createLeadMagnet,
  updateLeadMagnet,
  deleteLeadMagnet,
  findRelevantLeadMagnet,
} from "@/lib/db/lead-magnets"

beforeEach(() => {
  captured = []
  capturedInserts = []
  insertCounter = 0
  resetFixture()
})

describe("funnel-checkout-grants DAL is tenant-scoped", () => {
  it("hasProcessedCheckoutSession does not see another tenant's grant", async () => {
    // Stripe session ids are globally unique, so this cannot collide by
    // accident today. It is scoped anyway: the day a grant is read to decide
    // whether somebody already paid, answering from another tenant's row is
    // the kind of wrong answer that hands out a product for free -- or here,
    // tells tenant B a session it never touched was already processed.
    expect(await hasProcessedCheckoutSession(A, "cs_1")).toBe(true)
    expect(await hasProcessedCheckoutSession(B, "cs_1")).toBe(false)
    expect(await hasProcessedCheckoutSession(B, "cs_9")).toBe(true) // permissive control
  })

  it("hasGrantedOpportunity does not see another tenant's grant", async () => {
    expect(await hasGrantedOpportunity(A, "opp_1")).toBe(true)
    expect(await hasGrantedOpportunity(B, "opp_1")).toBe(false)
    expect(await hasGrantedOpportunity(B, "opp_9")).toBe(true) // permissive control
  })

  it("filters on the business_id VALUE it was given", async () => {
    // MUTANT: `.eq("business_id", A)` hard-coded, or `.eq("stripe_session_id", businessId)`.
    await hasProcessedCheckoutSession(B, "cs_9")
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })

  it("hasGrantedOpportunity filters on the business_id VALUE it was given", async () => {
    // MUTANT: `.eq("business_id", A)` hard-coded, or `.eq("opportunity_id", businessId)`.
    await hasGrantedOpportunity(B, "opp_9")
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })

  it("recordCheckoutGrant stamps the tenant it was given, not merely a present column", async () => {
    await recordCheckoutGrant(B, {
      stripe_session_id: "cs_new",
      user_id: "u9",
      email: "new@example.com",
      product_kind: "program",
      product_id: "prog-9",
      funnel_id: null,
      step_id: null,
      lead_id: null,
      account_created: true,
    })
    expect(capturedInserts[capturedInserts.length - 1]).toMatchObject({
      table: "funnel_checkout_grants",
      payload: expect.objectContaining({ business_id: B, stripe_session_id: "cs_new" }),
    })
  })

  it("stamps each tenant's own id -- permissive control", async () => {
    await recordCheckoutGrant(A, {
      stripe_session_id: "cs_a_new",
      user_id: "u10",
      email: "a10@example.com",
      product_kind: "program",
      product_id: "prog-10",
      funnel_id: null,
      step_id: null,
      lead_id: null,
      account_created: true,
    })
    await recordCheckoutGrant(B, {
      stripe_session_id: "cs_b_new",
      user_id: "u11",
      email: "b11@example.com",
      product_kind: "program",
      product_id: "prog-11",
      funnel_id: null,
      step_id: null,
      lead_id: null,
      account_created: true,
    })
    expect(capturedInserts[capturedInserts.length - 2].payload.business_id).toBe(A)
    expect(capturedInserts[capturedInserts.length - 1].payload.business_id).toBe(B)
  })
})

describe("lead-magnets DAL is tenant-scoped", () => {
  it("listLeadMagnets returns each tenant only its own", async () => {
    expect((await listLeadMagnets(A)).map((m) => m.id)).toEqual(["m1"])
    expect((await listLeadMagnets(B)).map((m) => m.id)).toEqual(["m2"]) // permissive control
  })

  it("listLeadMagnets stays scoped to the tenant when includeInactive is true", async () => {
    // Both tenants' fixtures include an inactive row for A only -- if the
    // tenant predicate were dropped, B would see A's retired offer too.
    expect((await listLeadMagnets(A, true)).map((m) => m.id).sort()).toEqual(["m1", "m1-inactive"])
    expect((await listLeadMagnets(B, true)).map((m) => m.id)).toEqual(["m2"])
  })

  it("filters on the business_id VALUE it was given", async () => {
    await listLeadMagnets(B)
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })

  it("getLeadMagnetById returns a tenant's own magnet and not another tenant's row by id", async () => {
    expect((await getLeadMagnetById(A, "m1"))?.id).toBe("m1")
    expect(await getLeadMagnetById(A, "m2")).toBeNull() // "m2" belongs to B
    expect((await getLeadMagnetById(B, "m2"))?.id).toBe("m2") // permissive control
  })

  it("createLeadMagnet stamps the tenant it was given, not merely a present column", async () => {
    const input = {
      slug: "new-guide",
      title: "New Guide",
      description: "d",
      asset_url: "https://example.com/new.pdf",
      category: null,
      tags: ["new"],
      active: true,
    }
    await createLeadMagnet(B, input)
    expect(capturedInserts[capturedInserts.length - 1]).toMatchObject({
      table: "lead_magnets",
      payload: expect.objectContaining({ business_id: B, slug: "new-guide" }),
    })
  })

  it("updateLeadMagnet can only change a magnet inside the caller's own tenant", async () => {
    await expect(updateLeadMagnet(A, "m2", { title: "Hijacked" })).rejects.toThrow()
    const updated = await updateLeadMagnet(B, "m2", { title: "Renamed" }) // permissive control
    expect(updated.title).toBe("Renamed")
  })

  it("deleteLeadMagnet can only remove a magnet inside the caller's own tenant", async () => {
    // A wrong-tenant delete matches zero rows and does NOT error -- Postgres
    // treats "deleted nothing" as success -- so the only way to prove it was a
    // no-op is to read the row back afterward and find it still there.
    await deleteLeadMagnet(A, "m2")
    expect((await getLeadMagnetById(B, "m2"))?.id).toBe("m2")

    await deleteLeadMagnet(B, "m2") // permissive control
    expect(await getLeadMagnetById(B, "m2")).toBeNull()
  })

  it("findRelevantLeadMagnet never considers another tenant's magnets as candidates", async () => {
    // A's active magnet also matches "speed" and has a WIDER tag overlap than
    // B's own -- if findRelevantLeadMagnet filtered business_id only after
    // scoring, or not at all, B's best match would be A's magnet.
    const forB = await findRelevantLeadMagnet(B, { tags: ["speed"] })
    expect(forB?.id).toBe("m2")
    const forA = await findRelevantLeadMagnet(A, { tags: ["speed"] })
    expect(forA?.id).toBe("m1") // permissive control
  })

  it("filters on the business_id VALUE it was given", async () => {
    // MUTANT: `.eq("business_id", A)` hard-coded, or `.eq("active", businessId)`.
    await findRelevantLeadMagnet(B, { tags: ["speed"] })
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })
})

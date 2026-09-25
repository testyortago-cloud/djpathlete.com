// __tests__/lib/db/funnel-leads-tenancy.test.ts
//
// lib/db/funnel-leads.ts reads funnel_submissions (embedded with funnels and
// funnel_steps) and quiz_attempts. Migration 00278 REPLACED the simple FKs
// funnel_submissions -> funnels / funnel_steps with composite ones carrying
// business_id, precisely so PostgREST still resolves exactly ONE relationship
// per table pair for the embed string below. If two FKs existed, or if a
// caller "simplified" the select to "*", PostgREST answers PGRST201 and the
// inbox renders blank with no error -- so the embed shape itself is pinned as
// a test here, not only the tenant scoping.
//
// THE EMBED HAS NO `:column` HINT. It used to (`funnels:funnel_id (name,
// slug)`), which worked against the pre-00278 SIMPLE FK but 400s with PGRST200
// against the post-00278 COMPOSITE one -- a real regression this mock-only
// suite could not see, caught only by Task 10's live-database, real-second-
// tenant run (scripts/verify-funnel-tenancy.ts). Since the FK was REPLACED,
// not added alongside, there is exactly one relationship per table pair now,
// so no hint is needed at all.

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const A = "aaaaaaaa-0000-0000-0000-00000000000a"
const B = "bbbbbbbb-0000-0000-0000-00000000000b"

// Two tenants' submissions, each embedding its OWN page -- a cross-tenant
// mix-up is visible in funnel_name/step_name, not only in a captured call.
const SUBMISSIONS = [
  {
    id: "s1",
    business_id: A,
    funnel_id: "f1",
    step_id: "st1",
    payload: {},
    status: "new",
    notes: null,
    created_at: "2026-01-02T00:00:00.000Z",
    funnels: { name: "A Guide", slug: "a-guide" },
    funnel_steps: { name: "A Entry" },
  },
  {
    id: "s2",
    business_id: B,
    funnel_id: "f2",
    step_id: "st2",
    payload: {},
    status: "new",
    notes: null,
    created_at: "2026-01-02T00:00:00.000Z",
    funnels: { name: "B Guide", slug: "b-guide" },
    funnel_steps: { name: "B Entry" },
  },
]

// quiz_attempts (00228) carries business_id too -- confirmed by reading the
// migration rather than assumed. Two attempts, one per tenant.
const QUIZ_ATTEMPTS = [
  { id: "qa1", business_id: A, score: 70, tier_key: "gold", profile_key: "power" },
  { id: "qa2", business_id: B, score: 40, tier_key: "silver", profile_key: "speed" },
]

let captured: { col: string; val: unknown }[] = []
let capturedSelect = ""

/**
 * A chainable stand-in for the PostgREST builder, FILTER-AWARE: `.eq()` etc.
 * actually narrow the row set, so a reader whose predicate names the wrong
 * column (or omits one) is caught by the OUTPUT, not only by a captured call.
 * Same shape as __tests__/lib/db/funnels-tenancy.test.ts's makeQuery, extended
 * with `.update()`/`.single()`/`.gte()`/head-mode `.select()` for the methods
 * this file's writers and count use that the funnels.ts fake never needed.
 */
function makeQuery(rows: Record<string, unknown>[]) {
  const q: Record<string, unknown> = {}
  let current = [...rows]
  let headMode = false
  let pendingUpdate: Record<string, unknown> | null = null
  const chain = (fn: () => void) => {
    fn()
    return q
  }
  q.select = (sel: string, opts?: { head?: boolean }) => {
    capturedSelect = sel
    headMode = Boolean(opts?.head)
    return q
  }
  q.eq = (col: string, val: unknown) =>
    chain(() => {
      captured.push({ col, val })
      current = current.filter((r) => r[col] === val)
    })
  q.gte = (col: string, val: unknown) =>
    chain(() => {
      captured.push({ col: `gte.${col}`, val })
      current = current.filter((r) => String(r[col]) >= String(val))
    })
  q.or = (filter: string) =>
    chain(() => {
      // Not exercised by tenancy assertions here -- searchClause has its own
      // dedicated suite in funnel-leads.test.ts. Recorded so a call is still
      // visible if a future test wants it.
      captured.push({ col: "or", val: filter })
    })
  q.in = (col: string, vals: unknown[]) =>
    chain(() => {
      captured.push({ col: `in.${col}`, val: vals })
      current = current.filter((r) => (vals as unknown[]).includes(r[col]))
    })
  q.order = () => q
  q.range = () => q
  q.limit = () => q
  q.maybeSingle = async () => ({ data: current[0] ?? null, error: null })
  q.single = async () => {
    if (current.length === 0) return { data: null, error: { message: "no rows found" } }
    const row = pendingUpdate ? { ...current[0], ...pendingUpdate } : current[0]
    return { data: row, error: null }
  }
  // Mirrors update().eq().eq().select().single(): remembers the payload and
  // applies it on resolution, never mutating the shared fixture row objects.
  q.update = (payload: Record<string, unknown>) =>
    chain(() => {
      pendingUpdate = payload
    })
  q.then = (resolve: (v: unknown) => void) =>
    resolve(headMode ? { count: current.length, data: null, error: null } : { data: current, error: null })
  return q
}

const FIXTURE: Record<string, Record<string, unknown>[]> = {
  funnel_submissions: SUBMISSIONS,
  quiz_attempts: QUIZ_ATTEMPTS,
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: (table: string) => makeQuery(FIXTURE[table] ?? []) }),
}))

import {
  listLeads,
  getQuizOutcomesForLeads,
  countLeads,
  getLead,
  setLeadStatus,
  setLeadNotes,
} from "@/lib/db/funnel-leads"

beforeEach(() => {
  captured = []
  capturedSelect = ""
})

describe("funnel-leads DAL is tenant-scoped", () => {
  it("keeps the funnels/funnel_steps embed intact", async () => {
    // MUTANT: change SELECT_WITH_PAGE to plain "*". The inbox then renders
    // every row with a blank page column and no error -- the exact silent
    // degradation PGRST201 would cause if the migration had added FKs
    // alongside instead of replacing them.
    //
    // NO `:column` HINT -- proven wrong once already. A hint naming the FK's
    // own column (e.g. "funnels:funnel_id") only resolves against a SIMPLE
    // FK; 00278's composite FK made that exact string 400 with PGRST200
    // against the live database (verified against the dev clone,
    // scripts/verify-funnel-tenancy.ts). This mock cannot catch that class of
    // bug -- it proves the shape a real PostgREST call needs, not that
    // PostgREST accepts it.
    await listLeads(A)
    expect(capturedSelect).toContain("funnels(name, slug)")
    expect(capturedSelect).toContain("funnel_steps(name)")
  })

  it("scopes leads to one tenant", async () => {
    expect((await listLeads(A)).map((l) => l.id)).toEqual(["s1"])
    expect((await listLeads(B)).map((l) => l.id)).toEqual(["s2"]) // permissive control
  })

  it("carries the embedded page name through, per tenant", async () => {
    const [leadA] = await listLeads(A)
    const [leadB] = await listLeads(B)
    expect(leadA.funnel_name).toBe("A Guide")
    expect(leadB.funnel_name).toBe("B Guide") // permissive control
  })

  it("filters on business_id with the VALUE it was given, not merely some value", async () => {
    // MUTANT: `.eq("business_id", A)` hard-coded, or `.eq("id", businessId)`.
    await listLeads(B)
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })

  it("still scopes to the tenant even when other filters are supplied", async () => {
    // Both fixture rows share status "new" -- a filter that matches both
    // tenants on its own. If applyFilters ever stopped adding business_id
    // UNCONDITIONALLY, this combination would return both rows.
    expect((await listLeads(A, { status: "new" })).map((l) => l.id)).toEqual(["s1"])
  })

  it("countLeads narrows by tenant the same way listLeads does", async () => {
    expect(await countLeads(A)).toBe(1)
    expect(await countLeads(B)).toBe(1) // permissive control
  })

  it("getQuizOutcomesForLeads scopes to one tenant's attempts", async () => {
    const forA = await getQuizOutcomesForLeads(A, ["qa1", "qa2"])
    const forB = await getQuizOutcomesForLeads(B, ["qa1", "qa2"])
    expect(forA).toEqual({ qa1: { score: 70, tierKey: "gold", profileKey: "power" } })
    expect(forB).toEqual({ qa2: { score: 40, tierKey: "silver", profileKey: "speed" } }) // permissive control
  })

  it("getLead returns a tenant's own lead and not another tenant's row by id", async () => {
    expect((await getLead(A, "s1"))?.id).toBe("s1")
    expect(await getLead(A, "s2")).toBeNull() // A cannot fetch B's row by id
    expect((await getLead(B, "s2"))?.id).toBe("s2") // permissive control
  })

  it("setLeadStatus can only move a lead inside the caller's own tenant", async () => {
    await expect(setLeadStatus(A, "s2", "contacted")).rejects.toThrow(/setLeadStatus/)
    const updated = await setLeadStatus(B, "s2", "contacted") // permissive control
    expect(updated.status).toBe("contacted")
  })

  it("setLeadNotes can only annotate a lead inside the caller's own tenant", async () => {
    await expect(setLeadNotes(A, "s2", "called, no answer")).rejects.toThrow(/setLeadNotes/)
    const updated = await setLeadNotes(B, "s2", "called, no answer") // permissive control
    expect(updated.notes).toBe("called, no answer")
  })
})

// __tests__/lib/db/funnel-builder-tenancy.test.ts
//
// Covers lib/db/funnel-builder.ts (getDraft, appendTurn, listTurns,
// getTurnByRevision, revertToRevision) and lib/db/funnel-page-tree.ts
// (getPageTree, savePageTree) -- Task 4 of G31 / migration 00278. Both files
// share one optimistic lock on funnel_steps.doc_revision, so one fixture and
// one fake cover both.
//
// hasIntakeColumns (funnel-schema-support.ts) is deliberately NOT tested here.
// It answers a question about the SCHEMA (does this database have migration
// 00210?), which cannot differ per tenant, and is not filtered -- see the
// tenancy comment at the top of lib/db/funnel-schema-support.ts. Its arity fix
// is covered by the existing __tests__/lib/db/funnel-schema-support.test.ts.
//
// THE FAKE IS FILTER-AWARE AND STATEFUL, not just a call recorder: `.eq()`
// actually narrows the in-memory row set, and `.update()` actually mutates the
// matched row (in place, so a later `.from()` call on the same table sees it).
// That is load-bearing for appendTurn/savePageTree specifically -- their
// compare-and-swap has to be proven to find ZERO rows for the wrong tenant,
// not merely to have been "called with the right arguments".
//
// THE FIXTURE IS ASYMMETRIC (tenant A: 2 rows, tenant B: 1, on both tables) so
// a count-shaped bug can't hide behind equal-sized fixtures, and funnel_steps
// row "shared" is referenced by a turn from BOTH tenants under the SAME
// step_id -- the worst case for a reader that forgets the business_id half of
// its predicate, mirroring the brief's own example.

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const A = "aaaaaaaa-0000-0000-0000-00000000000a"
const B = "bbbbbbbb-0000-0000-0000-00000000000b"
const PROGRAM = "11111111-1111-4111-8111-111111111111"

/** Known-valid SectionDoc shape, copied from funnel-builder.test.ts's doc(). */
function validDoc(headline: string): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: { headline, primaryCta: { label: "Start", target: { kind: "program", ref: PROGRAM } } },
      },
    ],
  } as SectionDoc
}

/** Known-valid PageTree shape, copied from funnel-page-tree.test.ts's tree. */
const PAGE_TREE = {
  v: 1 as const,
  engine: "tree" as const,
  theme: { tone: "light" as const, accent: "accent" as const, radius: "soft" as const },
  sections: [],
}

let captured: { col: string; val: unknown }[] = []
let capturedInserts: { table: string; payload: Record<string, unknown> }[] = []
let insertCounter = 0

const FIXTURE: Record<string, Record<string, unknown>[]> = {}

function resetFixture() {
  FIXTURE.funnel_steps = [
    { id: "s1", business_id: A, project_data: null, doc_revision: 3, page_tree: null },
    { id: "s2", business_id: A, project_data: null, doc_revision: 9, page_tree: null },
    { id: "shared", business_id: B, project_data: null, doc_revision: 5, page_tree: null },
  ]
  FIXTURE.funnel_step_turns = [
    // t1/t2 share a step_id VALUE across tenants on purpose -- the read has
    // to separate them by business_id, not by step_id being unique.
    {
      id: "t1",
      step_id: "shared",
      revision: 1,
      business_id: A,
      doc: null,
      compile_status: null,
      compile_problems: [],
      unresolved: [],
    },
    {
      id: "t2",
      step_id: "shared",
      revision: 1,
      business_id: B,
      doc: null,
      compile_status: null,
      compile_problems: [],
      unresolved: [],
    },
    // t3 is A's own turn under A's own step "s1", carrying a real document --
    // the only row that needs to survive Zod validation, for the revert test.
    {
      id: "t3",
      step_id: "s1",
      revision: 1,
      business_id: A,
      doc: validDoc("A original"),
      compile_status: "ok",
      compile_problems: [],
      unresolved: [],
    },
  ]
}

function makeQuery(table: string, rows: Record<string, unknown>[]) {
  const q: Record<string, unknown> = {}
  let current = [...rows]
  let pendingUpdate: Record<string, unknown> | null = null

  const chain = (fn: () => void) => {
    fn()
    return q
  }

  q.select = () => q
  q.eq = (col: string, val: unknown) =>
    chain(() => {
      captured.push({ col, val })
      current = current.filter((r) => r[col] === val)
    })
  q.order = () => q
  q.limit = () => q
  q.update = (payload: Record<string, unknown>) => chain(() => (pendingUpdate = payload))
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

import { getDraft, appendTurn, listTurns, getTurnByRevision, revertToRevision } from "@/lib/db/funnel-builder"
import { getPageTree, savePageTree } from "@/lib/db/funnel-page-tree"

beforeEach(() => {
  captured = []
  capturedInserts = []
  insertCounter = 0
  resetFixture()
})

describe("listTurns", () => {
  it("returns only the asking tenant's turns for a shared step id", async () => {
    expect((await listTurns(A, "shared")).map((t) => t.id)).toEqual(["t1"])
  })

  it("returns tenant B's turns too -- permissive control", async () => {
    expect((await listTurns(B, "shared")).map((t) => t.id)).toEqual(["t2"])
  })

  it("filters on the business_id VALUE it was given", async () => {
    // MUTANT: `.eq("business_id", A)` hard-coded, or `.eq("step_id", businessId)`.
    // Asserting only that .eq was called would survive both.
    await listTurns(B, "shared")
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })
})

describe("getTurnByRevision", () => {
  it("will not reach across tenants for a revision number", async () => {
    // Revisions restart per step, so the same (step_id, revision) pair exists
    // in both tenants here. This is the read that reverts a page -- the wrong
    // answer overwrites one coach's page with another's draft.
    expect((await getTurnByRevision(A, "shared", 1))?.id).toBe("t1")
    expect((await getTurnByRevision(B, "shared", 1))?.id).toBe("t2") // permissive control
  })
})

describe("getDraft", () => {
  it("returns a tenant's own step and not another tenant's row by id", async () => {
    expect((await getDraft(A, "s1"))?.revision).toBe(3)
    expect(await getDraft(A, "shared")).toBeNull() // "shared" belongs to B
    expect((await getDraft(B, "shared"))?.revision).toBe(5) // permissive control
  })

  it("filters on the business_id VALUE it was given", async () => {
    await getDraft(B, "shared")
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })
})

describe("getPageTree", () => {
  it("returns a tenant's own step and not another tenant's row by id", async () => {
    expect((await getPageTree(A, "s1"))?.revision).toBe(3)
    expect(await getPageTree(A, "shared")).toBeNull() // "shared" belongs to B
    expect((await getPageTree(B, "shared"))?.revision).toBe(5) // permissive control
  })

  it("filters on the business_id VALUE it was given", async () => {
    await getPageTree(B, "shared")
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })
})

describe("appendTurn", () => {
  it("refuses to advance a step outside the caller's tenant", async () => {
    // The compare-and-swap filters business_id + id + doc_revision together,
    // so this matches zero rows -- and the stale/not-found fallback read is
    // scoped the same way, so tenant A gets "not_found" rather than a hint
    // that "shared" exists at revision 5.
    const result = await appendTurn(A, { stepId: "shared", expectedRevision: 5, role: "user", message: "hi" })
    expect(result).toEqual({ ok: false, reason: "not_found" })
  })

  it("advances the caller's own step and stamps the new turn with the caller's tenant -- permissive control", async () => {
    const result = await appendTurn(B, { stepId: "shared", expectedRevision: 5, role: "user", message: "hi" })
    expect(result).toMatchObject({ ok: true, revision: 6 })
    // The composite FK (step_id, business_id) -> funnel_steps(id, business_id)
    // means a wrong-tenant stamp here would be a foreign-key violation against
    // real Postgres, not merely a leak -- but the stamp is asserted directly
    // anyway, since this fake does not model the constraint.
    expect(capturedInserts[capturedInserts.length - 1]).toMatchObject({
      table: "funnel_step_turns",
      payload: expect.objectContaining({ step_id: "shared", business_id: B }),
    })
  })

  it("filters the compare-and-swap on the business_id VALUE it was given", async () => {
    await appendTurn(B, { stepId: "shared", expectedRevision: 5, role: "user", message: "hi" })
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })
})

describe("revertToRevision", () => {
  it("cannot revert a step outside the caller's tenant", async () => {
    // B has no turn at all under step "s1" -- it belongs to A -- so this
    // fails at the turn lookup itself, before any write is attempted.
    expect(await revertToRevision(B, { stepId: "s1", toRevision: 1 })).toEqual({
      ok: false,
      reason: "revision_not_found",
    })
  })

  it("reverts the caller's own step -- permissive control", async () => {
    const result = await revertToRevision(A, { stepId: "s1", toRevision: 1 })
    expect(result).toMatchObject({ ok: true, revision: 4 })
  })
})

describe("savePageTree", () => {
  it("refuses to save a step outside the caller's tenant", async () => {
    const result = await savePageTree(A, "shared", PAGE_TREE, 5)
    expect(result).toEqual({ ok: false, reason: "not_found" })
  })

  it("saves the caller's own step -- permissive control", async () => {
    const result = await savePageTree(B, "shared", PAGE_TREE, 5)
    expect(result).toMatchObject({ ok: true, revision: 6 })
  })

  it("filters the compare-and-swap on the business_id VALUE it was given", async () => {
    await savePageTree(B, "shared", PAGE_TREE, 5)
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })
})

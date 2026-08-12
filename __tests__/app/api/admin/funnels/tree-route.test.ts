// __tests__/app/api/admin/funnels/tree-route.test.ts
//
// The first write path into a funnel document that is not the model. Two things
// matter here and nothing else does: that it refuses a document the schema
// rejects, and that a stale revision comes back as a 409 rather than winning.
//
// `pageTreeSchema` is NOT mocked — the point of the 400 test is that the REAL
// schema refuses a real invalid tree. Mocking it would replace the thing under
// test with a restatement of what it is assumed to do.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnel-page-tree", () => ({ savePageTree: vi.fn() }))

import { PUT } from "@/app/api/admin/funnels/steps/[stepId]/tree/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { savePageTree } from "@/lib/db/funnel-page-tree"

const validTree = {
  v: 1,
  engine: "tree",
  theme: { tone: "light", accent: "accent", radius: "soft" },
  sections: [],
}

function put(body: unknown): Request {
  return new Request("http://localhost/api/admin/funnels/steps/s1/tree", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ stepId: "s1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "admin" } } as never)
  vi.mocked(canAccessAdminPath).mockResolvedValue(true)
})

describe("PUT /api/admin/funnels/steps/:id/tree", () => {
  it("saves a valid tree and returns the new revision", async () => {
    vi.mocked(savePageTree).mockResolvedValue({ ok: true, revision: 5 })

    const response = await PUT(put({ tree: validTree, revision: 4 }) as never, ctx as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revision: 5 })
    expect(savePageTree).toHaveBeenCalledWith("s1", expect.objectContaining({ engine: "tree" }), 4)
  })

  it("409s on a stale revision instead of overwriting", async () => {
    // MUTANT KILLED: mapping stale_revision onto a 500, or worse onto a retry.
    // The client cannot re-sync from a 500, so the owner would keep pressing
    // save until one of the two tabs won silently.
    vi.mocked(savePageTree).mockResolvedValue({
      ok: false,
      reason: "stale_revision",
      currentRevision: 9,
    })

    const response = await PUT(put({ tree: validTree, revision: 4 }) as never, ctx as never)

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe("stale_revision")
    expect(body.currentRevision).toBe(9)
  })

  it("400s a tree whose row contradicts its layout, without touching the DAL", async () => {
    // MUTANT KILLED: validating only the envelope and letting the document
    // through. The DAL would then be the only thing standing between a
    // malformed tree and the column, and a 500 is the wrong way to learn that.
    const bad = {
      ...validTree,
      sections: [
        {
          id: "s1",
          style: {},
          rows: [{ id: "r1", style: {}, layout: "1-1", columns: [{ id: "c1", style: {}, elements: [] }] }],
        },
      ],
    }

    const response = await PUT(put({ tree: bad, revision: 1 }) as never, ctx as never)

    expect(response.status).toBe(400)
    expect(savePageTree).not.toHaveBeenCalled()
  })

  it("400s when revision is missing", async () => {
    // MUTANT KILLED: defaulting a missing revision to 0 or to "current", which
    // turns the optimistic lock off for any client that forgets to send it.
    const response = await PUT(put({ tree: validTree }) as never, ctx as never)

    expect(response.status).toBe(400)
    expect(savePageTree).not.toHaveBeenCalled()
  })

  it("404s when the step does not exist", async () => {
    vi.mocked(savePageTree).mockResolvedValue({ ok: false, reason: "not_found" })
    const response = await PUT(put({ tree: validTree, revision: 1 }) as never, ctx as never)
    expect(response.status).toBe(404)
  })

  it("refuses a caller without admin path access", async () => {
    // MUTANT KILLED: guarding the AI route and forgetting this one. It is a
    // brand-new write path into the same documents.
    vi.mocked(canAccessAdminPath).mockResolvedValue(false)

    const response = await PUT(put({ tree: validTree, revision: 1 }) as never, ctx as never)

    expect(response.status).toBe(403)
    expect(savePageTree).not.toHaveBeenCalled()
  })

  it("refuses an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const response = await PUT(put({ tree: validTree, revision: 1 }) as never, ctx as never)
    expect(response.status).toBe(403)
    expect(savePageTree).not.toHaveBeenCalled()
  })
})

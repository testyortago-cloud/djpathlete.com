// __tests__/app/api/admin/funnels/edit-route.test.ts
//
// The inspector's write path: ops in, one document out, no model call.
//
// `applyOps` is NOT mocked. It is the thing that makes an edit transactional
// and the thing that decides what a legal op is, so mocking it would replace
// the subject with a restatement of what it is assumed to do. `appendTurn` IS
// mocked — it owns the database, not the semantics.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn(), appendTurn: vi.fn() }))

import { PUT } from "@/app/api/admin/funnels/steps/[stepId]/edit/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getDraft, appendTurn } from "@/lib/db/funnel-builder"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

function aDoc(): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "h1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: {
          headline: "Free trial week",
          primaryCta: { label: "Start", target: { kind: "url", href: "/signup" } },
        },
      },
      {
        id: "c1",
        kind: "cta",
        variant: "band",
        style: {},
        props: { headline: "Ready?", cta: { label: "Go", target: { kind: "url", href: "/signup" } } },
      },
    ],
  }
}

const goodOp = { op: "update_section", id: "h1", props: { headline: "A shorter headline" } }

function put(body: unknown): Request {
  return new Request("http://localhost/api/admin/funnels/steps/s1/edit", {
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
  vi.mocked(getDraft).mockResolvedValue({ doc: aDoc(), docInvalid: false, revision: 4 })
  vi.mocked(appendTurn).mockResolvedValue({ ok: true, revision: 5, turn: {} as never })
})

describe("PUT /api/admin/funnels/steps/:id/edit", () => {
  it("applies a batch and returns the new revision and document", async () => {
    const response = await PUT(put({ ops: [goodOp], revision: 4 }) as never, ctx as never)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.revision).toBe(5)
    expect(body.doc.sections[0].props.headline).toBe("A shorter headline")

    // Written as an `inspector` turn, not an `ai` one: the transcript is the
    // record of what changed the page, and a click changed it just as much as
    // a model turn did.
    expect(appendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        stepId: "s1",
        expectedRevision: 4,
        source: "inspector",
        doc: expect.objectContaining({ engine: "sections" }),
      }),
    )
  })

  it("leaves sections the batch did not name as the SAME objects", async () => {
    // The guarantee `applyOps` exists to make, asserted at the route boundary
    // because this is the caller that could most easily lose it — e.g. by
    // round-tripping the document through JSON.parse before storing it.
    const response = await PUT(put({ ops: [goodOp], revision: 4 }) as never, ctx as never)
    expect(response.status).toBe(200)

    const stored = vi.mocked(appendTurn).mock.calls[0][0].doc as SectionDoc
    const before = vi.mocked(getDraft).mock.results[0].value as Promise<{ doc: SectionDoc }>
    const original = (await before).doc
    expect(stored.sections[1]).toBe(original.sections[1])
  })

  it("409s on a stale revision without writing", async () => {
    // A SectionDoc is a full snapshot, so a lost update is not a merge
    // conflict — it is the page reverting to whatever the other tab had.
    vi.mocked(appendTurn).mockResolvedValue({
      ok: false,
      reason: "stale_revision",
      currentRevision: 9,
    })

    const response = await PUT(put({ ops: [goodOp], revision: 4 }) as never, ctx as never)

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe("stale_revision")
    expect(body.currentRevision).toBe(9)
  })

  it("rejects the whole batch when one op is bad, and writes nothing", async () => {
    // MUTANT KILLED: applying the ops that happen to be valid. A half-applied
    // patch is a page in a state the owner never asked for and cannot name.
    const response = await PUT(
      put({ ops: [goodOp, { op: "update_section", id: "nope", props: { headline: "x" } }], revision: 4 }) as never,
      ctx as never,
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ problems: expect.any(Array) })
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("refuses a step whose stored document cannot be read", async () => {
    // Legacy GrapesJS state. "Edit" must not mean "start a fresh document over
    // the top of the owner's page".
    vi.mocked(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 3 })

    const response = await PUT(put({ ops: [goodOp], revision: 3 }) as never, ctx as never)

    expect(response.status).toBe(422)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("refuses a step with no document at all", async () => {
    vi.mocked(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })
    const response = await PUT(put({ ops: [goodOp], revision: 0 }) as never, ctx as never)
    expect(response.status).toBe(422)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("404s when the step does not exist", async () => {
    vi.mocked(getDraft).mockResolvedValue(null)
    const response = await PUT(put({ ops: [goodOp], revision: 1 }) as never, ctx as never)
    expect(response.status).toBe(404)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("400s when revision is missing", async () => {
    // MUTANT KILLED: defaulting a missing revision, which turns the optimistic
    // lock off for any client that forgets to send it.
    const response = await PUT(put({ ops: [goodOp] }) as never, ctx as never)
    expect(response.status).toBe(400)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("400s when ops is not an array", async () => {
    const response = await PUT(put({ ops: "delete everything", revision: 4 }) as never, ctx as never)
    expect(response.status).toBe(400)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("refuses an empty batch rather than burning a revision", async () => {
    // `applyOps` treats an empty batch as a legal no-op, which is right for a
    // conversational AI turn. Here it would advance the revision — and thus
    // 409 the other tab — for an edit that changed nothing.
    const response = await PUT(put({ ops: [], revision: 4 }) as never, ctx as never)
    expect(response.status).toBe(400)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("refuses a caller without admin path access", async () => {
    vi.mocked(canAccessAdminPath).mockResolvedValue(false)
    const response = await PUT(put({ ops: [goodOp], revision: 4 }) as never, ctx as never)
    expect(response.status).toBe(403)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("refuses an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const response = await PUT(put({ ops: [goodOp], revision: 4 }) as never, ctx as never)
    expect(response.status).toBe(403)
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it("summarises the change for the transcript", async () => {
    // The chat is the record of everything that changed this page. A turn with
    // no message renders as a blank row, so the receipt is turned into prose
    // here rather than left to the UI to invent.
    await PUT(put({ ops: [goodOp], revision: 4 }) as never, ctx as never)
    const message = vi.mocked(appendTurn).mock.calls[0][0].message
    expect(message).toMatch(/hero/i)
    expect(message).toMatch(/headline/i)
  })
})

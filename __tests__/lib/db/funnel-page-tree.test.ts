// The visual builder shares ONE optimistic lock with the AI builder, because
// both write funnel_steps.doc_revision. These tests read the arguments actually
// handed to Supabase: a save that "succeeds" without the compare-and-swap looks
// identical from the outside right up until two tabs are open.

import { describe, it, expect, vi, beforeEach } from "vitest"

const eq = vi.fn()
const update = vi.fn()
const select = vi.fn()
const maybeSingle = vi.fn()
const from = vi.fn()

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({ from }) }))

beforeEach(() => {
  vi.clearAllMocks()
})

const tree = {
  v: 1 as const,
  engine: "tree" as const,
  theme: { tone: "light" as const, accent: "accent" as const, radius: "soft" as const },
  sections: [],
}

/** update().eq().eq().select() resolving to `rows`. */
function updateChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.eq = eq.mockImplementation(() => chain)
  chain.select = select.mockImplementation(async () => ({ data: rows, error: null }))
  update.mockImplementation(() => chain)
  return { update }
}

describe("savePageTree", () => {
  it("makes the revision check part of the write", async () => {
    // MUTANT KILLED: a read-then-write. It passes every single-tab test and
    // loses an entire page the first time two tabs are open, which is the
    // normal way someone edits a funnel while watching the live one.
    from.mockReturnValue(updateChain([{ doc_revision: 4 }]))
    const { savePageTree } = await import("@/lib/db/funnel-page-tree")

    await savePageTree("s1", tree, 3)

    expect(eq).toHaveBeenCalledWith("id", "s1")
    expect(eq).toHaveBeenCalledWith("doc_revision", 3)
  })

  it("writes the NEXT revision, not the expected one", async () => {
    // MUTANT KILLED: writing back `expected`, which makes the lock a no-op —
    // every subsequent save would match and clobber.
    from.mockReturnValue(updateChain([{ doc_revision: 4 }]))
    const { savePageTree } = await import("@/lib/db/funnel-page-tree")

    await savePageTree("s1", tree, 3)

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ doc_revision: 4 }))
  })

  it("reports stale_revision when nothing was updated", async () => {
    // MUTANT KILLED: treating zero updated rows as success, which is silent
    // data loss wearing a green tick.
    const chain: Record<string, unknown> = {}
    chain.eq = eq.mockImplementation(() => chain)
    chain.select = select.mockImplementation(async () => ({ data: [], error: null }))
    update.mockImplementation(() => chain)

    maybeSingle.mockResolvedValue({ data: { doc_revision: 9 }, error: null })
    const readChain: Record<string, unknown> = {}
    readChain.select = () => readChain
    readChain.eq = () => readChain
    readChain.maybeSingle = maybeSingle

    from.mockImplementation(() => ({ update, ...readChain }) as never)

    const { savePageTree } = await import("@/lib/db/funnel-page-tree")
    const result = await savePageTree("s1", tree, 3)

    expect(result).toEqual({ ok: false, reason: "stale_revision", currentRevision: 9 })
  })

  it("refuses to write a tree the schema rejects", async () => {
    // MUTANT KILLED: trusting the caller. This is the last gate before the
    // column, and a route is not the only thing that can call a DAL.
    const { savePageTree } = await import("@/lib/db/funnel-page-tree")
    const bad = { ...tree, sections: [{ id: "s1", style: {}, rows: [{ id: "r1", style: {}, layout: "1-1", columns: [] }] }] }
    await expect(savePageTree("s1", bad as never, 1)).rejects.toThrow()
  })
})

describe("getPageTree", () => {
  it("reports an unparseable stored tree instead of returning an empty page", async () => {
    // MUTANT KILLED: falling back to emptyPageTree(). The editor would open
    // blank and the owner's first save would overwrite content that was still
    // there — recoverable data destroyed by a helpful default.
    maybeSingle.mockResolvedValue({
      data: { page_tree: { nonsense: true }, doc_revision: 2 },
      error: null,
    })
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = maybeSingle
    from.mockReturnValue(chain)

    const { getPageTree } = await import("@/lib/db/funnel-page-tree")
    const draft = await getPageTree("s1")

    expect(draft).toEqual({ tree: null, revision: 2, treeInvalid: true })
  })

  it("returns a null tree without flagging invalid when the column is empty", async () => {
    // MUTANT KILLED: conflating "never used the visual builder" with "corrupt",
    // which would show a scary recovery banner on every new page.
    maybeSingle.mockResolvedValue({ data: { page_tree: null, doc_revision: 0 }, error: null })
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = maybeSingle
    from.mockReturnValue(chain)

    const { getPageTree } = await import("@/lib/db/funnel-page-tree")
    expect(await getPageTree("s1")).toEqual({ tree: null, revision: 0, treeInvalid: false })
  })
})

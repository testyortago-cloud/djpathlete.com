// __tests__/lib/funnels/sections/review/pipeline-rounds.test.ts
//
// `SECTION_REVIEW_MAX_ROUNDS` ships at 1, so the loop it controls is invisible
// to every other test in this suite — which is exactly how a tunable becomes a
// lie. Shipped without this file, raising the constant to 2 would change
// nothing, silently, and the next person to try it would conclude a second
// round does not help when in fact it never ran.
//
// So this file mocks the constant to 2 and asserts the loop really runs, really
// re-briefs from the GATE rather than from the original findings, and really
// stops early when the high-severity ones are gone.

import { describe, expect, it, vi, beforeEach } from "vitest"

const runCritics = vi.fn()
const runReviser = vi.fn()

vi.mock("@/lib/funnels/sections/review/critics", () => ({
  runCritics: (...args: unknown[]) => runCritics(...args),
  CRITICS: [],
}))
vi.mock("@/lib/funnels/sections/review/reviser", () => ({
  runReviser: (...args: unknown[]) => runReviser(...args),
}))
vi.mock("@/lib/funnels/sections/builder-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/funnels/sections/builder-config")>()),
  SECTION_REVIEW_MAX_ROUNDS: 2,
}))

import { reviewDoc } from "@/lib/funnels/sections/review/pipeline"
import { auditDoc } from "@/lib/funnels/sections/review/audit"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import type { Finding } from "@/lib/funnels/sections/review/findings"
import fixture from "./fixtures/production-consultation-page.json"

const PROD: SectionDoc = sectionDocSchema.parse(fixture) as SectionDoc

/** Closes one seam and opens another against the already-muted "how". */
const ROUND_ONE_OPS = [{ op: "update_section", id: "what-you-get", style: { tone: "muted" } }]

/** Clears what round one left behind. */
const ROUND_TWO_OPS = [
  { op: "update_section", id: "what-you-get", style: { tone: "accent" } },
  { op: "update_section", id: "questions", style: { tone: "muted" } },
]

beforeEach(() => {
  runCritics.mockReset()
  runReviser.mockReset()
  runCritics.mockResolvedValue({ findings: [], tokensUsed: 120 })
})

describe("with the round count raised", () => {
  it("really has the constant mocked to 2", async () => {
    // A GUARD ON THE MOCK ITSELF. If `vi.mock` on builder-config ever stops
    // taking effect — a path change, a hoisting change, an import ordering
    // change — every assertion in this file would silently become a
    // single-round test, and the ones that assert two rounds would fail in a
    // way that looks like a product bug rather than a broken fixture. This
    // says which it is, first, in one line.
    const { SECTION_REVIEW_MAX_ROUNDS } = await import("@/lib/funnels/sections/builder-config")
    expect(SECTION_REVIEW_MAX_ROUNDS).toBe(2)
  })

  it("revises again when high-severity findings survive the gate", async () => {
    runReviser
      .mockResolvedValueOnce({ summary: "Retoned one seam.", ops: ROUND_ONE_OPS })
      .mockResolvedValueOnce({ summary: "Fixed the seam that made.", ops: ROUND_TWO_OPS })

    const out = await reviewDoc({ doc: PROD })

    expect(runReviser).toHaveBeenCalledTimes(2)
    expect(out.changed).toBe(true)
    // Both rounds' ops are reported, not just the last.
    expect(out.ops).toHaveLength(ROUND_ONE_OPS.length + ROUND_TWO_OPS.length)
    expect(out.summary).toContain("Retoned one seam.")
    expect(out.summary).toContain("Fixed the seam that made.")
  })

  it("briefs round two from the GATE, not from the original findings", async () => {
    // MUTANT: passing `findings` again. Round two would be told to fix the
    // seams round one already closed, and would undo its own work.
    runReviser
      .mockResolvedValueOnce({ summary: "one", ops: ROUND_ONE_OPS })
      .mockResolvedValueOnce({ summary: "two", ops: ROUND_TWO_OPS })

    await reviewDoc({ doc: PROD })

    const secondBrief = runReviser.mock.calls[1][1] as Finding[]
    const seams = secondBrief.filter((finding) => finding.code === "tone-run").map((finding) => finding.sectionIds)

    // The seam round one CLOSED is gone from the brief...
    expect(seams).not.toContainEqual(["proof", "what-you-get"])
    // ...the seam round one CREATED is in it...
    expect(seams).toContainEqual(["what-you-get", "how"])
    // ...and the seam round one never touched is still there, because it is
    // still on the page. Re-briefing from the gate means reporting the page as
    // it now is, not the page as it was.
    expect(seams).toContainEqual(["voices", "questions"])
  })

  it("hands round two the REVISED document, not the original", async () => {
    runReviser
      .mockResolvedValueOnce({ summary: "one", ops: ROUND_ONE_OPS })
      .mockResolvedValueOnce({ summary: "two", ops: ROUND_TWO_OPS })

    await reviewDoc({ doc: PROD })

    const secondDoc = runReviser.mock.calls[1][0] as SectionDoc
    const whatYouGet = secondDoc.sections.find((section) => section.id === "what-you-get")
    expect(whatYouGet?.style.tone).toBe("muted")
  })

  it("stops after one round when nothing high-severity survives", async () => {
    // The early exit. Without it every page would pay two reviser calls even
    // when the first one settled it.
    runReviser.mockResolvedValueOnce({
      tokensUsed: 900,
      summary: "Cleared both seams.",
      ops: [
        { op: "update_section", id: "proof", style: { tone: "muted" } },
        { op: "update_section", id: "questions", style: { tone: "muted" } },
      ],
    })

    const out = await reviewDoc({ doc: PROD })

    expect(runReviser).toHaveBeenCalledTimes(1)
    expect(auditDoc(out.doc).filter((finding) => finding.severity === "high")).toEqual([])
  })

  it("keeps round one's work when round two fails", async () => {
    // MUTANT: returning the ORIGINAL document on any reviser failure. A later
    // round throwing would discard a first round that genuinely improved the
    // page, which is strictly worse than not having run it.
    runReviser
      .mockResolvedValueOnce({ summary: "Retoned one seam.", ops: ROUND_ONE_OPS })
      .mockRejectedValueOnce(new Error("provider down"))

    const out = await reviewDoc({ doc: PROD })

    expect(out.changed).toBe(true)
    expect(out.error).toBeNull()
    expect(out.ops).toEqual(ROUND_ONE_OPS)
  })

  it("keeps round one's work when round two emits ops the applier rejects", async () => {
    runReviser
      .mockResolvedValueOnce({ summary: "Retoned one seam.", ops: ROUND_ONE_OPS })
      .mockResolvedValueOnce({ summary: "two", ops: [{ op: "remove_section", id: "does-not-exist" }] })

    const out = await reviewDoc({ doc: PROD })

    expect(out.changed).toBe(true)
    expect(out.ops).toEqual(ROUND_ONE_OPS)
  })

  it("still reports UNCHANGED when the very first round fails", async () => {
    runReviser.mockRejectedValue(new Error("provider down"))

    const out = await reviewDoc({ doc: PROD })

    expect(out.changed).toBe(false)
    expect(out.doc).toBe(PROD)
    expect(out.error).toContain("provider down")
  })
})

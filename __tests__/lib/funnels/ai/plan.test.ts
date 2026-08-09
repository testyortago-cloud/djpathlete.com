import { describe, it, expect } from "vitest"
import { planSchema, validatePlan } from "@/lib/funnels/ai/plan"

const IDS = ["sec_a", "sec_b", "sec_c"]

function plan(ops: unknown[], extra: Record<string, unknown> = {}) {
  return { reply: "ok", ops, clarification: null, ...extra } as never
}

describe("planSchema", () => {
  it("accepts a well-formed targeted edit", () => {
    const parsed = planSchema.safeParse({
      reply: "Making the headline bigger.",
      ops: [{ op: "edit_section", sectionId: "sec_a", instruction: "bigger headline" }],
      clarification: null,
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects an unknown op", () => {
    const parsed = planSchema.safeParse({
      reply: "x", ops: [{ op: "nuke_everything" }], clarification: null,
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects more than six ops in one turn", () => {
    const ops = Array.from({ length: 7 }, () => ({
      op: "edit_section", sectionId: "sec_a", instruction: "x",
    }))
    expect(planSchema.safeParse({ reply: "x", ops, clarification: null }).success).toBe(false)
  })
})

describe("validatePlan", () => {
  it("passes a valid targeted edit through untouched", () => {
    const out = validatePlan(
      plan([{ op: "edit_section", sectionId: "sec_b", instruction: "bigger" }]),
      IDS,
    )
    expect(out.ops).toHaveLength(1)
    expect(out.clarification).toBeNull()
    expect(out.notes).toEqual([])
  })

  it("drops an op naming a section that does not exist", () => {
    const out = validatePlan(
      plan([
        { op: "edit_section", sectionId: "sec_ghost", instruction: "x" },
        { op: "edit_section", sectionId: "sec_a", instruction: "y" },
      ]),
      IDS,
    )
    expect(out.ops).toHaveLength(1)
    expect(out.ops[0]).toMatchObject({ sectionId: "sec_a" })
    expect(out.notes[0]).toContain("sec_ghost")
  })

  it("turns an all-dropped plan into a clarification rather than a silent no-op", () => {
    const out = validatePlan(plan([{ op: "edit_section", sectionId: "sec_ghost", instruction: "x" }]), IDS)
    expect(out.ops).toEqual([])
    expect(out.clarification).toBeTruthy()
  })

  it("drops a reorder that is not a permutation of the current sections", () => {
    const out = validatePlan(plan([{ op: "reorder", order: ["sec_a", "sec_b"] }]), IDS)
    expect(out.ops).toEqual([])
    expect(out.notes[0]).toContain("reorder")
  })

  it("accepts a reorder that is a permutation", () => {
    const out = validatePlan(plan([{ op: "reorder", order: ["sec_c", "sec_a", "sec_b"] }]), IDS)
    expect(out.ops).toHaveLength(1)
  })

  it("drops a reorder combined with a structural op, because the new ids are unknowable", () => {
    const out = validatePlan(
      plan([
        { op: "add_section", afterSectionId: "sec_a", kind: "proof", brief: "testimonials" },
        { op: "reorder", order: ["sec_c", "sec_a", "sec_b"] },
      ]),
      IDS,
    )
    expect(out.ops.map((o) => o.op)).toEqual(["add_section"])
    expect(out.notes.join(" ")).toContain("reorder")
  })

  it("drops an edit of a section the same plan deletes", () => {
    const out = validatePlan(
      plan([
        { op: "edit_section", sectionId: "sec_b", instruction: "x" },
        { op: "delete_section", sectionId: "sec_b" },
      ]),
      IDS,
    )
    expect(out.ops.map((o) => o.op)).toEqual(["delete_section"])
  })

  it("drops add_section ops that would exceed MAX_SECTIONS", () => {
    const many = Array.from({ length: 20 }, (_, i) => `sec_${i}`)
    const out = validatePlan(
      plan([{ op: "add_section", afterSectionId: null, kind: "x", brief: "y" }]),
      many,
    )
    expect(out.ops).toEqual([])
    expect(out.notes.join(" ")).toContain("20")
  })

  it("keeps regenerate_page only when it is the only op", () => {
    const out = validatePlan(
      plan([
        { op: "regenerate_page", brief: "sales page for the camp" },
        { op: "edit_section", sectionId: "sec_a", instruction: "x" },
      ]),
      IDS,
    )
    expect(out.ops.map((o) => o.op)).toEqual(["regenerate_page"])
    expect(out.notes.join(" ")).toContain("regenerate")
  })

  it("keeps a clarification and discards ops when the planner asked a question", () => {
    const out = validatePlan(
      plan([{ op: "edit_section", sectionId: "sec_a", instruction: "x" }], {
        clarification: "Which headline did you mean?",
      }),
      IDS,
    )
    expect(out.ops).toEqual([])
    expect(out.clarification).toBe("Which headline did you mean?")
  })
})

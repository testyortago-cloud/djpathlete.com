// __tests__/lib/funnels/publish-plan.test.ts
//
// EVERY TEST NAMES THE MUTANT IT KILLS. Zero mocks: the planner is a leaf that
// takes its gate as a parameter precisely so its decisions can be driven
// directly rather than through a catalogue.

import { describe, it, expect } from "vitest"
import { funnelPublishPlan, type StepToPublish } from "@/lib/funnels/publish-plan"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const DOC = { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] } as unknown as SectionDoc

function step(overrides: Partial<StepToPublish> = {}): StepToPublish {
  return { id: "s1", name: "Signup", position: 0, doc: DOC, hasPublishedVersion: false, ...overrides }
}

/** Everything publishes. */
const CLEAN = () => ({ ok: true, blockers: [] })

describe("funnelPublishPlan", () => {
  it("publishes every step that has a document", () => {
    const plan = funnelPublishPlan(
      [step({ id: "a", position: 0 }), step({ id: "b", name: "Thanks", position: 1 })],
      CLEAN,
    )
    expect(plan.ok).toBe(true)
    expect(plan.problems).toEqual([])
    // MUTANT: returning only the first step. Asserting a COUNT would let a
    // planner that publishes one page pass if it also invented a second entry,
    // so the ids themselves are the assertion.
    expect(plan.publish.map((entry) => entry.stepId)).toEqual(["a", "b"])
  })

  it("orders the publish list by position, not by input order", () => {
    const plan = funnelPublishPlan(
      [step({ id: "late", position: 2 }), step({ id: "first", position: 0 }), step({ id: "mid", position: 1 })],
      CLEAN,
    )
    // MUTANT: dropping the sort. The entry page must be written first.
    expect(plan.publish.map((entry) => entry.stepId)).toEqual(["first", "mid", "late"])
  })

  it("REFUSES when a step has never been built", () => {
    const plan = funnelPublishPlan(
      [step({ id: "a" }), step({ id: "b", name: "Checkout", doc: null, hasPublishedVersion: false })],
      CLEAN,
    )
    // MUTANT: treating a blank page as publishable (skip-and-continue). This is
    // the all-or-nothing decision the owner made, and the whole reason the
    // route exists — so `ok` AND `publish` are both asserted: a planner that
    // reports the problem and still hands back page "a" to write would ship a
    // live funnel with a dead end in it.
    expect(plan.ok).toBe(false)
    expect(plan.publish).toEqual([])
    expect(plan.problems).toEqual([
      { stepId: "b", stepName: "Checkout", problems: ["Checkout has no content yet."], blank: true },
    ])
  })

  it("does NOT refuse a legacy step that has no document but is already published", () => {
    const plan = funnelPublishPlan(
      [step({ id: "a" }), step({ id: "legacy", name: "Old page", doc: null, hasPublishedVersion: true })],
      CLEAN,
    )
    // MUTANT: `if (!step.doc) problem(...)` without the published-version arm.
    // A GrapesJS step predating the section editor has no SectionDoc and is
    // serving something real; refusing it freezes out every funnel older than
    // migration 00203.
    expect(plan.ok).toBe(true)
    expect(plan.problems).toEqual([])
    // ...and it is not republished either — there is no document to render.
    expect(plan.publish.map((entry) => entry.stepId)).toEqual(["a"])
  })

  it("carries a blocked page's blockers under that page's own name", () => {
    const gate = (doc: SectionDoc) =>
      doc === DOC ? { ok: false, blockers: ["A button points at a program that no longer exists."] } : { ok: true, blockers: [] }
    const plan = funnelPublishPlan([step({ id: "b", name: "Offer" })], gate)
    // MUTANT: flattening every page's blockers into one list. The owner has to
    // know WHICH page to open, and a bare blocker string does not say.
    expect(plan.problems).toEqual([
      {
        stepId: "b",
        stepName: "Offer",
        problems: ["A button points at a program that no longer exists."],
        blank: false,
      },
    ])
    expect(plan.ok).toBe(false)
  })

  it("reports every bad page, not just the first", () => {
    const plan = funnelPublishPlan(
      [step({ id: "a", name: "One", doc: null }), step({ id: "b", name: "Two", doc: null, position: 1 })],
      CLEAN,
    )
    // MUTANT: an early `return` on the first problem. Being sent back twice to
    // fix one page at a time is the friction this feature exists to remove.
    expect(plan.problems.map((problem) => problem.stepId)).toEqual(["a", "b"])
  })

  it("is ok on a funnel with no steps at all", () => {
    // Not a problem to report and nothing to write. The route still refuses it
    // (see Task 2) — but that is the ROUTE's rule about funnels, not the
    // planner's about pages, and putting it here would make `problems` mean two
    // different things.
    expect(funnelPublishPlan([], CLEAN)).toEqual({ ok: true, publish: [], problems: [] })
  })

  it("lets a throwing gate escape", () => {
    const boom = () => { throw new Error("catalogue truncated") }
    // MUTANT: a try/catch per step that degrades to `{ok:true}`. `resolveDoc`
    // throws deliberately so a caller cannot accidentally unblock publish;
    // swallowing it here is the exact fail-open the gate exists to prevent.
    expect(() => funnelPublishPlan([step()], boom)).toThrow("catalogue truncated")
  })
})

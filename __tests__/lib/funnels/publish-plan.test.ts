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

  it("does NOT let a published version rescue a page the gate blocks", () => {
    // THE OTHER SIDE OF THE TEST ABOVE, and the one that says where the
    // published-version arm STOPS.
    //
    // MUTANT: hoisting `if (step.hasPublishedVersion) continue` to the top of
    // the loop — the obvious reading of "a page that is already serving
    // something real does not hold up a publish", and a reading the test above
    // passes happily because its legacy step has no document to gate. It is
    // wrong: `hasPublishedVersion` excuses a MISSING DOCUMENT and nothing else.
    // A step with a real `SectionDoc` whose CTA points at a deleted program is
    // blocked whether or not an older snapshot of it is live — publishing over
    // it is exactly what a funnel publish is for, and skipping it would put a
    // funnel live around a page with a dead button in it.
    //
    // The layout's queue depends on the same boundary from the other end
    // (`app/(admin)/admin/funnels/[id]/edit/layout.tsx`), so this is the line
    // both layers are written against.
    const plan = funnelPublishPlan(
      [step({ id: "live-but-broken", name: "Offer", hasPublishedVersion: true })],
      () => ({ ok: false, blockers: ['Its buy button points at "Comeback Cod", which does not exist.'] }),
    )

    expect(plan.ok).toBe(false)
    expect(plan.publish).toEqual([])
    expect(plan.problems).toEqual([
      {
        stepId: "live-but-broken",
        stepName: "Offer",
        problems: ['Its buy button points at "Comeback Cod", which does not exist.'],
        // `blank: false` — it has content, it is just wrong. The UI branches on
        // this to offer "Generate it now", which would be nonsense here.
        blank: false,
      },
    ])
  })

  it("carries a blocked page's blockers under that page's own name", () => {
    // Two DISTINCT blocked docs, not one: a flattening bug that merges every
    // blocked page's blockers into whichever entry got created first is
    // indistinguishable from correct per-page scoping when only one page in
    // the plan is blocked — a single-step version of this test cannot fail
    // for the reason its comment claims.
    const OFFER_DOC = DOC
    const UPSELL_DOC = { ...DOC } as SectionDoc
    const gate = (doc: SectionDoc) => {
      if (doc === OFFER_DOC) return { ok: false, blockers: ["A button points at a program that no longer exists."] }
      if (doc === UPSELL_DOC) return { ok: false, blockers: ["Missing a headline."] }
      return { ok: true, blockers: [] }
    }
    const plan = funnelPublishPlan(
      [
        step({ id: "b", name: "Offer", doc: OFFER_DOC, position: 0 }),
        step({ id: "c", name: "Upsell", doc: UPSELL_DOC, position: 1 }),
      ],
      gate,
    )
    // MUTANT: flattening every page's blockers into one list. The owner has to
    // know WHICH page to open, and a bare blocker string does not say.
    expect(plan.problems).toEqual([
      {
        stepId: "b",
        stepName: "Offer",
        problems: ["A button points at a program that no longer exists."],
        blank: false,
      },
      {
        stepId: "c",
        stepName: "Upsell",
        problems: ["Missing a headline."],
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

  // ---------------------------------------------------------------------------
  // The connectivity check — injected, for the same reason the gate is.
  //
  // "This page leads nowhere" was a rail WARNING with Publish still enabled, so
  // every already-built funnel with a dead end could go live: the owner reaches
  // page one, submits the form, and the funnel stops in front of a thank-you
  // page that was built and never linked (audit 2026-09-13 §3.1). Computing it
  // needs `funnelConnections`, which needs every page at once — so it arrives
  // as a parameter and this module stays a leaf.
  // ---------------------------------------------------------------------------
  it("REFUSES a page the connectivity check says leads nowhere, under that page's name", () => {
    // MUTANT: ignoring the third argument.
    const plan = funnelPublishPlan(
      [step({ id: "a", name: "Signup", position: 1 }), step({ id: "b", name: "Thanks", position: 2 })],
      CLEAN,
      (stepId) =>
        stepId === "a"
          ? ["Signup leads nowhere: no button or form on it goes to another page of this funnel."]
          : [],
    )
    expect(plan.ok).toBe(false)
    // Both, for the reason the blank-page test above gives: a planner that
    // reports the problem and still hands back page "b" would publish half a
    // funnel.
    expect(plan.publish).toEqual([])
    expect(plan.problems).toEqual([
      { stepId: "a", stepName: "Signup", problems: [expect.stringContaining("leads nowhere")], blank: false },
    ])
  })

  it("merges connectivity problems into a page the gate ALSO blocked, as one entry", () => {
    // MUTANT: pushing a SECOND problem entry for the same step. The UI keys its
    // list on the page, so two entries render the same page twice and the
    // owner fixes one and is sent back for the other.
    const plan = funnelPublishPlan(
      [step({ id: "a", name: "Signup", position: 1 }), step({ id: "b", name: "Thanks", position: 2 })],
      (doc) => (doc === DOC ? { ok: false, blockers: ["Missing a headline."] } : { ok: true, blockers: [] }),
      (stepId) => (stepId === "a" ? ["Signup leads nowhere."] : []),
    )
    expect(plan.problems.filter((problem) => problem.stepId === "a")).toHaveLength(1)
    expect(plan.problems[0].problems).toEqual(["Missing a headline.", "Signup leads nowhere."])
  })

  it("does NOT ask the connectivity check about a page that was never built", () => {
    // MUTANT: calling it for every step. A blank page is ALREADY reported as a
    // blank page, and "it leads nowhere" is both true and useless about a page
    // with nothing on it — it would send the owner to the connect button when
    // what they need is "Generate it now", which `blank` selects.
    const asked: string[] = []
    funnelPublishPlan(
      [step({ id: "a", name: "Signup", doc: null, position: 1 }), step({ id: "b", name: "Thanks", position: 2 })],
      CLEAN,
      (stepId) => {
        asked.push(stepId)
        return []
      },
    )
    expect(asked).toEqual(["b"])
  })

  it("publishes as before when no connectivity check is supplied", () => {
    // MUTANT: a required third parameter, or a default that reports a problem.
    // Every other caller of this planner passes two arguments, and a default
    // that refused would freeze publishing for all of them.
    const plan = funnelPublishPlan([step({ id: "a" }), step({ id: "b", name: "Thanks", position: 1 })], CLEAN)
    expect(plan.ok).toBe(true)
    expect(plan.publish.map((entry) => entry.stepId)).toEqual(["a", "b"])
  })

  it("lets a throwing gate escape", () => {
    const boom = () => { throw new Error("catalogue truncated") }
    // MUTANT: a try/catch per step that degrades to `{ok:true}`. `resolveDoc`
    // throws deliberately so a caller cannot accidentally unblock publish;
    // swallowing it here is the exact fail-open the gate exists to prevent.
    expect(() => funnelPublishPlan([step()], boom)).toThrow("catalogue truncated")
  })
})

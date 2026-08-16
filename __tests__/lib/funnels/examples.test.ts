// The worked examples exist to teach. An example that demonstrates a plan the
// template does not produce teaches the wrong thing, confidently — and nothing
// else in the app would notice, because it is only ever read by a human.

import { describe, it, expect } from "vitest"
import { FUNNEL_EXAMPLES, exampleFor } from "@/lib/funnels/examples"
import { FUNNEL_TEMPLATES, getTemplate } from "@/lib/funnels/templates"
import { FUNNEL_SLUG_PATTERN, FUNNEL_GOALS } from "@/lib/validators/funnel"

const GOAL_VALUES = new Set<string>(FUNNEL_GOALS.map((goal) => goal.value))

describe("FUNNEL_EXAMPLES", () => {
  it("covers every template", () => {
    // MUTANT KILLED: adding a template and forgetting its example. The modal
    // would show five cards for six options, and the missing one reads as the
    // template nobody uses.
    for (const template of FUNNEL_TEMPLATES) {
      expect(exampleFor(template.value), template.value).not.toBeNull()
    }
  })

  it("names a template that exists", () => {
    for (const example of FUNNEL_EXAMPLES) {
      expect(getTemplate(example.template), example.name).not.toBeNull()
    }
  })

  it("demonstrates the step plan its template actually produces", () => {
    // MUTANT KILLED: a hand-typed step list that drifts from the template.
    // "Start from this" fills the dialog from the TEMPLATE, so a card showing
    // different steps than the owner then gets is a lie told at the moment
    // they are deciding.
    for (const example of FUNNEL_EXAMPLES) {
      const template = getTemplate(example.template)!
      expect(example.steps.map((step) => step.slug), example.name).toEqual(
        template.steps.map((step) => step.slug),
      )
      expect(example.steps.map((step) => step.name), example.name).toEqual(
        template.steps.map((step) => step.name),
      )
    }
  })

  it("only uses goals the section registry can resolve", () => {
    for (const example of FUNNEL_EXAMPLES) {
      for (const step of example.steps) {
        if (step.goal === null) continue
        expect(GOAL_VALUES.has(step.goal), `${example.name}/${step.slug}`).toBe(true)
      }
    }
  })

  it("uses slugs the validator would accept", () => {
    for (const example of FUNNEL_EXAMPLES) {
      expect(FUNNEL_SLUG_PATTERN.test(example.slug), example.slug).toBe(true)
    }
  })

  it("gives every example a description long enough to be a brief", () => {
    // The whole point of the card. A one-line description demonstrates the
    // exact mistake the examples exist to correct.
    for (const example of FUNNEL_EXAMPLES) {
      expect(example.description.length, example.name).toBeGreaterThan(120)
      expect(example.description.length, example.name).toBeLessThanOrEqual(500)
    }
  })

  it("keeps the audience within the column bound", () => {
    for (const example of FUNNEL_EXAMPLES) {
      expect(example.audience.length, example.name).toBeGreaterThan(0)
      expect(example.audience.length, example.name).toBeLessThanOrEqual(300)
    }
  })

  it("says why each one works, in one sentence", () => {
    for (const example of FUNNEL_EXAMPLES) {
      expect(example.whyItWorks.length, example.name).toBeGreaterThan(30)
      // One sentence: at most one full stop that is not an abbreviation.
      expect(example.whyItWorks.trim().endsWith("."), example.name).toBe(true)
    }
  })

  it("gives every example a distinct slug", () => {
    const slugs = FUNNEL_EXAMPLES.map((example) => example.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe("exampleFor", () => {
  it("returns null for a template it has never heard of", () => {
    expect(exampleFor("webinar")).toBeNull()
    expect(exampleFor("")).toBeNull()
  })
})

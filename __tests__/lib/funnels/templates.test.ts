// The registry is the one place that knows what "an event funnel" means. If it
// is wrong, every other part of this feature is wrong in the same way and none
// of them will say so — the dialog renders the bad plan, the validator accepts
// it because it reads the same array, and the funnel is created. So these tests
// check the DATA, not just the shape.

import { describe, it, expect } from "vitest"
import {
  FUNNEL_TEMPLATES,
  MAX_FUNNEL_STEPS,
  getTemplate,
  templateAsks,
  type TemplateAsk,
} from "@/lib/funnels/templates"
import { FUNNEL_SLUG_PATTERN, FUNNEL_NAME_MIN_LENGTH } from "@/lib/validators/funnel"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"

const GOAL_VALUES = new Set(FUNNEL_GOALS.map((goal) => goal.value))

/**
 * `as const satisfies` narrows each template's `asks` to its own literal tuple,
 * so `["audience"].includes("offer")` is a type error rather than the `false`
 * these tests are asking about. Widening at the read site keeps the registry's
 * narrowing — which is what makes a typo in `asks` a compile error — while
 * letting the tests ask the question.
 */
const asksOf = (template: { asks: readonly TemplateAsk[] }): readonly string[] => template.asks

describe("FUNNEL_TEMPLATES", () => {
  it("gives every template a unique id", () => {
    const ids = FUNNEL_TEMPLATES.map((template) => template.value)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("starts every template at the entry slug", () => {
    // MUTANT KILLED: a template whose first step is not `index`. The funnel's
    // own address is /go/<slug>, which is served by the entry step — so a
    // template starting anywhere else creates a funnel whose front door 404s.
    for (const template of FUNNEL_TEMPLATES) {
      expect(template.steps[0].slug, template.value).toBe("index")
    }
  })

  it("keeps step slugs unique inside each template", () => {
    // Uniqueness is PER FUNNEL, not global — two funnels may both have a
    // thank-you, one may not have two.
    for (const template of FUNNEL_TEMPLATES) {
      const slugs = template.steps.map((step) => step.slug)
      expect(new Set(slugs).size, template.value).toBe(slugs.length)
    }
  })

  it("only uses slugs the validator would accept", () => {
    // MUTANT KILLED: a slug with an underscore or capital, which the dialog
    // would display happily and the server would 400 on submit.
    for (const template of FUNNEL_TEMPLATES) {
      for (const step of template.steps) {
        expect(FUNNEL_SLUG_PATTERN.test(step.slug), `${template.value}/${step.slug}`).toBe(true)
      }
    }
  })

  it("only uses goals the section registry can resolve", () => {
    for (const template of FUNNEL_TEMPLATES) {
      for (const step of template.steps) {
        if (step.goal === null) continue
        expect(GOAL_VALUES.has(step.goal), `${template.value}/${step.slug}`).toBe(true)
      }
    }
  })

  it("gives every step a name the validator would accept", () => {
    for (const template of FUNNEL_TEMPLATES) {
      for (const step of template.steps) {
        expect(step.name.trim().length, `${template.value}/${step.slug}`).toBeGreaterThanOrEqual(
          FUNNEL_NAME_MIN_LENGTH,
        )
      }
    }
  })

  it("asks for an offer exactly when it names an offer catalogue", () => {
    // MUTANT KILLED: the two halves of the offer rule drifting apart. A
    // template that asks for an offer but names no catalogue renders a picker
    // with nothing to pick; one that names a catalogue but never asks silently
    // ignores whatever is chosen.
    for (const template of FUNNEL_TEMPLATES) {
      expect(asksOf(template).includes("offer"), template.value).toBe(template.offerKind !== null)
    }
  })

  it("asks to notify only when some step actually captures a lead", () => {
    // MUTANT KILLED: asking every template for notification recipients. A pure
    // checkout funnel's receipt IS the notification; asking again is noise in
    // the dialog this redesign exists to quieten.
    for (const template of FUNNEL_TEMPLATES) {
      const capturesLeads = template.steps.some((step) => step.goal === "leads")
      expect(asksOf(template).includes("notify"), template.value).toBe(capturesLeads)
    }
  })

  it("stays within the step bound the validator enforces", () => {
    for (const template of FUNNEL_TEMPLATES) {
      expect(template.steps.length, template.value).toBeGreaterThanOrEqual(1)
      expect(template.steps.length, template.value).toBeLessThanOrEqual(MAX_FUNNEL_STEPS)
    }
  })

  it("asks nothing it has no field for", () => {
    const known = new Set(["audience", "offer", "dates", "notify"])
    for (const template of FUNNEL_TEMPLATES) {
      for (const ask of template.asks) expect(known.has(ask), `${template.value}/${ask}`).toBe(true)
    }
  })

  it("offers a single-step template so 'no template' is still reachable", () => {
    // The old behaviour — one funnel, one step, no assumptions — must remain
    // available, or this redesign removes a thing people were relying on.
    const scratch = getTemplate("scratch")
    expect(scratch).not.toBeNull()
    expect(scratch!.steps).toHaveLength(1)
  })
})

describe("getTemplate", () => {
  it("returns null for an unknown id rather than throwing", () => {
    // MUTANT KILLED: assuming the stored template is always one this build
    // knows. The column has no CHECK constraint precisely so templates can be
    // retired, so a funnel created last month may name one that is gone.
    expect(getTemplate("no-such-template")).toBeNull()
    expect(getTemplate(null)).toBeNull()
    expect(getTemplate(undefined)).toBeNull()
    expect(getTemplate("")).toBeNull()
  })

  it("finds each template by its own id", () => {
    for (const template of FUNNEL_TEMPLATES) {
      expect(getTemplate(template.value)?.value).toBe(template.value)
    }
  })
})

describe("templateAsks", () => {
  it("answers no for an unknown template rather than throwing", () => {
    expect(templateAsks("no-such-template", "dates")).toBe(false)
    expect(templateAsks(null, "dates")).toBe(false)
  })

  it("is the same answer the registry gives", () => {
    expect(templateAsks("event", "dates")).toBe(true)
    expect(templateAsks("leads", "dates")).toBe(false)
    expect(templateAsks("program", "offer")).toBe(true)
    expect(templateAsks("booking", "offer")).toBe(false)
  })
})

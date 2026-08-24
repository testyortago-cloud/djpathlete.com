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
    // `quiz` joined this list when the quiz template did. The guard is the
    // point: an ask with no field is a question the dialog never renders and
    // the validator silently ignores, and this test is what stops one landing.
    const known = new Set(["audience", "offer", "dates", "notify", "quiz"])
    for (const template of FUNNEL_TEMPLATES) {
      for (const ask of template.asks) expect(known.has(ask), `${template.value}/${ask}`).toBe(true)
    }
  })

  it("sells the camp on the register step rather than a page of its own", () => {
    // MUTANT KILLED: putting a "Payment" step back into the event plan. The
    // register form takes the money itself — it writes the signup, then hands
    // off to Stripe — so a payment step is a whole page whose only job is a CTA
    // that leaves the funnel for the camp's own page, where the parent re-types
    // everything they just filled in. That is the bug the checkout work fixed,
    // and a template naming the step would rebuild it for every new funnel.
    const event = getTemplate("event")!
    expect(event.steps.map((step) => step.slug)).toEqual(["index", "register", "thank-you"])

    // And the step that collects the parent is a FORM, not another link-out:
    // `event` is the goal whose whole meaning is "links to a camp or clinic
    // signup", which is precisely what this step replaces.
    expect(event.steps.find((step) => step.slug === "register")!.goal).toBe("leads")
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

// ---------------------------------------------------------------------------
// The quiz template — added by the quiz-funnel-creator work.
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §2
// ---------------------------------------------------------------------------

describe("the quiz template", () => {
  const quiz = FUNNEL_TEMPLATES.find((template) => template.value === "quiz")!

  it("exists, so the create dialog can offer it", () => {
    expect(quiz).toBeTruthy()
  })

  it("is one step, and that step is the front door", () => {
    // MUTANT: add a thank-you step. The intro, the details gate and the result
    // are all states of the quiz island inside the one page, so a second step
    // is a page a visitor never reaches.
    expect(quiz.steps).toHaveLength(1)
    expect(quiz.steps[0].slug).toBe("index")
  })

  it("asks for a quiz, and for nothing that has no reader", () => {
    expect(asksOf(quiz)).toContain("quiz")
    // The Red/Orange operator alert goes to business settings' reply_to, not
    // to a funnel's notify_emails, so asking here would store an address that
    // nothing on the quiz path ever reads.
    expect(asksOf(quiz)).not.toContain("notify")
    expect(asksOf(quiz)).not.toContain("offer")
    expect(quiz.offerKind).toBeNull()
  })

  it("gives its step no goal, because every FunnelGoal names a CTA target", () => {
    // A quiz is not a CTA target. What the step is for is written on the step
    // itself, as a `quiz` section naming its quiz.
    expect(quiz.steps[0].goal).toBeNull()
  })

  it("is the only template that asks for a quiz", () => {
    const asking = FUNNEL_TEMPLATES.filter((template) => asksOf(template).includes("quiz"))
    expect(asking.map((template) => template.value)).toEqual(["quiz"])
  })
})

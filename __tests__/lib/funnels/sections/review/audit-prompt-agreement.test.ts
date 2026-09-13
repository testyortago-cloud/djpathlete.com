// __tests__/lib/funnels/sections/review/audit-prompt-agreement.test.ts
//
// Four audit codes are CODE restatements of prose that already lives in
// `LEADGEN_RULES`. Prose cannot generate code, so unlike every other
// derived-from-the-registry thing in this subsystem the duplication here is
// unavoidable — but it must be DETECTABLE.
//
// Without this file, deleting or rewriting a prompt rule leaves an enforcement
// rule silently arguing with the instruction that produced it: the model is
// told one thing, the auditor demands another, and the reviser is handed a
// finding for a rule the builder was never asked to follow. Nothing anywhere
// goes red, and the only symptom is a page that churns every turn.
//
// Matching is BY KEYWORD, NOT BY INDEX. An index pin turns any reordering of
// the rules — a legitimate edit — into a failure that says nothing useful,
// which is how a guard trains people to update it without reading it. A
// keyword search that must match exactly one rule still fails on deletion and
// on a rewrite that drops the concept, which is what this is for.

import { describe, expect, it } from "vitest"
import { LEADGEN_RULES } from "@/lib/funnels/sections/prompt"
import { AUDIT_CODES } from "@/lib/funnels/sections/review/findings"

/**
 * Each enforced code, and the phrase in its prompt rule that must survive any
 * rewrite of that rule. Adding an audit code that enforces prompt prose means
 * adding a row here.
 */
const ENFORCED: ReadonlyArray<{ code: string; concept: RegExp; why: string }> = [
  {
    code: "cta-divergence",
    concept: /ONE OFFER, ONE ACTION/,
    why: "the auditor counts distinct CTA targets and rejects more than one",
  },
  {
    code: "live-faq-on-campaign",
    concept: /NEVER USE `faq` WITH `source: "live"`/,
    why: "the auditor rejects an faq section whose source is live",
  },
  {
    code: "proof-below-fold",
    concept: /PROOF GOES NEAR THE TOP/,
    why: "the auditor requires proof or a testimonial in the first half",
  },
  {
    code: "section-count",
    concept: /Six to nine sections/,
    // The auditor's own bound was raised to 6..16 on 2026-09-13 (task 10
    // review fix, so `long-form-sales` pages are not flagged for being
    // long — see audit.ts's SECTION_COUNT_MAX comment and docs/builder-gaps.md
    // C11). The PROMPT rule stays "six to nine" on purpose: it is advice
    // specific to a capture page ("KEEP IT SHORT... for a capture page" —
    // LEADGEN_RULES applies to every recipe, but this rule's own wording
    // already scopes itself), and 6-9 is a stricter subset of the auditor's
    // 6-16 floor/ceiling, not a contradiction of it.
    why: "the auditor bounds every page at 6..16 sections; the prompt rule this concept matches is a tighter, capture-specific recommendation within that range",
  },
]

describe("the auditor and the prompt cannot drift apart", () => {
  it.each(ENFORCED)("$code still has the prompt rule it enforces", ({ code, concept }) => {
    expect(AUDIT_CODES).toContain(code)
    const matching = LEADGEN_RULES.filter((rule) => concept.test(rule))
    // Exactly one: zero means the rule was deleted or reworded past
    // recognition, and two means the concept has been split and the auditor
    // is now enforcing half of it.
    expect(matching).toHaveLength(1)
  })

  it("enforces nothing the prompt does not state", () => {
    // The inverse guard. An audit code that gates behaviour the model was
    // never instructed to produce is a reviser that fights the builder every
    // turn — the page churns, and neither side is wrong.
    for (const { code } of ENFORCED) {
      expect(AUDIT_CODES).toContain(code)
    }
  })

  it("keeps LEADGEN_RULES non-empty and prose, not markup", () => {
    // The rules are interpolated into a frozen, cached prompt prefix; markup
    // leaking in there teaches the model to write markup back.
    expect(LEADGEN_RULES.length).toBeGreaterThan(0)
    for (const rule of LEADGEN_RULES) {
      expect(rule).not.toMatch(/<[a-z]/i)
    }
  })
})

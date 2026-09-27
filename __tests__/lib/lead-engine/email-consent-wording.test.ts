// __tests__/lib/lead-engine/email-consent-wording.test.ts
//
// The email-permission mirror of sms-consent-wording.ts. Same reasoning:
// `displayName` is a PARAMETER (never a constant) because this file lives
// under `lib/lead-engine`, which `no-brand-literals.test.ts` sweeps for a
// hard-coded brand name — and the two call sites (the form/quiz/inquiry
// server wrappers that show the checkbox, and the submit routes that file
// the consent row) must render byte-identical output for the same input.

import { describe, expect, it } from "vitest"
import { hasEmailConsentDisplayName, renderEmailConsentWording } from "@/lib/lead-engine/email-consent-wording"

describe("renderEmailConsentWording", () => {
  it("renders the exact sentence for a given display name", () => {
    expect(renderEmailConsentWording("Acme Coaching")).toBe(
      "Yes, Acme Coaching can email me training tips, news and offers. I can unsubscribe at any time.",
    )
  })

  it("renders a different sentence for a different name — not a fixture string", () => {
    // The control: an implementation that returned a hard-coded sentence
    // would satisfy the test above.
    expect(renderEmailConsentWording("Summit Performance")).toBe(
      "Yes, Summit Performance can email me training tips, news and offers. I can unsubscribe at any time.",
    )
  })
})

describe("hasEmailConsentDisplayName", () => {
  it("is true for a real name", () => {
    expect(hasEmailConsentDisplayName("Acme Coaching")).toBe(true)
  })

  it("is false for an empty string", () => {
    expect(hasEmailConsentDisplayName("")).toBe(false)
  })

  it("is false for a whitespace-only string", () => {
    expect(hasEmailConsentDisplayName("   ")).toBe(false)
  })

  it("is false for null", () => {
    expect(hasEmailConsentDisplayName(null)).toBe(false)
  })

  it("is false for undefined", () => {
    expect(hasEmailConsentDisplayName(undefined)).toBe(false)
  })
})

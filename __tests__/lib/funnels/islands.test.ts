// Stage 0 safety hardening for lib/funnels/islands.ts:
//  1. redirectUrl must be scoped to a site path or an https URL on an
//     allowlisted host — SAFE_LINK alone only closes the scheme hole
//     (javascript:) and the protocol-relative hole (//evil.example); an
//     arbitrary third-party https host still passed until this test. The
//     allowlist is the owner's own domain PLUS calendly.com/www.calendly.com,
//     which commit ed8bbfdc's message names as a deliberate exception
//     ("legitimate thank-you pages live off-site (Calendly)") — not every
//     third-party host, only that one.
//  2. checkoutIslandSchema.productId must be required only when it is
//     actually used — CheckoutIsland.tsx discards it entirely for
//     productKind "session_pack".
import { describe, it, expect } from "vitest"
import {
  CHECKOUT_REQUIRED_ROLES,
  FORM_FIELD_ROLES,
  formIslandSchema,
  checkoutIslandSchema,
} from "@/lib/funnels/islands"

describe("formIslandSchema redirectUrl", () => {
  const base = {
    formKey: "optin",
    fields: [{ name: "email", label: "Email", type: "email" as const }],
    successMode: "redirect" as const,
  }

  describe("bypasses that must be rejected", () => {
    const bad = [
      ["javascript:alert(1)", "javascript: scheme"],
      ["//evil.example", "protocol-relative (reads as a path, navigates off-site)"],
      ["https://attacker.example/", "well-formed https URL on a third-party host"],
    ] as const

    it.each(bad)("rejects %s (%s)", (value) => {
      const result = formIslandSchema.safeParse({ ...base, redirectUrl: value })
      expect(result.success).toBe(false)
    })
  })

  describe("legitimate values that must still be allowed", () => {
    const good = [
      "/thanks",
      "https://www.darrenjpaul.com/x",
      "https://darrenjpaul.com/y",
      // Owner policy exception (ed8bbfdc), not an oversight: a redirect to a
      // Calendly thank-you/booking page is a named-legitimate workflow.
      "https://calendly.com/djp",
      "https://www.calendly.com/djp",
    ]

    it.each(good)("allows %s", (value) => {
      const result = formIslandSchema.safeParse({ ...base, redirectUrl: value })
      expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
    })
  })

  it("names the allowed hosts in the rejection message, so a Typeform URL gets an actionable error", () => {
    const result = formIslandSchema.safeParse({
      ...base,
      redirectUrl: "https://typeform.com/to/abc123",
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const messages = result.error.issues.map((issue) => issue.message).join(" | ")
    expect(messages).toContain("darrenjpaul.com")
    expect(messages).toContain("calendly.com")
  })

  it("fails closed instead of throwing on a malformed absolute-looking value", () => {
    // new URL() throws on inputs like "https://" (well-formed prefix, no
    // host). The host check must catch that itself and report it as a Zod
    // issue, not let an uncaught exception escape safeParse.
    for (const value of ["https://", "https:///no-host"]) {
      expect(() => formIslandSchema.safeParse({ ...base, redirectUrl: value })).not.toThrow()
      expect(formIslandSchema.safeParse({ ...base, redirectUrl: value }).success).toBe(false)
    }
  })

  it("never calls new URL() on a root-relative path", () => {
    // A root-relative path is legitimate and common (every "/thanks" style
    // redirect). It must short-circuit before the host check ever runs
    // new URL(), which throws on relative input.
    expect(() =>
      formIslandSchema.safeParse({ ...base, redirectUrl: "/thanks" }),
    ).not.toThrow()
  })
})

describe("checkoutIslandSchema productId", () => {
  const VALID_UUID = "11111111-1111-4111-8111-111111111111"

  it("is required when productKind is program", () => {
    const result = checkoutIslandSchema.safeParse({ productKind: "program" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((issue) => issue.path.join(".") === "productId")).toBe(true)
  })

  it("is optional when productKind is session_pack, which the component never reads it for", () => {
    const result = checkoutIslandSchema.safeParse({ productKind: "session_pack" })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("still enforces UUID format when a productId is supplied", () => {
    const result = checkoutIslandSchema.safeParse({
      productKind: "program",
      productId: "not-a-uuid",
    })
    expect(result.success).toBe(false)
  })

  it("accepts a fully configured program checkout", () => {
    const result = checkoutIslandSchema.safeParse({
      productKind: "program",
      productId: VALID_UUID,
    })
    expect(result.success).toBe(true)
  })

  it("accepts a session_pack checkout that also supplies a valid productId", () => {
    const result = checkoutIslandSchema.safeParse({
      productKind: "session_pack",
      productId: VALID_UUID,
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The field-role contract (2026-08-17-funnel-event-checkout-design.md §4).
//
// A form that takes payment supplies `createEventSignupSchema`'s values, and
// WHICH field supplies WHICH value is declared per field rather than inferred
// from a label. These tests are the reason the mapping cannot be guessed: they
// pin that a missing role, a duplicated role or a waiver that is not a required
// checkbox all refuse to validate, and that none of it applies to the lead-gen
// forms already published.
// ---------------------------------------------------------------------------

const CHECKOUT_EVENT_ID = "11111111-2222-4333-8444-555555555555"

/** A form that satisfies every checkout rule. Each test breaks exactly one thing. */
function checkoutForm(overrides: Record<string, unknown> = {}) {
  return {
    formKey: "register",
    successMode: "checkout",
    eventId: CHECKOUT_EVENT_ID,
    fields: [
      { name: "parent_name", label: "Your name", type: "text", required: true, role: "parent_name" },
      { name: "email", label: "Email", type: "email", required: true, role: "parent_email" },
      { name: "player", label: "Player's name", type: "text", required: true, role: "athlete_name" },
      { name: "age", label: "Player's age", type: "select", required: true, role: "athlete_age", options: ["12", "13"] },
      { name: "waiver", label: "I accept the waiver", type: "checkbox", required: true, role: "waiver_accepted" },
    ] as Record<string, unknown>[],
    ...overrides,
  }
}

describe("the field-role contract", () => {
  it("accepts a fully-roled checkout form", () => {
    const parsed = formIslandSchema.safeParse(checkoutForm())
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it("rejects two fields claiming the same role", () => {
    const form = checkoutForm()
    form.fields.push({ name: "email2", label: "Confirm email", type: "email", required: true, role: "parent_email" })
    expect(formIslandSchema.safeParse(form).success).toBe(false)
  })

  it.each([...CHECKOUT_REQUIRED_ROLES])("rejects a checkout form with no %s field", (role) => {
    const form = checkoutForm()
    form.fields = form.fields.filter((f) => f.role !== role)
    expect(formIslandSchema.safeParse(form).success).toBe(false)
  })

  it("rejects a checkout form with no eventId — there is nothing to sell", () => {
    expect(formIslandSchema.safeParse(checkoutForm({ eventId: undefined })).success).toBe(false)
  })

  it("requires waiver_accepted to be a required checkbox", () => {
    const asText = checkoutForm()
    asText.fields = asText.fields.map((f) => (f.role === "waiver_accepted" ? { ...f, type: "text" } : f))
    expect(formIslandSchema.safeParse(asText).success).toBe(false)

    const optional = checkoutForm()
    optional.fields = optional.fields.map((f) => (f.role === "waiver_accepted" ? { ...f, required: false } : f))
    expect(formIslandSchema.safeParse(optional).success).toBe(false)
  })

  it("requires parent_email to be type email", () => {
    const form = checkoutForm()
    form.fields = form.fields.map((f) => (f.role === "parent_email" ? { ...f, type: "text" } : f))
    expect(formIslandSchema.safeParse(form).success).toBe(false)
  })

  it("requires athlete_age to be a select or text", () => {
    const form = checkoutForm()
    form.fields = form.fields.map((f) => (f.role === "athlete_age" ? { ...f, type: "textarea" } : f))
    expect(formIslandSchema.safeParse(form).success).toBe(false)
  })

  it("ignores roles entirely when successMode is not checkout", () => {
    // MUTANT: enforcing the required-role rule unconditionally. A lead-gen form
    // carrying one stray role would stop publishing, which regresses every page
    // already live.
    const leadgen = {
      formKey: "optin",
      successMode: "message",
      fields: [{ name: "email", label: "Email", type: "email", required: true, role: "parent_email" }],
    }
    expect(formIslandSchema.safeParse(leadgen).success).toBe(true)
  })

  it("keeps unroled fields — the owner's own questions survive", () => {
    const form = checkoutForm()
    form.fields.push({ name: "level", label: "Current level", type: "select", options: ["New", "Club"] })
    const parsed = formIslandSchema.safeParse(form)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.fields.some((f) => f.name === "level" && f.role === undefined)).toBe(true)
  })

  it("still accepts the shipped default props unchanged", () => {
    expect(
      formIslandSchema.safeParse({
        formKey: "optin",
        fields: [
          { name: "first_name", label: "First name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
        ],
        submitLabel: "Get instant access",
        successMode: "message",
        successMessage: "You're in — check your inbox.",
      }).success,
    ).toBe(true)
  })

  it("names only roles createEventSignupSchema can actually take", async () => {
    // Asserted as AGREEMENT with the real validator rather than against a
    // hardcoded list: a role the signup schema has no key for is a role that
    // maps nowhere, and only the real schema can say which those are.
    const { createEventSignupSchema } = await import("@/lib/validators/event-signups")
    const signupKeys = Object.keys(createEventSignupSchema.shape)
    for (const role of FORM_FIELD_ROLES) expect(signupKeys).toContain(role)
  })
})

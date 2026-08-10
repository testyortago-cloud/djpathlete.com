// Stage 0 safety hardening for lib/funnels/islands.ts:
//  1. redirectUrl must be scoped to a site path or an https URL on the
//     owner's own domain — SAFE_LINK alone only closes the scheme hole
//     (javascript:) and the protocol-relative hole (//evil.example); a
//     third-party https host still passed until this test.
//  2. checkoutIslandSchema.productId must be required only when it is
//     actually used — CheckoutIsland.tsx discards it entirely for
//     productKind "session_pack".
import { describe, it, expect } from "vitest"
import { formIslandSchema, checkoutIslandSchema } from "@/lib/funnels/islands"

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
    const good = ["/thanks", "https://www.darrenjpaul.com/x", "https://darrenjpaul.com/y"]

    it.each(good)("allows %s", (value) => {
      const result = formIslandSchema.safeParse({ ...base, redirectUrl: value })
      expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
    })
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

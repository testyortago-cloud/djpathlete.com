// @vitest-environment node
//
// Unit tests for lib/lead-engine/mask.ts — the shared PII-masking helpers
// scripts/enrol-repermission.ts (maskEmail, moved here) and
// scripts/import-ghl-contacts.ts (maskEmail + maskPhone, both new call
// sites) print through in their dry-run/execute transcripts.
// __tests__/scripts/enrol-repermission.test.ts already covers maskEmail's
// original three cases via that script's re-export; this file is the
// canonical suite for both functions, including maskPhone.
import { describe, it, expect } from "vitest"
import { maskEmail, maskPhone } from "@/lib/lead-engine/mask"

describe("maskEmail", () => {
  it("keeps only the first character of the local part and the domain", () => {
    expect(maskEmail("mike@example.com")).toBe("m***@e***")
  })

  it("masks a short local part and domain the same way", () => {
    expect(maskEmail("a@b.com")).toBe("a***@b***")
  })

  it("degrades gracefully for a string with no @ at all", () => {
    expect(maskEmail("not-an-email")).toBe("n***")
  })
})

describe("maskPhone", () => {
  it("masks a real E.164 US number, keeping +1 and the last 2 digits — the finding's own example", () => {
    expect(maskPhone("+12524957769")).toBe("+1********69")
  })

  it("masks a different real US number from the actual export the same way", () => {
    expect(maskPhone("+16467224960")).toBe("+1********60")
  })

  it("resolves a non-US country calling code correctly (not a fixed-width guess)", () => {
    // +44 7911 123456 — a 2-digit UK calling code; a naive "first digit
    // after +" rule would misread this as +4 and corrupt the boundary.
    expect(maskPhone("+447911123456")).toBe("+44********56")
  })

  it("degrades gracefully for a value libphonenumber-js cannot parse, keeping the last 2 digits", () => {
    const masked = maskPhone("12345")
    expect(masked).toBe("***45")
  })

  it("degrades gracefully for a value with no digits at all — no crash, nothing real echoed back", () => {
    const masked = maskPhone("notaphone")
    expect(masked.endsWith("ne")).toBe(true)
    expect(masked).not.toContain("notaphone")
  })

  it("never includes the real digits anywhere in its output for a real number", () => {
    const raw = "+13059033081"
    const masked = maskPhone(raw)
    expect(masked).not.toBe(raw)
    expect(masked).not.toContain("3059033081")
    // Only the last 2 digits are permitted to reappear.
    expect(masked.slice(-2)).toBe("81")
  })
})

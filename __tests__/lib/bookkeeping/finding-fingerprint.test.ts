import { describe, expect, it } from "vitest"
import { findingFingerprint } from "@/lib/bookkeeping/finding-fingerprint"

const ENTRY = "e0000000-0000-4000-8000-000000000001"

describe("findingFingerprint", () => {
  it("is <finder>:<key> for id-keyed finders, key untouched", () => {
    expect(findingFingerprint("substantiation_gap", ENTRY)).toBe(`substantiation_gap:${ENTRY}`)
    expect(findingFingerprint("year_end", "q4_timing")).toBe("year_end:q4_timing")
  })

  it("distinct finders over the SAME key never collide (same entry can be a gap AND a watchdog finding)", () => {
    expect(findingFingerprint("substantiation_gap", ENTRY)).not.toBe(findingFingerprint("watchdog", ENTRY))
    expect(findingFingerprint("watchlist", ENTRY)).not.toBe(findingFingerprint("home_office", ENTRY))
  })

  it("vendor keys collapse case + whitespace runs via normalizeCounterparty", () => {
    expect(findingFingerprint("vendor", " Adobe   INC ")).toBe("vendor:adobe inc")
    expect(findingFingerprint("vendor", "adobe inc")).toBe("vendor:adobe inc")
  })

  it("normalization applies ONLY to the vendor finder — other keys keep their exact bytes", () => {
    // Discriminator: a blanket .toLowerCase() mutation would pass the vendor
    // test but corrupt this one.
    expect(findingFingerprint("year_end", "Q4_Timing")).toBe("year_end:Q4_Timing")
  })

  it("a vendor key that normalizes to null (whitespace-only) falls back to the raw key", () => {
    expect(findingFingerprint("vendor", "   ")).toBe("vendor:   ")
  })
})

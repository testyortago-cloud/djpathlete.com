import { describe, expect, it } from "vitest"
import { findingFingerprint, type FinderKind } from "@/lib/bookkeeping/finding-fingerprint"

const ENTRY = "e0000000-0000-4000-8000-000000000001"

/** Every finder the union admits. Kept explicit so adding a member without a
 *  dismiss control anywhere (or dropping one that has one) is a compile error
 *  here, not a fingerprint nothing ever writes. */
const ALL_FINDERS: Record<FinderKind, true> = {
  watchlist: true,
  substantiation_gap: true,
  uncategorized: true,
  vendor: true,
  year_end: true,
  watchdog: true,
  duplicate: true,
}

describe("findingFingerprint", () => {
  it("is <finder>:<key> for id-keyed finders, key untouched", () => {
    expect(findingFingerprint("substantiation_gap", ENTRY)).toBe(`substantiation_gap:${ENTRY}`)
    expect(findingFingerprint("year_end", "q4_timing")).toBe("year_end:q4_timing")
  })

  it("distinct finders over the SAME key never collide (same entry can be a gap AND a watchdog finding)", () => {
    expect(findingFingerprint("substantiation_gap", ENTRY)).not.toBe(findingFingerprint("watchdog", ENTRY))
    expect(findingFingerprint("watchlist", ENTRY)).not.toBe(findingFingerprint("uncategorized", ENTRY))
    const all = (Object.keys(ALL_FINDERS) as FinderKind[]).map((f) => findingFingerprint(f, ENTRY))
    expect(new Set(all).size).toBe(all.length)
  })

  it("admits exactly the finders that have a dismiss control", () => {
    // home_office was in the union with no producer and no consumer — a type
    // advertising a capability the UI does not have. If a card gains a dismiss
    // button, add it here AND to the union; the Record above makes the pair
    // impossible to forget. duplicate has a dismiss control (review dialog's
    // "Not a duplicate" button persists fingerprints through the dismissals
    // route), so it belongs here and in the union.
    expect(Object.keys(ALL_FINDERS).sort()).toEqual([
      "duplicate",
      "substantiation_gap",
      "uncategorized",
      "vendor",
      "watchdog",
      "watchlist",
      "year_end",
    ])
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

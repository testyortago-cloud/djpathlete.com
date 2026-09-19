// __tests__/lib/og/brand.test.ts
//
// `ogClamp` is the only thing standing between a long title and a share card
// with its bottom half missing. Satori has no `text-overflow`: over-long text
// WRAPS, pushes the footer past 630px, and the PNG still renders "fine" — the
// failure is invisible unless you look at the image.
//
// This suite exists because a mutation sweep found the function had no
// coverage at all: gutting `ogClamp` to `return value` left the card route's
// own tests green, since they assert a PNG comes back and a too-long card is
// still a PNG.

import { describe, expect, it } from "vitest"
import { OG_ACCENT, OG_ARENA, OG_ICE, OG_SIZE, ogClamp } from "@/lib/og/brand"

describe("ogClamp", () => {
  it("leaves a string that already fits completely alone", () => {
    expect(ogClamp("Athlete Performance Quiz", 68)).toBe("Athlete Performance Quiz")
  })

  it("leaves a string of exactly the limit alone", () => {
    // MUTANT KILLED: `<` instead of `<=`, which would ellipsis a title that
    // fits exactly — an off-by-one that costs a real word.
    const exact = "x".repeat(20)
    expect(ogClamp(exact, 20)).toBe(exact)
  })

  it("cuts an over-long string and marks it", () => {
    // MUTANT KILLED: `return value` — the whole function gutted. That is the
    // survivor that prompted this file.
    const long = "Find out exactly where your training is holding you back this season"
    const out = ogClamp(long, 40)
    expect(out.length).toBeLessThanOrEqual(41) // 40 + the ellipsis
    expect(out.endsWith("…")).toBe(true)
    expect(long.startsWith(out.slice(0, -1).trimEnd())).toBe(true)
  })

  it("breaks on a word boundary rather than mid-word", () => {
    // MUTANT KILLED: dropping the `lastIndexOf(" ")` search. "…Qu" reads as a
    // typo; "…" after a whole word reads as a deliberate cut.
    //
    // THE LIMIT IS 32 AND NOT 30 ON PURPOSE. At 30 the slice lands exactly on
    // a space, so the word-boundary branch and the naive branch produce the
    // same string and the test passes with the logic deleted — it survived a
    // mutation sweep doing precisely that. 32 lands mid-word, which is the
    // only input that can tell the two apart.
    const out = ogClamp("Athlete Performance Quiz Five Questions", 32)
    expect(out).toBe("Athlete Performance Quiz Five…")
    expect(out).not.toContain("Qu…")
  })

  it("hard-cuts a single word with no break point", () => {
    // MUTANT KILLED: returning the whole string when no space is found, which
    // is the case a word-boundary search silently falls through to — and a
    // 200-character unbroken slug WOULD overflow the frame.
    const out = ogClamp("x".repeat(60), 20)
    expect(out).toBe(`${"x".repeat(20)}…`)
  })

  it("does not leave a trailing space before the ellipsis", () => {
    // A DOUBLE SPACE IS WHAT MAKES THIS REACHABLE, and owner-typed copy has
    // them. With single spaces the slice always stops immediately BEFORE a
    // space, so `.trimEnd()` never has anything to do and deleting it
    // survives — it did, on the first version of this test.
    //
    // Here the cut lands after "one two  t"; the last space is the SECOND of
    // the pair, so the slice keeps the first one and leaves "one two " to
    // trim. Verified by running both variants rather than by reasoning: my
    // first guess at an input for this produced identical output either way.
    expect(ogClamp("one two  three", 10)).toBe("one two…")
    expect(ogClamp("one two  three", 10)).not.toContain(" …")
  })
})

describe("the card's fixed values", () => {
  it("is exactly 1200x630", () => {
    // Every scraper crops to this. A card authored at another size is either
    // letterboxed or cropped, and neither is visible from a test that only
    // checks a PNG came back.
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 })
  })

  it("uses the same brand hexes the athlete report card does", () => {
    // These are shared so the two cards match when both land in one chat
    // thread. Pinned by VALUE, because the whole point of sharing them was to
    // stop the two drifting.
    expect(OG_ARENA).toBe("#0B2E3B")
    expect(OG_ACCENT).toBe("#C49B7A")
    expect(OG_ICE).toBe("#D8E6EB")
  })
})

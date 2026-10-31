import { describe, it, expect } from "vitest"
import { buildRankingPrompt, capPerThemeExceptFocus } from "../tavily-trending-scan.js"
import { focusQueriesFrom } from "../lib/scan-focus.js"

const result = (n: number, title: string) => ({ title, url: `https://r${n}.example`, content: `snippet ${n}` })

describe("focusQueriesFrom", () => {
  it("returns the searches of topics that are on and have keywords, and nothing else", () => {
    const focus = focusQueriesFrom([
      { id: "1", name: "Agility", keywords: ["deceleration", "cutting"], active: true },
      { id: "2", name: "Sleep research", keywords: ["adolescents"], active: true },
      { id: "3", name: "Conditioning", keywords: ["repeated sprint"], active: false },
      { id: "4", name: "hamstring injury research", keywords: [], active: true },
    ])
    expect([...focus].sort()).toEqual([
      "Agility cutting research",
      "Agility deceleration research",
      "Sleep research adolescents",
    ])
  })

  it("skips anything malformed instead of throwing", () => {
    expect(focusQueriesFrom(null).size).toBe(0)
    expect(focusQueriesFrom("x").size).toBe(0)
    expect(
      focusQueriesFrom([null, { name: 3, keywords: ["a"], active: true }, { name: "A", keywords: [1], active: true }])
        .size,
    ).toBe(0)
  })
})

describe("capPerThemeExceptFocus", () => {
  const fv = [1, 2, 3, 4, 5].map((n) => result(n, `Force-velocity profiling study ${n}`))

  it("keeps every focus result and still caps the same theme's ordinary results", () => {
    const focusUrls = new Set([fv[0].url, fv[1].url, fv[2].url, fv[3].url])
    const extra = [6, 7, 8, 9].map((n) => result(n, `Velocity-based training trial ${n}`))
    const kept = capPerThemeExceptFocus([...fv, ...extra], 3, focusUrls)
    // 4 focus results survive; the 5 ordinary force-velocity results are capped at 3.
    expect(kept.map((r) => r.url)).toEqual([fv[0], fv[1], fv[2], fv[3], fv[4], extra[0], extra[1]].map((r) => r.url))
  })

  it("is the plain cap when there is no focus", () => {
    expect(capPerThemeExceptFocus(fv, 3, new Set()).map((r) => r.url)).toEqual(fv.slice(0, 3).map((r) => r.url))
  })
})

describe("buildRankingPrompt with a focus", () => {
  it("tags focus candidates and lifts the two-per-theme rule only for them", () => {
    const prompt = buildRankingPrompt(
      [result(1, "Force-velocity a"), result(2, "Sleep b")],
      [],
      new Set(["https://r1.example"]),
    )
    expect(prompt).toContain("[FOCUS · Force–velocity profiling & velocity-based training]")
    expect(prompt).not.toMatch(/\[FOCUS[^\]]*Sleep/)
    expect(prompt).toContain("THIS WEEK HAS A FOCUS")
  })

  it("says nothing about a focus when there is none", () => {
    const prompt = buildRankingPrompt([result(1, "Force-velocity a")], [])
    expect(prompt).not.toContain("FOCUS")
  })
})

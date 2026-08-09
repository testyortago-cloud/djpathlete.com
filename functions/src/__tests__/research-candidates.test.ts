import { describe, it, expect } from "vitest"
import { isDuplicate, collectDiverseResults, reassignSequentialRanks } from "../lib/research-candidates.js"

describe("isDuplicate", () => {
  it("flags an exact URL repeat regardless of title", () => {
    const seen = new Set(["https://a.example/x"])
    expect(
      isDuplicate({ title: "Totally different title", url: "https://a.example/x" }, seen, []),
    ).toBe(true)
  })

  it("flags a near-duplicate title from a different URL as already accepted", () => {
    // Real pair from the bug report screenshot — two syndicated titles for the
    // same hamstring-force-production study, scores 0.632 with string-similarity-js.
    const accepted = [
      {
        title:
          "Hamstring-Driven Horizontal Force Production in Sprint Acceleration: Why FH Output Predicts Return-to-Sprint Readiness Post-Injury",
        url: "https://journal.example/study-a",
      },
    ]
    const candidate = {
      title:
        "Hamstring Horizontal Force Production in Sprint Acceleration: Why Hip Extensor Eccentric Strength Drives Early Ground Impulse",
      url: "https://coachingblog.example/study-a-reprint",
    }
    expect(isDuplicate(candidate, new Set(), accepted)).toBe(true)
  })

  it("does not flag two genuinely distinct topics", () => {
    const accepted = [
      {
        title: "Accentuated Eccentric Loading Elevates Eccentric Braking Force in Power Athletes",
        url: "https://journal.example/study-b",
      },
    ]
    const candidate = {
      title: "Sport Psychology Readiness Screening Predicts Return-to-Sprint Confidence",
      url: "https://journal.example/study-c",
    }
    expect(isDuplicate(candidate, new Set(), accepted)).toBe(false)
  })
})

describe("collectDiverseResults", () => {
  // Nine real, pairwise-dissimilar sport-science titles (verified max pairwise
  // similarity 0.408 with string-similarity-js — comfortably below the 0.55
  // duplicate threshold in research-candidates.ts). Placeholder titles like
  // "q1 topic 0" / "q2 topic 0" are NOT safe fixtures here: they differ by only
  // one token and score ~0.78 similar to each other, which makes
  // collectDiverseResults treat them as near-duplicates and corrupts the
  // round-robin ordering these tests assert — confirmed by running the
  // similarity check against them directly before writing this fixture.
  const TITLES = [
    "Creatine loading protocols enhance repeated sprint ability in soccer players",
    "Nordic hamstring curl eccentric strength reduces hamstring strain incidence",
    "Caffeine dosing timing improves repeated high-intensity cycling output",
    "Isometric mid-thigh pull testing predicts vertical jump performance changes",
    "Wearable GPS load monitoring flags acute spikes in training exposure",
    "Small-sided games intensity replicates match-play physiological demands",
    "Cold water immersion timing affects delayed-onset muscle soreness recovery",
    "Menstrual cycle phase influences ACL laxity and injury susceptibility",
    "Altitude training camps elevate hemoglobin mass in distance runners",
  ]

  function fakeSearch(urlPrefix: string, titleIndexes: number[]) {
    return {
      results: titleIndexes.map((idx, i) => ({
        title: TITLES[idx],
        url: `https://${urlPrefix}.example/${i}`,
        content: `content ${i}`,
      })),
    }
  }

  it("round-robins across queries instead of draining the first one", () => {
    const searches = [fakeSearch("q1", [0, 3, 6]), fakeSearch("q2", [1, 4, 7]), fakeSearch("q3", [2, 5, 8])]
    const collected = collectDiverseResults(searches, 6)
    expect(collected.map((c) => c.url)).toEqual([
      "https://q1.example/0",
      "https://q2.example/0",
      "https://q3.example/0",
      "https://q1.example/1",
      "https://q2.example/1",
      "https://q3.example/1",
    ])
  })

  it("stops at maxResults", () => {
    const searches = [fakeSearch("q1", [0, 3, 6]), fakeSearch("q2", [1, 4, 7])]
    expect(collectDiverseResults(searches, 3)).toHaveLength(3)
  })

  it("drops near-duplicate titles even across different queries", () => {
    // Identical title pair used in the isDuplicate tests above (verified
    // 0.632 similarity with string-similarity-js) so this test's outcome
    // rests on a measured value, not a guess.
    const searches = [
      {
        results: [
          {
            title:
              "Hamstring-Driven Horizontal Force Production in Sprint Acceleration: Why FH Output Predicts Return-to-Sprint Readiness Post-Injury",
            url: "https://a.example/1",
            content: "x",
          },
        ],
      },
      {
        results: [
          {
            title:
              "Hamstring Horizontal Force Production in Sprint Acceleration: Why Hip Extensor Eccentric Strength Drives Early Ground Impulse",
            url: "https://b.example/1",
            content: "y",
          },
        ],
      },
    ]
    expect(collectDiverseResults(searches, 10)).toHaveLength(1)
  })

  it("returns an empty array for an empty query set", () => {
    expect(collectDiverseResults([], 10)).toEqual([])
  })
})

describe("reassignSequentialRanks", () => {
  it("overwrites rank with sequential position after sorting by the input rank", () => {
    const topics = [
      { title: "c", rank: 1 },
      { title: "a", rank: 1 },
      { title: "b", rank: 2 },
    ]
    expect(reassignSequentialRanks(topics)).toEqual([
      { title: "c", rank: 1 },
      { title: "a", rank: 2 },
      { title: "b", rank: 3 },
    ])
  })

  it("does not mutate the input array", () => {
    const topics = [{ title: "a", rank: 5 }]
    reassignSequentialRanks(topics)
    expect(topics).toEqual([{ title: "a", rank: 5 }])
  })
})

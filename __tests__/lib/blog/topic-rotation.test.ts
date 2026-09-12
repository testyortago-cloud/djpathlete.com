import { describe, it, expect } from "vitest"
import { groupByWeek, pickDiverseTopic, RECENT_THEME_WINDOW, type RankableTopic } from "@/lib/blog/topic-rotation"

function t(over: Partial<RankableTopic> & { title: string; rank: number }): RankableTopic {
  return {
    id: over.id ?? `${over.title.slice(0, 12)}-${over.rank}`,
    title: over.title,
    scheduled_for: over.scheduled_for ?? "2026-09-14",
    created_at: over.created_at ?? "2026-09-08T00:00:00.000Z",
    rank: over.rank,
  }
}

// The actual 2026-09-14 brief, in rank order.
const WEEK_0914: RankableTopic[] = [
  t({ title: "RMSSD Coefficient of Variation as a Dual-Signal HRV Metric", rank: 1 }),
  t({ title: "Individual Load-Velocity Profiling for Resisted Sprint Prescription", rank: 2 }),
  t({ title: "Biomechanical Determinants of Change-of-Direction Performance", rank: 3 }),
  t({ title: "Assisted vs. Resisted Sprint Training: Phase-Specific Speed Adaptations", rank: 5 }),
  t({ title: "Return-to-Performance Paradigm After ACL Reconstruction", rank: 8 }),
]

describe("pickDiverseTopic", () => {
  it("takes rank 1 when nothing recent shares its theme", () => {
    const picked = pickDiverseTopic(WEEK_0914, ["Sports Rehab: What Actually Gets You Back"])
    expect(picked?.topic.rank).toBe(1)
    expect(picked?.reason).toBe("fresh_theme")
  })

  it("skips rank 1 when we just published that theme — the actual bug", () => {
    // Sep 8 draft was "RMSSD Coefficient of Variation: Read HRV Right".
    const picked = pickDiverseTopic(WEEK_0914, ["RMSSD Coefficient of Variation: Read HRV Right"])
    expect(picked?.topic.rank).not.toBe(1)
    expect(picked?.theme).not.toBe("monitoring_recovery")
  })

  it("walks down past a whole run of recently-used themes", () => {
    // Sep 10 + Sep 8: velocity profiling and HRV. Both top ranks are spent.
    const picked = pickDiverseTopic(WEEK_0914, [
      "Sled Load Velocity Profiling: Ditch %BM Now",
      "RMSSD Coefficient of Variation: Read HRV Right",
    ])
    expect(picked?.topic.rank).toBe(3)
    expect(picked?.theme).toBe("deceleration_cod")
  })

  it("reproduces the four-in-a-row force-velocity run and breaks it", () => {
    const recent = [
      "Force-Velocity Profile: Fix the Imbalance, Jump Higher",
      "Force Velocity Profile Training: Stop Guessing Loads",
      "Force Velocity Profile Reliability: Why Leg Press Wins",
      "Force Velocity Profile Optimized Training: What the Meta-Analysis Shows",
    ]
    const fvHeavy = [
      t({ title: "F-V Profile Imbalance as a Training Target", rank: 1 }),
      t({ title: "Leg Press vs. Vertical Jump for F-V Profiling", rank: 2 }),
      t({ title: "Maximal Aerobic Speed as the Anchor for HIIT Prescription", rank: 4 }),
    ]
    const picked = pickDiverseTopic(fvHeavy, recent)
    expect(picked?.theme).toBe("conditioning_aerobic")
    expect(picked?.topic.rank).toBe(4)
  })

  it("falls back to rank order rather than writing nothing", () => {
    const onlyHrv = [t({ title: "Nocturnal HRV and autonomic recovery status", rank: 2 })]
    const picked = pickDiverseTopic(onlyHrv, ["RMSSD Coefficient of Variation: Read HRV Right"])
    expect(picked?.reason).toBe("rank_order_fallback")
    expect(picked?.topic.rank).toBe(2)
  })

  it("refuses an outright near-duplicate title even in the fallback pass", () => {
    const dupe = [t({ title: "Force Velocity Profile Reliability: Why Leg Press Wins", rank: 1 })]
    expect(pickDiverseTopic(dupe, ["Force Velocity Profile Reliability: Why Leg Press Wins"])).toBeNull()
  })

  it("prefers the newer week but can reach an older one for a fresh theme", () => {
    const mixed = [
      t({ title: "RMSSD HRV dual-signal metric", rank: 1, scheduled_for: "2026-09-14" }),
      t({ title: "Youth LTAD maturation screening benchmarks", rank: 7, scheduled_for: "2026-09-07" }),
    ]
    const picked = pickDiverseTopic(mixed, ["RMSSD Coefficient of Variation: Read HRV Right"])
    expect(picked?.theme).toBe("youth_ltad")
    expect(picked?.topic.scheduled_for).toBe("2026-09-07")
  })

  it("only the most recent RECENT_THEME_WINDOW posts define a spent theme", () => {
    const stale = Array.from({ length: RECENT_THEME_WINDOW }, (_, i) => `Sprint mechanics piece ${i}`)
    // An HRV post pushed outside the window frees the HRV theme again. Its
    // title is deliberately NOT a near-duplicate of rank 1 — see the next test
    // for why that distinction matters.
    const picked = pickDiverseTopic(WEEK_0914, [...stale, "Sleep debt, autonomic load and weekly readiness"])
    expect(picked?.topic.rank).toBe(1)
  })

  it("the theme window is bounded but the near-duplicate check is NOT", () => {
    // Theme staleness ages out after RECENT_THEME_WINDOW posts; rewriting the
    // same article never becomes acceptable, however long ago it ran.
    const stale = Array.from({ length: RECENT_THEME_WINDOW }, (_, i) => `Sprint mechanics piece ${i}`)
    const picked = pickDiverseTopic(WEEK_0914, [...stale, "RMSSD Coefficient of Variation: Read HRV Right"])
    expect(picked?.topic.rank).not.toBe(1)
  })

  it("returns null on an empty queue", () => {
    expect(pickDiverseTopic([], [])).toBeNull()
  })
})

describe("groupByWeek", () => {
  it("orders weeks newest-first and sorts each week by rank", () => {
    const weeks = groupByWeek([
      t({ title: "old b", rank: 2, scheduled_for: "2026-09-07" }),
      t({ title: "new b", rank: 5, scheduled_for: "2026-09-14" }),
      t({ title: "new a", rank: 1, scheduled_for: "2026-09-14" }),
      t({ title: "old a", rank: 1, scheduled_for: "2026-09-07" }),
    ])
    expect(weeks.map((w) => w[0].scheduled_for)).toEqual(["2026-09-14", "2026-09-07"])
    expect(weeks[0].map((c) => c.rank)).toEqual([1, 5])
  })

  it("sends null ranks to the back instead of treating them as rank 0", () => {
    const weeks = groupByWeek([
      { id: "x", title: "unranked", scheduled_for: "2026-09-14", created_at: "2026-09-08T00:00:00Z", rank: null },
      t({ title: "ranked", rank: 9 }),
    ])
    expect(weeks[0][0].title).toBe("ranked")
  })
})

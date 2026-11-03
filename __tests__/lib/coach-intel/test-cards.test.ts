import { describe, it, expect } from "vitest"
import { otherSide, sideGap, testCards } from "@/lib/coach-intel/test-cards"
import type { PerformanceTest, TestType } from "@/types/database"
import { TEST_TYPE_DEFAULTS } from "@/lib/validators/performance-test"

let n = 0
function t(
  test_type: TestType,
  test_date: string,
  result_value: number,
  extra: Partial<PerformanceTest> = {},
): PerformanceTest {
  return {
    id: `t${++n}`,
    client_user_id: "c1",
    created_by: "coach",
    test_type,
    custom_name: null,
    result_value,
    result_unit: TEST_TYPE_DEFAULTS[test_type].unit,
    trial_values: null,
    best_method: TEST_TYPE_DEFAULTS[test_type].best_method,
    test_date,
    body_weight_kg: null,
    notes: null,
    video_url: null,
    is_pr: false,
    pct_change_from_prev: null,
    created_at: "",
    updated_at: "",
    ...extra,
  }
}

describe("testCards", () => {
  it("groups by kind of test, in a fixed order, and keeps every test however many results there are", () => {
    // Twelve results: the Tests tab used to build its cards from the newest ten only.
    const tests = [
      ...Array.from({ length: 10 }, (_, i) => t("cmj", `2026-11-${String(20 - i).padStart(2, "0")}`, 40 + i)),
      t("plank_hold", "2026-06-13", 45),
      t("sprint_10m", "2026-07-01", 1.9),
    ]
    const groups = testCards(tests)
    expect(groups.map((g) => g.group)).toEqual(["Jumps", "Speed", "Endurance"])
    expect(groups[2].cards[0]).toMatchObject({ kind: "single", key: "plank_hold" })
    expect(groups[0].cards[0]).toMatchObject({ kind: "single" })
    if (groups[0].cards[0].kind === "single") expect(groups[0].cards[0].history).toHaveLength(10)
  })

  it("puts a test's two sides on one card, newest first, even when only one side has been tested", () => {
    const groups = testCards([
      t("cmj_left", "2026-11-01", 25),
      t("cmj_left", "2026-11-02", 27.8),
      t("cmj_right", "2026-11-02", 12.4),
      t("torso_rotation_right", "2026-11-03", 48),
    ])
    const jumps = groups.find((g) => g.group === "Jumps")!
    expect(jumps.cards).toEqual([expect.objectContaining({ kind: "pair", key: "pair:cmj", label: "Single-Leg CMJ" })])
    const pair = jumps.cards[0]
    if (pair.kind !== "pair") throw Error("expected a pair")
    expect(pair.left.map((x) => x.result_value)).toEqual([27.8, 25])
    expect(pair.right.map((x) => x.result_value)).toEqual([12.4])
    const mobility = groups.find((g) => g.group === "Mobility")!
    expect(mobility.cards[0]).toMatchObject({ kind: "pair", label: "Torso Rotation", left: [] })
  })

  it("keeps each custom test on its own card, by name", () => {
    const groups = testCards([
      t("custom", "2026-11-01", 5, { custom_name: "Farmer carry" }),
      t("custom", "2026-11-01", 9, { custom_name: "Wall ball" }),
    ])
    expect(groups).toEqual([
      {
        group: "Other",
        cards: [
          expect.objectContaining({ key: "custom:Farmer carry" }),
          expect.objectContaining({ key: "custom:Wall ball" }),
        ],
      },
    ])
  })
})

describe("sideGap", () => {
  it("says which side is weaker and by how much of the better side", () => {
    expect(sideGap(t("cmj_left", "2026-11-02", 27.8), t("cmj_right", "2026-11-02", 12.4))).toEqual({
      pct: 55,
      weaker: "right",
    })
  })

  it("counts the SLOWER side as weaker when lower is better", () => {
    expect(sideGap(t("sprint_contact_left", "2026-11-02", 337), t("sprint_contact_right", "2026-11-02", 305))).toEqual({
      pct: 9,
      weaker: "left",
    })
  })

  it("compares nothing when the sides were tested on different days, or one is missing", () => {
    expect(sideGap(t("cmj_left", "2026-11-01", 27), t("cmj_right", "2026-11-02", 25))).toBeNull()
    expect(sideGap(t("cmj_left", "2026-11-01", 27), undefined)).toBeNull()
  })

  it("names no weaker side when they are level", () => {
    expect(sideGap(t("cmj_left", "2026-11-02", 30), t("cmj_right", "2026-11-02", 30))).toEqual({ pct: 0, weaker: null })
  })
})

describe("otherSide", () => {
  it("pairs left with right and nothing else", () => {
    expect(otherSide("cmj_left")).toBe("cmj_right")
    expect(otherSide("sprint_contact_right")).toBe("sprint_contact_left")
    expect(otherSide("cmj")).toBeNull()
  })
})

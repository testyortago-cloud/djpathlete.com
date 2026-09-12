import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { capPerTheme, themeOf, themesPresent, TOPIC_THEMES, OTHER_THEME_KEY } from "@/lib/blog/topic-themes"

// Real titles taken from content_calendar / blog_posts on 2026-09-12. These are
// the rows that motivated the whole change, so they are the fixtures.
const REAL_FV_TITLES = [
  "Force-Velocity Profile-Based Training Produces Moderate Effect Sizes for Jump Height vs. Generic Loading",
  "F-V Profile Imbalance as a Training Target: Individualized Jump Training Based on Force-Velocity Profiling",
  "Individual Load-Velocity Profiling for Resisted Sprint Prescription: Why %Body-Mass Sled Loads Are Invalid",
  "Force Velocity Profile Reliability: Why Leg Press Wins",
]

describe("themeOf", () => {
  it("classifies every real force-velocity title into one theme", () => {
    for (const title of REAL_FV_TITLES) {
      expect(themeOf(title), title).toBe("force_velocity")
    }
  })

  it("puts a load-velocity sprint title under force_velocity, not sprint_speed", () => {
    // Order-dependence is the whole point of the ordered table — pin it.
    expect(themeOf("Individual Load-Velocity Profiling for Resisted Sprint Prescription")).toBe("force_velocity")
    // ...while a genuine sprint title still lands in sprint_speed.
    expect(themeOf("Sprint Phase Kinematics Across Maturation: Stride Parameter Development")).toBe("sprint_speed")
  })

  it("separates the clusters that were colliding in production", () => {
    expect(themeOf("RMSSD Coefficient of Variation as a Dual-Signal HRV Metric")).toBe("monitoring_recovery")
    expect(themeOf("Horizontal Braking Impulse as Determinant of Change-of-Direction Speed")).toBe("deceleration_cod")
    expect(themeOf("Yo-Yo IR1 vs. VO2max for Aerobic Conditioning Prescription")).toBe("conditioning_aerobic")
    expect(themeOf("Return-to-Performance Paradigm After ACL Reconstruction")).toBe("return_to_sport")
    expect(themeOf("Nonlinear Periodization Produces Greater 1RM Gains Than Linear")).toBe("periodization_strength")
  })

  it("falls back to 'other' rather than forcing a wrong theme", () => {
    expect(themeOf("Altitude camps and haemoglobin mass in road cyclists")).toBe(OTHER_THEME_KEY)
    expect(themeOf("")).toBe(OTHER_THEME_KEY)
  })

  it("every theme key is unique", () => {
    const keys = TOPIC_THEMES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("capPerTheme", () => {
  const titleOf = (s: string) => s

  it("caps a dominant theme while leaving other themes untouched", () => {
    const input = [...REAL_FV_TITLES, "RMSSD Coefficient of Variation HRV", "ACL Return-to-Sport Criteria"]
    const out = capPerTheme(input, 2, titleOf)
    expect(out.filter((t) => themeOf(t) === "force_velocity")).toHaveLength(2)
    expect(out).toContain("RMSSD Coefficient of Variation HRV")
    expect(out).toContain("ACL Return-to-Sport Criteria")
  })

  it("preserves input order so upstream relevance ranking survives", () => {
    const input = ["RMSSD HRV trend", ...REAL_FV_TITLES]
    const out = capPerTheme(input, 1, titleOf)
    expect(out[0]).toBe("RMSSD HRV trend")
    expect(out[1]).toBe(REAL_FV_TITLES[0])
  })

  it("keeps the FIRST of a capped theme, not an arbitrary one", () => {
    const out = capPerTheme(REAL_FV_TITLES, 1, titleOf)
    expect(out).toEqual([REAL_FV_TITLES[0]])
  })

  it("does NOT cap the 'other' bucket — it is a catch-all, not a topic", () => {
    const others = ["Altitude camp haemoglobin", "Barefoot shoe stiffness study", "Chronotype and kickoff time"]
    expect(others.every((t) => themeOf(t) === OTHER_THEME_KEY)).toBe(true)
    expect(capPerTheme(others, 1, titleOf)).toHaveLength(3)
  })

  it("returns nothing when the cap is zero or negative", () => {
    expect(capPerTheme(REAL_FV_TITLES, 0, titleOf)).toEqual([])
    expect(capPerTheme(REAL_FV_TITLES, -1, titleOf)).toEqual([])
  })

  it("reproduces the production failure and then fixes it", () => {
    // The 2026-09-07 brief: 3 of 8 rows were one mechanism.
    const brief = [
      "Force-Velocity Profile-Based Training Produces Moderate Effect Sizes",
      "Horizontal Braking Impulse as Determinant of COD Speed",
      "Eccentric RFD Training at High Velocity Drives Fascicle Length Adaptation",
      "Hill Grade Shifts Sprint Mechanical Profile Toward Force-Oriented Output",
      "Training at MAS as Critical Intensity Threshold for Aerobic Power",
      "Nocturnal HRV Over 3-Day Rolling Averages Reflects Autonomic Recovery",
    ]
    const spread = themesPresent(capPerTheme(brief, 2, titleOf))
    expect(spread.length).toBeGreaterThanOrEqual(4)
  })
})

describe("topic-themes twin sync", () => {
  it("lib/ and functions/ copies are byte-identical apart from their path comments", () => {
    const root = process.cwd()
    const normalise = (p: string) =>
      readFileSync(join(root, p), "utf8")
        .replace(/^\/\/ (lib\/blog|functions\/src\/lib)\/topic-themes\.ts\n/, "")
        .replace(/The twin is `[^`]+`/, "The twin is `<path>`")
    expect(normalise("lib/blog/topic-themes.ts")).toBe(normalise("functions/src/lib/topic-themes.ts"))
  })
})

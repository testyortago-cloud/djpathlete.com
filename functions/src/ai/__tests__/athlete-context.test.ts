import { describe, it, expect } from "vitest"
import {
  normalizeSport,
  buildAthleteContext,
  resolveClientDifficulty,
  buildProfileContext,
} from "../athlete-context.js"

describe("normalizeSport", () => {
  it("trims, lowercases and maps the spellings live profiles use", () => {
    expect(normalizeSport("Tennis ")).toBe("tennis")
    expect(normalizeSport("Tenis")).toBe("tennis")
    expect(normalizeSport("Pickle")).toBe("pickleball")
    expect(normalizeSport("  Soccer")).toBe("soccer")
  })
  it("answers null for empty or non-string input", () => {
    expect(normalizeSport("   ")).toBeNull()
    expect(normalizeSport(null)).toBeNull()
    expect(normalizeSport(42)).toBeNull()
  })
})

describe("buildAthleteContext", () => {
  it("carries exactly the fields the selector's rules read", () => {
    expect(
      buildAthleteContext({
        sport: "Tennis ",
        experience_level: "intermediate",
        movement_confidence: "comfortable",
        injury_details: [{ area: "left knee" }],
        exercise_dislikes: "burpees",
        weight_kg: 80,
      }),
    ).toEqual({
      sport: "tennis",
      experience_level: "intermediate",
      movement_confidence: "comfortable",
      injury_details: [{ area: "left knee" }],
      exercise_dislikes: "burpees",
    })
  })
  it("says null / empty instead of guessing when there is no profile", () => {
    expect(buildAthleteContext(null)).toEqual({
      sport: null,
      experience_level: null,
      movement_confidence: null,
      injury_details: [],
      exercise_dislikes: null,
    })
  })
  it("treats a non-array injury_details as no injuries", () => {
    expect(buildAthleteContext({ injury_details: "knee" }).injury_details).toEqual([])
  })
})

describe("resolveClientDifficulty", () => {
  it("uses the profile's level when set", () => {
    expect(resolveClientDifficulty({ experience_level: "beginner" }, true)).toBe("beginner")
  })
  it("is advanced under ignore_profile and intermediate with no profile", () => {
    expect(resolveClientDifficulty(null, true)).toBe("advanced")
    expect(resolveClientDifficulty(null, false)).toBe("intermediate")
    expect(resolveClientDifficulty({ experience_level: "" }, undefined)).toBe("intermediate")
  })
})

describe("buildProfileContext", () => {
  it("is null without a profile", () => {
    expect(buildProfileContext(null)).toBeNull()
  })
  it("includes the fields week/day used to miss, with sport normalised and age computed", () => {
    const json = JSON.parse(
      buildProfileContext(
        { sport: "Pickle", date_of_birth: "2000-06-01", movement_confidence: "learning", exercise_dislikes: "lunges" },
        new Date("2026-10-04T00:00:00Z"),
      )!,
    )
    expect(json.sport).toBe("pickleball")
    expect(json.age).toBe(26)
    expect(json.movement_confidence).toBe("learning")
    expect(json.exercise_dislikes).toBe("lunges")
  })
})

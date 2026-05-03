// functions/src/blog/__tests__/program-catalog.test.ts
import { describe, it, expect } from "vitest"
import { findRelevantProgram, formatProgramsForPrompt, PROGRAMS } from "../program-catalog.js"

describe("program-catalog", () => {
  it("PROGRAMS is non-empty and every entry has the required fields", () => {
    expect(PROGRAMS.length).toBeGreaterThan(0)
    for (const p of PROGRAMS) {
      expect(p.slug).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.url).toMatch(/^https:\/\//)
      expect(p.pitch).toBeTruthy()
      expect(p.match_tags.length).toBeGreaterThan(0)
      expect(p.match_keywords.length).toBeGreaterThan(0)
    }
  })

  it("findRelevantProgram returns Comeback Code for a recovery-tagged post", () => {
    const result = findRelevantProgram({
      tags: ["recovery", "youth-athletes"],
      title: "Recovery strategies after competition",
    })
    expect(result?.slug).toBe("comeback-code")
  })

  it("findRelevantProgram returns Rotational Reboot for a pitching-tagged post", () => {
    const result = findRelevantProgram({
      tags: ["pitching", "throwing"],
      title: "Velocity training",
    })
    expect(result?.slug).toBe("rotational-reboot")
  })

  it("findRelevantProgram matches on keyword text when tags miss", () => {
    const result = findRelevantProgram({
      tags: [],
      title: "Improving golf swing rotational power",
    })
    expect(result?.slug).toBe("rotational-reboot")
  })

  it("findRelevantProgram returns null when nothing matches", () => {
    const result = findRelevantProgram({
      tags: ["nutrition"],
      title: "Hydration basics",
    })
    expect(result).toBeNull()
  })

  it("formatProgramsForPrompt includes every program name and url", () => {
    const out = formatProgramsForPrompt()
    for (const p of PROGRAMS) {
      expect(out).toContain(p.name)
      expect(out).toContain(p.url)
    }
  })
})

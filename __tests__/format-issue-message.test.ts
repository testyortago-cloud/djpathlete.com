// @vitest-environment node
import { describe, it, expect } from "vitest"

// Inline the function since it's not exported (UI helper)
function formatIssueMessage(message: string): string {
  let formatted = message.replace(
    /\b(?:slot\s+)?w(\d+)d(\d+)s(\d+)\b/gi,
    (_match, week, day, slot) => `Week ${week}, Day ${day}, Exercise ${slot}`,
  )
  formatted = formatted.replace(
    /\b(?:requires\s+)(\w+(?:_\w+)+)\b/g,
    (_match, name: string) =>
      `requires ${name
        .split("_")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")}`,
  )
  return formatted
}

describe("formatIssueMessage", () => {
  it("formats slot references", () => {
    expect(
      formatIssueMessage(
        "Rest period of 75s for compound exercise 'Bulgarian Split Squat' in slot w3d2s4 is below recommended minimum of 90s",
      ),
    ).toBe(
      "Rest period of 75s for compound exercise 'Bulgarian Split Squat' in Week 3, Day 2, Exercise 4 is below recommended minimum of 90s",
    )
  })

  it("formats slot references without 'slot' prefix", () => {
    expect(formatIssueMessage("Issue in w1d1s1")).toBe("Issue in Week 1, Day 1, Exercise 1")
  })

  it("formats equipment names after 'requires'", () => {
    expect(formatIssueMessage("Exercise 'Lying Leg Curl' requires leg_curl_machine which is not available")).toBe(
      "Exercise 'Lying Leg Curl' requires Leg Curl Machine which is not available",
    )
  })

  it("formats yoga_mat equipment", () => {
    expect(
      formatIssueMessage(
        "Exercise 'Yoga Flow - Recovery' requires yoga_mat which is not available in client's equipment list",
      ),
    ).toBe("Exercise 'Yoga Flow - Recovery' requires Yoga Mat which is not available in client's equipment list")
  })

  it("handles messages with no slot refs or equipment", () => {
    const msg = "Volume for chest is below target"
    expect(formatIssueMessage(msg)).toBe(msg)
  })

  it("handles multiple slot refs in one message", () => {
    expect(formatIssueMessage("Duplicate exercise in w1d1s2 and w1d2s3")).toBe(
      "Duplicate exercise in Week 1, Day 1, Exercise 2 and Week 1, Day 2, Exercise 3",
    )
  })
})

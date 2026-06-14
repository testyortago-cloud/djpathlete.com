import { describe, it, expect } from "vitest"
import { deriveFormReviewTitle, formReviewCardState } from "@/lib/workout/form-review"

describe("deriveFormReviewTitle", () => {
  it("includes exercise, program, and week when week is present", () => {
    expect(deriveFormReviewTitle("Back Squat", "Trial", 2)).toBe("Back Squat — Trial, Week 2")
  })

  it("omits the week clause when week is null/undefined", () => {
    expect(deriveFormReviewTitle("Back Squat", "Trial", null)).toBe("Back Squat — Trial")
    expect(deriveFormReviewTitle("Back Squat", "Trial", undefined)).toBe("Back Squat — Trial")
  })

  it("falls back to the exercise name alone when program name is empty", () => {
    expect(deriveFormReviewTitle("Back Squat", "", 1)).toBe("Back Squat")
  })
})

describe("formReviewCardState", () => {
  it("returns 'none' when there is no submission", () => {
    expect(formReviewCardState(null)).toEqual({ kind: "none" })
  })

  it("maps pending to submitted", () => {
    expect(formReviewCardState({ id: "r1", status: "pending" })).toEqual({
      kind: "submitted",
      reviewId: "r1",
    })
  })

  it("maps in_progress to in_review", () => {
    expect(formReviewCardState({ id: "r1", status: "in_progress" })).toEqual({
      kind: "in_review",
      reviewId: "r1",
    })
  })

  it("maps reviewed to reviewed", () => {
    expect(formReviewCardState({ id: "r1", status: "reviewed" })).toEqual({
      kind: "reviewed",
      reviewId: "r1",
    })
  })
})

describe("deriveFormReviewTitle", () => {
  it("includes week 0 (guard is != null, not falsy)", () => {
    expect(deriveFormReviewTitle("Squat", "Trial", 0)).toBe("Squat — Trial, Week 0")
  })
})

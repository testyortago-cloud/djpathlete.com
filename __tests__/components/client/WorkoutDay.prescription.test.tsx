// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { WorkoutDay } from "@/components/client/WorkoutDay"
import { WeightUnitProvider } from "@/hooks/use-weight-unit"
import type { ExerciseWithRecommendation } from "@/components/client/WorkoutDay"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/**
 * A `flexibility` stretch the coach prescribed reps for. The category hides reps
 * by default — but hiding a value the coach actually set means the athlete is
 * never told how many to do.
 */
function stretch(reps: string | null): ExerciseWithRecommendation {
  return {
    programExercise: {
      id: "pe-1",
      exercise_id: "ex-1",
      sets: 3,
      reps,
      rest_seconds: 45,
      duration_seconds: null,
      rpe_target: 8,
      tempo: "4-2-4",
      notes: null,
      group_tag: null,
      technique: "straight_set",
      suggested_weight_kg: null,
      requires_video: false,
      week_number: 1,
      day_of_week: 5,
    },
    exercise: {
      id: "ex-1",
      name: "Hamstring stretch",
      category: ["flexibility"],
      load_type: "total",
      is_bodyweight: true,
      video_url: null,
      muscle_group: "hamstrings",
      movement_pattern: "hinge",
      training_intent: null,
    },
    recommendation: { recommended_kg: null, trend: "stable", reason: null, confidence: "low" },
    loggedToday: false,
    savedSetDetails: null,
    videoSubmission: null,
    isFavorited: false,
  } as unknown as ExerciseWithRecommendation
}

function renderDay(item: ExerciseWithRecommendation) {
  return render(
    <WeightUnitProvider initialUnit="kg">
      <WorkoutDay day={5} dayLabel="Friday" exercises={[item]} assignmentId="a-1" userId="u-1" displayWeek={1} />
    </WeightUnitProvider>,
  )
}

describe("WorkoutDay — the prescription an athlete is shown", () => {
  it("shows the prescribed reps on a stretch whose category hides reps by default", () => {
    const { container } = renderDay(stretch("8"))

    const cell = container.querySelector("div.leading-tight span")
    expect(cell, "no prescription cells rendered at all").not.toBeNull()

    const labels = Array.from(container.querySelectorAll("div.leading-tight")).map((n) => n.textContent)
    expect(labels.some((t) => t?.startsWith("Reps8"))).toBe(true)
    // Controls: the siblings that were already value-driven still render.
    expect(labels.some((t) => t?.startsWith("Sets3"))).toBe(true)
    expect(labels.some((t) => t?.startsWith("Rest"))).toBe(true)
  })

  it("shows no Reps cell when the coach prescribed none", () => {
    const { container } = renderDay(stretch(null))

    const labels = Array.from(container.querySelectorAll("div.leading-tight")).map((n) => n.textContent)
    // Presence control: the card DID render its other prescription cells.
    expect(labels.some((t) => t?.startsWith("Sets3"))).toBe(true)
    expect(labels.some((t) => t?.startsWith("Reps"))).toBe(false)
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WorkoutDay } from "@/components/client/WorkoutDay"
import { WeightUnitProvider } from "@/hooks/use-weight-unit"
import type { ExerciseWithRecommendation } from "@/components/client/WorkoutDay"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

/**
 * The set table starts from the coach's prescription, and refills only from the
 * sets the page hands it: the log saved for THIS week and day (savedSetsForSlot,
 * pinned in program-weeks.test.ts). Coach wrote 2 x 6 for Box Deceleration
 * jumps in week 9; the athlete's table used to open at 3 x 5, last session's.
 */
function boxJumps(opts: { loggedToday: boolean; saved: boolean }): ExerciseWithRecommendation {
  return {
    programExercise: {
      id: "pe-1",
      exercise_id: "ex-1",
      sets: 2,
      reps: "6",
      rest_seconds: 90,
      duration_seconds: null,
      rpe_target: 7,
      tempo: null,
      notes: null,
      group_tag: null,
      technique: "straight_set",
      suggested_weight_kg: 20,
      requires_video: false,
      week_number: 9,
      day_of_week: 2,
    },
    exercise: {
      id: "ex-1",
      name: "Box Deceleration jumps",
      category: ["strength"],
      load_type: "total",
      is_bodyweight: false,
      video_url: null,
      muscle_group: "quadriceps",
      movement_pattern: "squat",
      training_intent: null,
    },
    recommendation: { recommended_kg: 20, trend: "stable", reasoning: "", confidence: "high" },
    loggedToday: opts.loggedToday,
    // What the athlete saved for this slot: 3 sets of 5.
    savedSetDetails: opts.saved ? [1, 2, 3].map((n) => ({ set_number: n, weight_kg: 20, reps: 5, rpe: null })) : null,
    videoSubmission: null,
    isFavorited: false,
  } as unknown as ExerciseWithRecommendation
}

function openCard(item: ExerciseWithRecommendation) {
  const view = render(
    <WeightUnitProvider initialUnit="kg">
      <WorkoutDay day={2} dayLabel="Tuesday" exercises={[item]} assignmentId="a-1" userId="u-1" displayWeek={9} />
    </WeightUnitProvider>,
  )
  fireEvent.click(screen.getByRole("button", { expanded: false, name: /Box Deceleration jumps/ }))
  // Reps inputs carry the prescribed reps as their placeholder.
  return Array.from(view.container.querySelectorAll<HTMLInputElement>('input[placeholder="6"]'))
}

describe("WorkoutDay — the set table starts from the coach's prescription", () => {
  it("nothing saved for this slot: one row per prescribed set, no reps filled in", () => {
    const reps = openCard(boxJumps({ loggedToday: false, saved: false }))
    expect(reps.map((i) => i.value)).toEqual(["", ""])
  })

  // The regression e0b3c055 shipped: it refilled only when `loggedToday`, which the
  // page sets only inside the assignment's current_week. An athlete training week 9
  // with current_week stuck at 1 reopened the exercise to a blank form.
  it("saved for this slot, outside the current week: brings back exactly what the athlete saved", () => {
    const reps = openCard(boxJumps({ loggedToday: false, saved: true }))
    expect(reps.map((i) => i.value)).toEqual(["5", "5", "5"])
  })
})

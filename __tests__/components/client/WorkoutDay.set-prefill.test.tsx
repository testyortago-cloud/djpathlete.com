// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WorkoutDay } from "@/components/client/WorkoutDay"
import { WeightUnitProvider } from "@/hooks/use-weight-unit"
import type { ExerciseWithRecommendation } from "@/components/client/WorkoutDay"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

/**
 * The bug these pin: the set table was prefilled from the athlete's most recent
 * log of the EXERCISE, from any week. Coach wrote 2 x 6 for Box Deceleration
 * jumps in week 9; the athlete's table opened at 3 x 5, last session's numbers.
 * In prod 828 of 3531 prefilled slots (30 of 32 athletes) disagreed with the coach.
 */
function boxJumps(opts: { loggedToday: boolean }): ExerciseWithRecommendation {
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
    // Last session: 3 sets of 5.
    savedSetDetails: [1, 2, 3].map((n) => ({ set_number: n, weight_kg: 20, reps: 5, rpe: null })),
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
  it("not logged today: one row per prescribed set, no reps copied from last session", () => {
    const reps = openCard(boxJumps({ loggedToday: false }))
    expect(reps.map((i) => i.value)).toEqual(["", ""])
  })

  // Presence control: the "saved then gone" fix (79578fe2) still brings back what
  // the athlete entered today, so the test above is not passing on an empty table.
  it("logged today: brings back exactly what the athlete saved", () => {
    const reps = openCard(boxJumps({ loggedToday: true }))
    expect(reps.map((i) => i.value)).toEqual(["5", "5", "5"])
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { WorkoutDay } from "@/components/client/WorkoutDay"
import { WeightUnitProvider } from "@/hooks/use-weight-unit"
import type { ExerciseWithRecommendation } from "@/components/client/WorkoutDay"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const item = {
  programExercise: {
    id: "pe-1",
    exercise_id: "ex-1",
    sets: 1,
    reps: "10",
    rest_seconds: 60,
    notes: null,
    group_tag: null,
    technique: "straight",
    suggested_weight_kg: 60,
    requires_video: false,
    week_number: 3,
    day_of_week: 2,
  },
  exercise: {
    id: "ex-1",
    name: "Back Squat",
    category: ["strength"],
    load_type: "total",
    is_bodyweight: false,
    video_url: null,
    muscle_group: "legs",
    movement_pattern: "squat",
    training_intent: null,
  },
  recommendation: { recommended_kg: 60, trend: "stable", reason: null, confidence: "medium" },
  loggedToday: false,
  savedSetDetails: null,
  videoSubmission: null,
  isFavorited: false,
} as unknown as ExerciseWithRecommendation

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ progress: { id: "p1" }, achievements: [] }),
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function bodyOf(call: unknown[]) {
  return JSON.parse((call[1] as RequestInit).body as string)
}

describe("WorkoutDay — a logged set names the program day it belongs to", () => {
  it("sends week_number, day_of_week and the client-local date with the log", async () => {
    render(
      <WeightUnitProvider initialUnit="kg">
        <WorkoutDay
          day={2}
          dayLabel="Lower"
          exercises={[item]}
          assignmentId="assign-1"
          userId="user-1"
          displayWeek={3}
        />
      </WeightUnitProvider>,
    )

    fireEvent.click(screen.getByRole("button", { expanded: false }))
    fireEvent.change(screen.getByPlaceholderText("10"), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: /save workout/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/client/workouts/log"))
    expect(call, "no POST to the workout log route").toBeDefined()

    const body = bodyOf(call!)
    // Without these three the server cannot find-or-create the day's workout_session,
    // and the set is stored loose with a NULL session_id.
    expect(body.week_number).toBe(3)
    expect(body.day_of_week).toBe(2)
    const d = new Date()
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    expect(body.session_date).toBe(localToday)
  })
})

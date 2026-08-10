import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WorkoutTabs } from "@/components/client/WorkoutTabs"
import type { ExerciseWithRecommendation } from "@/components/client/WorkoutDay"

// The day's exercise list is not what's under test — the week gate is. Stub it so
// the assertions can't be confused by anything the real card renders.
vi.mock("@/components/client/WorkoutDay", () => ({
  WorkoutDay: ({ dayLabel }: { dayLabel: string }) => <div data-testid="workout-day">{dayLabel}</div>,
}))

function exercise(id: string): ExerciseWithRecommendation {
  return {
    programExercise: { id: `pe-${id}`, requires_video: false },
    exercise: { id, name: `Exercise ${id}`, load_type: "total" },
    recommendation: {},
    loggedToday: false,
    savedSetDetails: null,
    videoSubmission: null,
  } as unknown as ExerciseWithRecommendation
}

/** A 3-week program whose `current_week` (1) has drifted behind the week the client trains. */
function program(overrides: Record<string, unknown> = {}) {
  const days = [{ day: 1, dayLabel: "Push", assignmentId: "assign-1", exercises: [exercise("ex-1")] }]
  return {
    programName: "Test Program",
    category: "strength",
    difficulty: "intermediate",
    periodization: null,
    splitType: null,
    assignmentId: "assign-1",
    userId: "user-1",
    currentWeek: 1,
    totalWeeks: 3,
    weeks: { 1: days, 2: days, 3: days },
    lockedWeeks: {},
    ...overrides,
  }
}

function renderTabs(overrides: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<WorkoutTabs programs={[program(overrides)] as any} todayDow={1} />)
}

describe("WorkoutTabs — finish session availability", () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it("offers Finish session on the current week", () => {
    renderTabs()
    expect(screen.getByRole("button", { name: /finish session/i })).toBeInTheDocument()
  })

  it("still offers Finish session after the client browses to another week", () => {
    renderTabs()

    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    // "Previous week" is disabled on week 1 — enabled proves the week actually moved.
    expect(screen.getByRole("button", { name: /previous week/i })).toBeEnabled()

    // A client whose current_week lags behind reality trains on a later week — they
    // must still be able to record the session RPE and finish there.
    expect(screen.getByRole("button", { name: /finish session/i })).toBeInTheDocument()
  })

  it("offers the recovery check on a non-current week too", () => {
    renderTabs()

    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    expect(screen.getByRole("button", { name: /start session/i })).toBeInTheDocument()
  })

  it("hides Finish session on a week that is locked behind payment", () => {
    renderTabs({ lockedWeeks: { 2: { priceCents: 2500 } } })

    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    // The lock card itself sits inside AnimatePresence (which doesn't settle in
    // jsdom); the selector's own "Payment required" label proves week 2 is locked.
    expect(screen.getByText(/payment required/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /finish session/i })).not.toBeInTheDocument()
  })

  it("hides Finish session on a rest day (no exercises)", () => {
    renderTabs({ weeks: { 1: [{ day: 1, dayLabel: "Push", assignmentId: "assign-1", exercises: [exercise("ex-1")] }], 2: [] } })

    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    expect(screen.queryByRole("button", { name: /finish session/i })).not.toBeInTheDocument()
  })
})

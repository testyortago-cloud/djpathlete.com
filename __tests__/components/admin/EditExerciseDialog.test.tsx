// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { EditExerciseDialog } from "@/components/admin/EditExerciseDialog"
import { AdminWeightUnitProvider } from "@/hooks/use-admin-weight-unit"
import type { Exercise, ProgramExercise } from "@/types/database"

/**
 * A stretch really prescribed like a strength lift. `flexibility` hides reps /
 * rest / RPE by default, but this saved row carries all three — production has
 * hundreds like it (AI-generated programs and hand edits both produce them).
 */
function flexibilityRow(overrides: Partial<ProgramExercise> = {}): ProgramExercise & { exercises: Exercise } {
  return {
    id: "pe-1",
    program_id: "prog-1",
    exercise_id: "ex-1",
    day_of_week: 1,
    week_number: 1,
    order_index: 0,
    sets: 4,
    reps: "8",
    duration_seconds: null,
    rest_seconds: 45,
    notes: null,
    rpe_target: 7,
    intensity_pct: null,
    tempo: "4-2-4",
    group_tag: null,
    technique: "straight_set",
    suggested_weight_kg: null,
    requires_video: false,
    slot_role: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
    exercises: {
      id: "ex-1",
      name: "Lat streches with band_Back",
      category: ["flexibility"],
      instructions: null,
    } as unknown as Exercise,
  }
}

function renderDialog(programExercise: ProgramExercise & { exercises: Exercise }) {
  return render(
    <AdminWeightUnitProvider>
      <EditExerciseDialog
        open
        onOpenChange={() => {}}
        programId="prog-1"
        programExercise={programExercise}
        dayExercises={[programExercise]}
      />
    </AdminWeightUnitProvider>,
  )
}

describe("<EditExerciseDialog> — fields the category hides but the row carries", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("offers reps, rest and RPE for editing when the saved row has them", () => {
    renderDialog(flexibilityRow())

    expect(screen.getByLabelText(/^reps/i)).toHaveValue("8")
    expect(screen.getByLabelText(/^rest/i)).toHaveValue(45)
    expect(screen.getByLabelText(/^rpe target/i)).toHaveValue(7)
  })

  it("still hides reps, rest and RPE on a stretch that has none of them", () => {
    renderDialog(flexibilityRow({ reps: null, rest_seconds: null, rpe_target: null }))

    // Control: the dialog did render — Sets and Duration are always offered here.
    expect(screen.getByLabelText(/^sets/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/duration per set/i)).toBeInTheDocument()

    expect(screen.queryByLabelText(/^reps/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^rest/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^rpe target/i)).not.toBeInTheDocument()
  })

  it("does not null out reps, rest or RPE when the coach saves an unrelated edit", async () => {
    const user = userEvent.setup()
    renderDialog(flexibilityRow())

    await user.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.reps).toBe("8")
    expect(body.rest_seconds).toBe("45")
    expect(body.rpe_target).toBe("7")
    expect(body.tempo).toBe("4-2-4")
  })

  it("omits a field it never rendered rather than sending null for it", async () => {
    const user = userEvent.setup()
    renderDialog(flexibilityRow({ reps: null, rest_seconds: null, rpe_target: null }))

    await user.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    // The PATCH route writes every key PRESENT in the body, so a key with a null
    // value is an erase instruction — a field the form never showed must not send one.
    expect(body).not.toHaveProperty("reps")
    expect(body).not.toHaveProperty("rest_seconds")
    expect(body).not.toHaveProperty("rpe_target")
    // Control: fields the form DID render are still sent.
    expect(body).toHaveProperty("sets")
    expect(body).toHaveProperty("duration_seconds")
  })
})

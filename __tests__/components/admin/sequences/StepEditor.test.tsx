// @vitest-environment jsdom
// __tests__/components/admin/sequences/StepEditor.test.tsx
//
// The step editor: add / edit / reorder / remove a sequence's steps, then
// PUT the whole list. Validation and the partway-through plan both come
// straight from lib/lead-engine/step-list.ts — this file never re-implements
// either rule, it only checks the component reads them correctly.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { StepEditor } from "@/components/admin/sequences/StepEditor"
import { planStepSave, type StepDraft, type SavedStep, type RunPointer } from "@/lib/lead-engine/step-list"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// next/navigation's useRouter is globally mocked in __tests__/setup.tsx.

beforeEach(() => {
  vi.clearAllMocks()
})

/** A step with everything nulled out except what the test cares about — same shape as step-list.test.ts's helper. */
function step(kind: StepDraft["kind"], over: Partial<StepDraft> = {}): StepDraft {
  return {
    id: null,
    kind,
    wait_minutes: kind === "wait" ? 60 : null,
    subject: kind === "email" ? "Hello" : null,
    body: kind === "email" || kind === "sms" ? "Body text" : null,
    branch_condition: kind === "branch" ? { kind: "has_phone" } : null,
    on_true_position: null,
    on_false_position: null,
    config: kind === "tag" ? { tag: "warm" } : kind === "stage" ? { stage: "consulted" } : {},
    ...over,
  }
}

function renderEditor(
  over: Partial<{
    initialSteps: StepDraft[]
    oldSteps: SavedStep[]
    runs: RunPointer[]
    sentCountByStepId: Record<string, number>
  }> = {},
) {
  const initialSteps = over.initialSteps ?? [step("stop")]
  return render(
    <StepEditor
      sequenceKey="cold_lead"
      sequenceName="Cold Lead"
      initialSteps={initialSteps}
      oldSteps={over.oldSteps ?? []}
      runs={over.runs ?? []}
      sentCountByStepId={over.sentCountByStepId ?? {}}
    />,
  )
}

describe("<StepEditor> — every kind has a plain-language name", () => {
  it("shows the human name for all eight stored kinds", () => {
    const kinds: StepDraft["kind"][] = ["email", "sms", "wait", "branch", "tag", "stage", "alert", "stop"]
    const initialSteps = kinds.map((k, i) => step(k, { id: `step-${i}` }))
    renderEditor({ initialSteps })

    const labels = [
      "Send an email",
      "Send a text",
      "Wait",
      "Split the path",
      "Add a label",
      "Move their card",
      "Tell the coach",
      "End here",
    ]

    // getByDisplayValue on a <select> matches the SELECTED option's text, so
    // this fails if the stored value ("email", "tag", ...) leaks onto the
    // screen instead of its plain-language name. Scoped to each step's own
    // card — the "add a step" kind picker at the bottom of the screen also
    // defaults to showing one of these labels ("Send an email"), so an
    // unscoped query would find two matches for that one.
    labels.forEach((label, i) => {
      const card = screen.getByTestId(`step-${i}`)
      expect(within(card).getByDisplayValue(label)).toBeInTheDocument()
    })

    // None of the raw stored values should be readable text anywhere.
    for (const raw of kinds) {
      expect(screen.queryByText(raw, { selector: "p, span, h3, div" })).not.toBeInTheDocument()
    }
  })

  it("carries the split-path warning sentence, verbatim from the brief", () => {
    renderEditor({ initialSteps: [step("branch", { id: "b1" }), step("stop", { id: "b2" })] })
    expect(screen.getByText("Each side needs its own ending, or the same person gets both.")).toBeInTheDocument()
  })
})

describe("<StepEditor> — adding a tag step and saving", () => {
  it("sends config: { tag } for a newly added label step", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, plan: { repoint: [], exit: [], unchanged: [] } }),
    }) as unknown as typeof fetch

    renderEditor({ initialSteps: [] })

    fireEvent.change(screen.getByLabelText(/kind of step to add/i), { target: { value: "tag" } })
    fireEvent.click(screen.getByRole("button", { name: /add a step/i }))

    const tagInput = screen.getByLabelText(/the label to add/i)
    fireEvent.change(tagInput, { target: { value: "vip" } })

    const saveButton = screen.getByRole("button", { name: /save changes/i })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/api/admin/sequences/cold_lead/steps")
    const body = JSON.parse((init as RequestInit).body as string) as { steps: StepDraft[] }
    expect(body.steps).toHaveLength(1)
    expect(body.steps[0].kind).toBe("tag")
    expect(body.steps[0].config).toEqual({ tag: "vip" })
  })
})

describe("<StepEditor> — validation blocks save", () => {
  it("disables Save and names the broken step when a problem exists", () => {
    // An email step with no subject and no body — validateStepList flags both.
    renderEditor({ initialSteps: [step("email", { id: "e1", subject: "", body: "" })] })

    const saveButton = screen.getByRole("button", { name: /save changes/i })
    expect(saveButton).toBeDisabled()
    expect(screen.getByText(/Step 1: This email has no subject line\./)).toBeInTheDocument()
    expect(screen.getByText(/Step 1: This email has nothing written in it\./)).toBeInTheDocument()
  })

  it("presence control: a fully valid single step enables Save", () => {
    // Pairs with the test above — proves the disabled state above is caused
    // by the problem, not by something that disables Save unconditionally.
    renderEditor({ initialSteps: [step("stop")] })
    expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled()
  })

  it("never calls the route when a problem is showing, even if Save is clicked", async () => {
    global.fetch = vi.fn()
    renderEditor({ initialSteps: [step("email", { id: "e1", subject: "", body: "" })] })
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }))
    await new Promise((r) => setTimeout(r, 10))
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe("<StepEditor> — a step that has already been sent cannot be removed", () => {
  it("disables the remove control and shows the sent count, in the brief's exact sentence", () => {
    renderEditor({
      initialSteps: [step("email", { id: "e1" })],
      sentCountByStepId: { e1: 12 },
    })
    const card = screen.getByTestId("step-0")
    expect(within(card).getByRole("button", { name: /remove step 1/i })).toBeDisabled()
    expect(
      screen.getByText(
        "This step has already been sent to 12 people, so it cannot be removed. You can change what it says, or switch the whole sequence off.",
      ),
    ).toBeInTheDocument()
  })

  it("presence control: a step with no sends has its remove control enabled", () => {
    // Pairs with the test above — proves the disabled state there is caused
    // by the sent count, not by remove being disabled unconditionally.
    renderEditor({
      initialSteps: [step("email", { id: "e1" })],
      sentCountByStepId: {},
    })
    const card = screen.getByTestId("step-0")
    expect(within(card).getByRole("button", { name: /remove step 1/i })).not.toBeDisabled()
  })
})

describe("<StepEditor> — the partway-through summary is derived from planStepSave", () => {
  it("matches planStepSave's own repoint/exit split exactly", () => {
    // Four runs, matching the brief's own worked example: 3 carry on
    // (one unchanged, one repointed), 1 is stopped because its step is gone.
    const oldSteps: SavedStep[] = [
      { id: "s0", position: 0 },
      { id: "s1", position: 1 },
      { id: "s2", position: 2 },
    ]
    // New list: s1 moves to position 0, s0 is dropped, s2 stays at the end.
    const initialSteps: StepDraft[] = [step("email", { id: "s1" }), step("stop", { id: "s2" })]
    const runs: RunPointer[] = [
      { id: "r1", current_position: 1 }, // s1 -> repointed to 0
      { id: "r2", current_position: 1 }, // s1 -> repointed to 0
      { id: "r3", current_position: 2 }, // s2 -> unchanged (stays at 1)
      { id: "r4", current_position: 0 }, // s0 -> removed -> exited
    ]

    // Independently computed, exactly like the component must do internally.
    const expectedPlan = planStepSave(oldSteps, initialSteps, runs)
    const expectedCarryOn = expectedPlan.unchanged.length + expectedPlan.repoint.length
    const expectedStopped = expectedPlan.exit.length
    expect(expectedCarryOn).toBe(3)
    expect(expectedStopped).toBe(1)

    renderEditor({ initialSteps, oldSteps, runs })

    expect(
      screen.getByText(
        "4 people are partway through. 3 will carry on where they are. 1 will be stopped, because the step they were on has been removed.",
      ),
    ).toBeInTheDocument()
  })

  it("shows nothing when nobody is partway through", () => {
    renderEditor({ initialSteps: [step("stop")], oldSteps: [], runs: [] })
    expect(screen.queryByText(/partway through/i)).not.toBeInTheDocument()
  })
})

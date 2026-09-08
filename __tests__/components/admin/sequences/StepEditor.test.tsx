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

// A spy on StepEditorDirtyContext's real default value — every test in this
// file renders StepEditor with no real StepEditorDirtyProvider around it, the
// same as the real detail screen would if the provider were ever removed, so
// this must be a harmless no-op (see that file's own header for why).
const setDirtySpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/admin/sequences/StepEditorDirtyContext", () => ({
  useStepEditorDirty: () => ({ dirty: false, setDirty: setDirtySpy }),
}))

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
    // Four old steps, four runs. The "3 carry on" bucket is deliberately made
    // of BOTH an unchanged run and a repointed run — carryOn is
    // unchanged.length + repoint.length, and a fixture that only ever
    // produces one of the two terms would let a mutation that drops either
    // term from that sum survive.
    const oldSteps: SavedStep[] = [
      { id: "s0", position: 0 },
      { id: "s1", position: 1 },
      { id: "s2", position: 2 },
      { id: "s3", position: 3 },
    ]
    // New list: s0 is dropped, s3 moves up to the front, s1 and s2 keep their
    // positions exactly.
    const initialSteps: StepDraft[] = [
      step("email", { id: "s3" }),
      step("email", { id: "s1" }),
      step("stop", { id: "s2" }),
    ]
    const runs: RunPointer[] = [
      { id: "r1", current_position: 3 }, // s3 -> repointed, 3 to 0
      { id: "r2", current_position: 1 }, // s1 -> unchanged, stays at 1
      { id: "r3", current_position: 2 }, // s2 -> unchanged, stays at 2
      { id: "r4", current_position: 0 }, // s0 -> removed -> exited
    ]

    // Independently computed, exactly like the component must do internally.
    const expectedPlan = planStepSave(oldSteps, initialSteps, runs)
    expect(expectedPlan.unchanged).toHaveLength(2)
    expect(expectedPlan.repoint).toHaveLength(1)
    expect(expectedPlan.exit).toHaveLength(1)
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

/**
 * `branch(true -> 1, false -> 3)`, then the true arm (e1, s2) and the false
 * arm (e3, s4) each ending in their own `stop`. Used by the reorder tests
 * below: branch targets are held by step identity (`branchTrueKey` /
 * `branchFalseKey`), not by array index, precisely so a reorder can change
 * every index in the list without silently repointing a branch at the wrong
 * step. These tests pin THAT invariant — not merely "the numbers didn't
 * change", which would be true by coincidence for a list this shape and
 * would say nothing about whether identity survived the move.
 */
function branchFixture(): StepDraft[] {
  return [
    step("branch", { id: "b0", on_true_position: 1, on_false_position: 3 }),
    step("email", { id: "e1" }),
    step("stop", { id: "s2" }),
    step("email", { id: "e3" }),
    step("stop", { id: "s4" }),
  ]
}

describe("<StepEditor> — reorder keeps branch targets pointed at the same steps", () => {
  it("a reorder that keeps both arms intact still saves the branch pointing at the same STEPS, even though the position numbers move", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, plan: { repoint: [], exit: [], unchanged: [] } }),
    }) as unknown as typeof fetch

    renderEditor({ initialSteps: branchFixture() })

    // Move the false arm's OWN closing step ("stop", s4, last in the list) up
    // one, swapping it with the false arm's email (e3). Both moved steps stay
    // inside the false arm, so this cannot merge the two arms — a legal,
    // saveable reorder that nonetheless changes the false arm's target
    // position (3 -> 4).
    fireEvent.click(screen.getByRole("button", { name: /move step 5 up/i }))

    const saveButton = screen.getByRole("button", { name: /save changes/i })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string) as { steps: StepDraft[] }
    const branchDraft = body.steps[0]

    expect(branchDraft.kind).toBe("branch")
    expect(branchDraft.on_true_position).not.toBeNull()
    expect(branchDraft.on_false_position).not.toBeNull()

    // The real assertion: look up WHICH STEP each position number now names,
    // and check it is the same step the branch pointed at before the move —
    // not that the number itself happens to match some expectation.
    expect(body.steps[branchDraft.on_true_position as number].id).toBe("e1")
    expect(body.steps[branchDraft.on_false_position as number].id).toBe("e3")

    // And the number really did move (3 -> 4) — proving this fixture
    // exercises the remap rather than passing by coincidence on a no-op.
    expect(branchDraft.on_false_position).toBe(4)
  })

  it("a reorder that merges the two arms is caught by validation and never saved", async () => {
    global.fetch = vi.fn()
    renderEditor({ initialSteps: branchFixture() })

    // Move the false arm's target ("email", e3, originally at index 3) up
    // one, swapping it with "stop" (s2) — the step that currently ENDS the
    // true arm. The false arm's own target correctly follows e3 to its new
    // position (3 -> 2), but the true arm's implicit fallthrough (e1's own
    // next step) now ALSO lands on position 2 — the two arms collide, and
    // the same person would get both endings.
    fireEvent.click(screen.getByRole("button", { name: /move step 4 up/i }))

    expect(
      screen.getByText(
        "Step 1: One side of this split runs on into the other, so the same person would get both endings.",
      ),
    ).toBeInTheDocument()

    const saveButton = screen.getByRole("button", { name: /save changes/i })
    expect(saveButton).toBeDisabled()

    fireEvent.click(saveButton)
    await new Promise((r) => setTimeout(r, 10))
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe("<StepEditor> — reordering moves exactly one step to the target position", () => {
  it("keeps every step, with the moved step landing where it was dropped and nothing lost or duplicated", () => {
    const initialSteps: StepDraft[] = [
      step("email", { id: "a", subject: "First" }),
      step("email", { id: "b", subject: "Second" }),
      step("email", { id: "c", subject: "Third" }),
    ]
    renderEditor({ initialSteps })

    fireEvent.click(screen.getByRole("button", { name: /move step 2 up/i }))

    // Still exactly three steps — none lost, none duplicated by the splice.
    expect(screen.getByTestId("step-0")).toBeInTheDocument()
    expect(screen.getByTestId("step-1")).toBeInTheDocument()
    expect(screen.getByTestId("step-2")).toBeInTheDocument()
    expect(screen.queryByTestId("step-3")).not.toBeInTheDocument()

    const subjectAt = (index: number) =>
      (within(screen.getByTestId(`step-${index}`)).getByLabelText(/subject line/i) as HTMLInputElement).value

    // "Second" moved up to the front; "First" shifted down to make room;
    // "Third" (untouched by the move) stays exactly where it was.
    expect(subjectAt(0)).toBe("Second")
    expect(subjectAt(1)).toBe("First")
    expect(subjectAt(2)).toBe("Third")
  })
})

describe("<StepEditor> — reports its own dirtiness (whole-branch review, Important 2)", () => {
  it("reports NOT dirty on first render, when steps match what was loaded", () => {
    renderEditor({ initialSteps: [step("email", { id: "e1" })] })
    expect(setDirtySpy).toHaveBeenCalledWith(false)
    expect(setDirtySpy).not.toHaveBeenCalledWith(true)
  })

  it("reports dirty the moment a field is edited", () => {
    renderEditor({ initialSteps: [step("email", { id: "e1" })] })
    setDirtySpy.mockClear()

    fireEvent.change(screen.getByLabelText(/subject line/i), { target: { value: "A new subject" } })

    expect(setDirtySpy).toHaveBeenCalledWith(true)
  })

  it("reports dirty the moment a step is added", () => {
    renderEditor({ initialSteps: [step("stop", { id: "s1" })] })
    setDirtySpy.mockClear()

    fireEvent.click(screen.getByRole("button", { name: /add a step/i }))

    expect(setDirtySpy).toHaveBeenCalledWith(true)
  })

  it("reports dirty the moment a step is reordered, even with no content change", () => {
    renderEditor({
      initialSteps: [step("email", { id: "a" }), step("email", { id: "b" })],
    })
    setDirtySpy.mockClear()

    fireEvent.click(screen.getByRole("button", { name: /move step 2 up/i }))

    expect(setDirtySpy).toHaveBeenCalledWith(true)
  })

  it("reports NOT dirty again once the props catch up after a save (router.refresh cycle)", () => {
    const initialSteps = [step("email", { id: "e1" })]
    const { rerender } = renderEditor({ initialSteps })
    setDirtySpy.mockClear()

    fireEvent.change(screen.getByLabelText(/subject line/i), { target: { value: "Edited" } })
    expect(setDirtySpy).toHaveBeenCalledWith(true)
    setDirtySpy.mockClear()

    // Simulates the server component re-rendering with the coach's own edit
    // now reflected in initialSteps — the shape after a real save + refresh.
    rerender(
      <StepEditor
        sequenceKey="cold_lead"
        sequenceName="Cold Lead"
        initialSteps={[step("email", { id: "e1", subject: "Edited" })]}
        oldSteps={[]}
        runs={[]}
        sentCountByStepId={{}}
      />,
    )

    expect(setDirtySpy).toHaveBeenCalledWith(false)
  })
})

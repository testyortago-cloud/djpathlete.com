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

describe("<StepEditor> — every offered split rule can actually be CHOSEN", () => {
  // THE BUG THIS EXISTS FOR (live on production from 816892cf until this fix):
  // G09 added `opened_last_email` and `clicked_last_email` to BRANCH_KIND_ORDER
  // and BRANCH_KIND_LABEL, so both rendered in the dropdown and read correctly —
  // but `setConditionKind` was an if-chain over the ORIGINAL four kinds with an
  // `else` that set `branch_condition: null`. Picking either new rule silently
  // cleared the condition, and `validateStepList` then refused the save with
  // "This split does not say which people go down each side" — against the rule
  // the coach had just picked.
  //
  // Four separate guards passed: the union, the Zod schema, KNOWN_BRANCH_KINDS
  // and branch-kinds-agree.test.ts. None of them could catch it, because a
  // Record over the union proves a LABEL exists, not that the condition can be
  // BUILT. This test walks what a human can actually click.

  function optionValues(select: HTMLSelectElement): string[] {
    return Array.from(select.querySelectorAll("option"))
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== "")
  }

  it("keeps the selection for every rule offered, rather than falling back to none", () => {
    renderEditor({ initialSteps: [step("branch", { id: "b1" }), step("stop", { id: "b2" })] })

    const select = screen.getByLabelText("Step 1 split rule") as HTMLSelectElement
    const offered = optionValues(select)

    // A presence control: if the dropdown ever renders no options, the loop
    // below would pass by doing nothing at all.
    expect(offered.length).toBeGreaterThanOrEqual(4)
    expect(offered).toContain("clicked_last_email")
    expect(offered).toContain("opened_last_email")

    for (const value of offered) {
      fireEvent.change(select, { target: { value } })
      // The component is controlled from `branch_condition.kind`. If the
      // condition came back null the select reverts to "" — which is exactly
      // how the bug presented, and is invisible to any assertion that only
      // checks the option exists.
      expect(
        (screen.getByLabelText("Step 1 split rule") as HTMLSelectElement).value,
        `picking "${value}" did not stick — setConditionKind has no arm for it`,
      ).toBe(value)
    }
  })

  it("clears the condition when the coach picks \u201CChoose one\u2026\u201D, rather than throwing", () => {
    // The empty option is the ONLY legitimate route to a null condition, and it
    // is why the raw DOM value is narrowed against BRANCH_KIND_ORDER before the
    // exhaustive switch sees it. Feed "" straight to that switch and it reaches
    // the `never` arm and throws — taking the whole editor down instead of
    // clearing one field.
    renderEditor({ initialSteps: [step("branch", { id: "b1" }), step("stop", { id: "b2" })] })

    const select = screen.getByLabelText("Step 1 split rule") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "clicked_last_email" } })
    expect((screen.getByLabelText("Step 1 split rule") as HTMLSelectElement).value).toBe("clicked_last_email")

    expect(() => fireEvent.change(select, { target: { value: "" } })).not.toThrow()
    expect((screen.getByLabelText("Step 1 split rule") as HTMLSelectElement).value).toBe("")
  })

  it("saves a clicked_last_email split through the real PUT body", async () => {
    // Selection sticking in the DOM is necessary but not sufficient: the
    // condition still has to survive validation and reach the request.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal("fetch", fetchMock)

    renderEditor({ initialSteps: [step("branch", { id: "b1" }), step("stop", { id: "b2" })] })

    fireEvent.change(screen.getByLabelText("Step 1 split rule"), {
      target: { value: "clicked_last_email" },
    })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    const branchStep = (body.steps as Array<Record<string, unknown>>).find((st) => st.kind === "branch")
    expect(branchStep?.branch_condition).toEqual({ kind: "clicked_last_email" })

    vi.unstubAllGlobals()
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

// ---------------------------------------------------------------------------
// Picking a split rule and getting back the condition you picked.
//
// The dropdown, the labels and the condition BUILDER are three separate
// lists, and only the labels are compiler-checked (BRANCH_KIND_LABEL is a
// Record over the union). So a predicate can be offered in the dropdown, have
// a label written for it, and still fall through the builder's `else` to
// `null` — which shows up as "This split does not say which people go down
// each side" against a rule the coach just chose, with no way to get past it.
// That is exactly what G09 shipped for its two new predicates; this block is
// the guard.
// ---------------------------------------------------------------------------

describe("<StepEditor> — every offered split rule can actually be chosen", () => {
  /** The saveable list `branchFixture` builds, but with the branch's rule left unset. */
  function unsetBranchSteps(): StepDraft[] {
    return [
      step("branch", { id: "b1", branch_condition: null, on_true_position: 1, on_false_position: 2 }),
      step("stop", { id: "s1" }),
      step("stop", { id: "s2" }),
    ]
  }

  function chooseRule(value: string) {
    fireEvent.change(screen.getByLabelText(/step 1 split rule/i), { target: { value } })
  }

  it("offers exactly the rules the engine can evaluate, and no others", () => {
    renderEditor({ initialSteps: unsetBranchSteps() })
    const options = within(screen.getByLabelText(/step 1 split rule/i))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v.length > 0)

    expect(options.sort()).toEqual(
      [
        "clicked_last_email",
        "enrolled_metadata_is",
        "has_consent",
        "has_phone",
        "has_user",
        "opened_last_email",
        "source_is",
      ].sort(),
    )
  })

  it("every rule in the dropdown produces a saveable condition — none of them silently clears the field", async () => {
    // READ OFF THE RENDERED DROPDOWN, never a list written here. With a
    // hand-written array this test could not catch the thing it exists for:
    // someone adds an eighth predicate, tsc forces the label, they add it to
    // BRANCH_KIND_ORDER and forget `setConditionKind`; the "offers exactly
    // the rules the engine can evaluate" test above goes red about an
    // unexpected OPTION, the natural fix is to add the string to THAT list,
    // and the dead dropdown entry ships with the suite green. That is the
    // G09 defect happening a second time.
    const probe = renderEditor({ initialSteps: unsetBranchSteps() })
    const offered = within(screen.getByLabelText(/step 1 split rule/i))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v.length > 0)
    probe.unmount()

    expect(offered.length).toBeGreaterThan(1) // the fixture really does offer rules
    for (const value of offered) {
      const view = renderEditor({ initialSteps: unsetBranchSteps() })
      chooseRule(value)
      expect(
        (screen.getByLabelText(/step 1 split rule/i) as HTMLSelectElement).value,
        `choosing ${value} did not stick`,
      ).toBe(value)
      view.unmount()
    }
  })

  it("saves a clicked-a-link split, which before this shipped could be chosen and never saved", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, plan: { repoint: [], exit: [], unchanged: [] } }),
    }) as unknown as typeof fetch

    renderEditor({ initialSteps: unsetBranchSteps() })
    chooseRule("clicked_last_email")

    const saveButton = screen.getByRole("button", { name: /save changes/i })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string) as { steps: StepDraft[] }
    expect(body.steps[0].branch_condition).toEqual({ kind: "clicked_last_email" })
  })
})

describe("<StepEditor> — the enrolment-metadata split (G10)", () => {
  function unsetBranchSteps(): StepDraft[] {
    return [
      step("branch", { id: "b1", branch_condition: null, on_true_position: 1, on_false_position: 2 }),
      step("stop", { id: "s1" }),
      step("stop", { id: "s2" }),
    ]
  }

  it("round-trips the condition: pick the rule, pick what to check, type the answer, and that is what is saved", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, plan: { repoint: [], exit: [], unchanged: [] } }),
    }) as unknown as typeof fetch

    renderEditor({ initialSteps: unsetBranchSteps() })

    fireEvent.change(screen.getByLabelText(/step 1 split rule/i), { target: { value: "enrolled_metadata_is" } })
    fireEvent.change(screen.getByLabelText(/step 1 what to check/i), { target: { value: "event_kind" } })
    fireEvent.change(screen.getByLabelText(/step 1 answer to look for/i), { target: { value: "camp" } })

    const saveButton = screen.getByRole("button", { name: /save changes/i })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string) as { steps: StepDraft[] }
    expect(body.steps[0].branch_condition).toEqual({
      kind: "enrolled_metadata_is",
      key: "event_kind",
      value: "camp",
    })
  })

  it("opens on `service` with the answer blank, so a coach who ignores the key picker cannot build a rule that is false forever", () => {
    // The answer box starts blank and `validateStepList` only refuses a BLANK
    // answer — it cannot tell `service == "camp"` from `role == "camp"`. So the
    // key this opens on is the one a coach who never touches the key picker
    // ships. `service` is the key the most front doors write; `role` would
    // make "camp" false for everybody, and Save would still be enabled.
    renderEditor({ initialSteps: unsetBranchSteps() })
    fireEvent.change(screen.getByLabelText(/step 1 split rule/i), { target: { value: "enrolled_metadata_is" } })

    expect((screen.getByLabelText(/step 1 what to check/i) as HTMLSelectElement).value).toBe("service")
    expect((screen.getByLabelText(/step 1 answer to look for/i) as HTMLInputElement).value).toBe("")
  })

  it("reads an already-saved condition back into both fields", () => {
    renderEditor({
      initialSteps: [
        step("branch", {
          id: "b1",
          branch_condition: { kind: "enrolled_metadata_is", key: "service", value: "camp" },
          on_true_position: 1,
          on_false_position: 2,
        }),
        step("stop", { id: "s1" }),
        step("stop", { id: "s2" }),
      ],
    })

    expect((screen.getByLabelText(/step 1 what to check/i) as HTMLSelectElement).value).toBe("service")
    expect((screen.getByLabelText(/step 1 answer to look for/i) as HTMLInputElement).value).toBe("camp")
  })

  it("will not let the coach save it with the answer left blank", () => {
    // `evaluateBranch` answers false to a blank answer, so every single
    // person would go down the "no" side — indistinguishable, on the
    // reporting screen, from a rule nobody happens to match.
    renderEditor({ initialSteps: unsetBranchSteps() })
    fireEvent.change(screen.getByLabelText(/step 1 split rule/i), { target: { value: "enrolled_metadata_is" } })

    // The rule really was chosen — otherwise Save would be disabled for the
    // ordinary "no rule at all" reason and this would prove nothing.
    expect((screen.getByLabelText(/step 1 split rule/i) as HTMLSelectElement).value).toBe("enrolled_metadata_is")
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled()

    // And the control: typing an answer clears the problem.
    fireEvent.change(screen.getByLabelText(/step 1 answer to look for/i), { target: { value: "camp" } })
    expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled()
  })

  it("offers only what something actually writes, so a coach cannot build a rule that is false forever", () => {
    renderEditor({ initialSteps: unsetBranchSteps() })
    fireEvent.change(screen.getByLabelText(/step 1 split rule/i), { target: { value: "enrolled_metadata_is" } })

    const keys = within(screen.getByLabelText(/step 1 what to check/i))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)

    // G16: `sport` joined once the application form started writing it.
    expect(keys.sort()).toEqual(
      ["branch", "camp_name", "event_kind", "quiz_key", "role", "service", "sport", "tier"].sort(),
    )
  })

  it("lets a coach split on the sport the applicant typed, in words, and saves it (G16)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, plan: { repoint: [], exit: [], unchanged: [] } }),
    }) as unknown as typeof fetch

    renderEditor({ initialSteps: unsetBranchSteps() })
    fireEvent.change(screen.getByLabelText(/step 1 split rule/i), { target: { value: "enrolled_metadata_is" } })

    const keyPicker = within(screen.getByLabelText(/step 1 what to check/i))
    expect(keyPicker.getByRole("option", { name: /sport they wrote/i })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/step 1 what to check/i), { target: { value: "sport" } })
    fireEvent.change(screen.getByLabelText(/step 1 answer to look for/i), { target: { value: "soccer" } })
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string) as { steps: StepDraft[] }
    expect(body.steps[0].branch_condition).toEqual({ kind: "enrolled_metadata_is", key: "sport", value: "soccer" })
  })

  it("explains each rule in words a coach can act on, never the stored key", () => {
    renderEditor({ initialSteps: unsetBranchSteps() })
    fireEvent.change(screen.getByLabelText(/step 1 split rule/i), { target: { value: "enrolled_metadata_is" } })

    const keyPicker = within(screen.getByLabelText(/step 1 what to check/i))
    // The label a coach reads is English, not `event_kind`.
    expect(keyPicker.getByRole("option", { name: /camp or a clinic/i })).toBeInTheDocument()
    expect(keyPicker.queryByRole("option", { name: "event_kind" })).not.toBeInTheDocument()
  })
})

describe("<StepEditor> — a wait can count down to the event instead of up from now (G11)", () => {
  /** A wait step plus the stop it needs to be a legal list. */
  function waitSteps(over: Partial<StepDraft> = {}): StepDraft[] {
    return [step("wait", { id: "w1", ...over }), step("stop", { id: "s1" })]
  }

  it("starts on the ordinary 'wait a length of time' mode, so nothing changes for existing sequences", () => {
    renderEditor({ initialSteps: waitSteps() })
    expect((screen.getByLabelText(/step 1 when to send/i) as HTMLSelectElement).value).toBe("after")
    expect(screen.getByLabelText(/how many minutes to wait/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/how many days before the event/i)).not.toBeInTheDocument()
  })

  it("opens the countdown on 14 days, the first moment of the house shape", () => {
    // The same class of hole as the metadata branch's default key: whatever
    // this opens on is what a coach who does not retype it actually ships.
    // Lower stakes here — 21 would still be a working countdown, not a rule
    // that is false forever — but `camp_clinic_deadline` is seeded 14/7/3
    // (migration 00269) and a new reminder step should start where the rest
    // of the sequence starts. Mutating this to 21 survived every other test
    // in this file.
    renderEditor({ initialSteps: waitSteps() })
    fireEvent.change(screen.getByLabelText(/step 1 when to send/i), { target: { value: "before_event" } })
    expect((screen.getByLabelText(/how many days before the event/i) as HTMLInputElement).value).toBe("14")
  })

  it("shows the countdown mode for a stored wait_until of null, so the error names a field on screen", () => {
    // Review finding. `parseWaitConfig` treats a PRESENT but unreadable
    // `wait_until` as a fault (only an ABSENT one means "ordinary wait"), so
    // an editor that rendered the minutes box here would block Save with a
    // sentence about a field the coach cannot see — and re-selecting the mode
    // it already shows fires no change event, so there would be no way out.
    // Not reachable from this UI; reachable from a hand-edited row.
    renderEditor({ initialSteps: waitSteps({ wait_minutes: null, config: { wait_until: null } }) })

    expect((screen.getByLabelText(/step 1 when to send/i) as HTMLSelectElement).value).toBe("before_event")
    expect(screen.getByLabelText(/how many days before the event/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled()

    // And it is escapable: typing a number clears it without a mode switch.
    fireEvent.change(screen.getByLabelText(/how many days before the event/i), { target: { value: "7" } })
    expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled()
  })

  it("reads a saved anchored wait back into the countdown mode", () => {
    renderEditor({ initialSteps: waitSteps({ wait_minutes: null, config: { wait_until: { days_before_anchor: 7 } } }) })
    expect((screen.getByLabelText(/step 1 when to send/i) as HTMLSelectElement).value).toBe("before_event")
    expect((screen.getByLabelText(/how many days before the event/i) as HTMLInputElement).value).toBe("7")
  })

  it("saves the countdown a coach builds, and clears the minutes it replaced", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, plan: { repoint: [], exit: [], unchanged: [] } }),
    }) as unknown as typeof fetch

    renderEditor({ initialSteps: waitSteps() })
    fireEvent.change(screen.getByLabelText(/step 1 when to send/i), { target: { value: "before_event" } })
    fireEvent.change(screen.getByLabelText(/how many days before the event/i), { target: { value: "14" } })

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string) as { steps: StepDraft[] }
    expect(body.steps[0].config).toEqual({ wait_until: { days_before_anchor: 14 } })
    // The minutes MUST go. The tick ignores wait_minutes once wait_until is
    // present, so leaving 60 behind would store a number that reads as the
    // answer and is not — and migration 00268 only stops a wait having
    // NEITHER, so the database would happily keep both.
    expect(body.steps[0].wait_minutes).toBeNull()
  })

  it("switching back to a length of time clears the countdown, rather than leaving both stored", () => {
    renderEditor({ initialSteps: waitSteps({ wait_minutes: null, config: { wait_until: { days_before_anchor: 7 } } }) })
    fireEvent.change(screen.getByLabelText(/step 1 when to send/i), { target: { value: "after" } })

    expect(screen.queryByLabelText(/how many days before the event/i)).not.toBeInTheDocument()
    // And Save is reachable: switching back must restore a usable wait rather
    // than leaving a step that is neither, which validateStepList refuses.
    expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled()
  })

  it("will not let the coach save a countdown with the days left blank", () => {
    renderEditor({ initialSteps: waitSteps() })
    fireEvent.change(screen.getByLabelText(/step 1 when to send/i), { target: { value: "before_event" } })
    fireEvent.change(screen.getByLabelText(/how many days before the event/i), { target: { value: "" } })

    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled()

    // The control: a number clears the problem, so the assertion above is
    // about the blank and not about some other permanent objection.
    fireEvent.change(screen.getByLabelText(/how many days before the event/i), { target: { value: "3" } })
    expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled()
  })

  it("warns when the sequence is not started by an event signup, because nobody in it has a date", () => {
    // Review finding. Nothing stopped a coach putting "3 days before the
    // event" into `newsletter_welcome` or `service_application_received`, and
    // no run of those sequences ever carries an anchor — so every one of them
    // would end at that step. A warning, not a refusal: the coach may be
    // about to change what starts the sequence, and refusing would make that
    // order of operations impossible.
    render(
      <StepEditor
        sequenceKey="newsletter_welcome"
        sequenceName="Newsletter welcome"
        triggerSource="newsletter"
        initialSteps={waitSteps()}
        oldSteps={[]}
        runs={[]}
        sentCountByStepId={{}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/step 1 when to send/i), { target: { value: "before_event" } })

    expect(screen.getByText(/does not start from a camp or clinic signup/i)).toBeInTheDocument()
    // It warns, it does not block — the coach can still save.
    expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled()
  })

  it("does NOT warn on a sequence an event signup starts", () => {
    // The control. Without it, a warning that rendered unconditionally would
    // pass the test above and train coaches to ignore it.
    render(
      <StepEditor
        sequenceKey="camp_clinic_deadline"
        sequenceName="Camp or clinic deadline"
        triggerSource="event_signup"
        initialSteps={waitSteps()}
        oldSteps={[]}
        runs={[]}
        sentCountByStepId={{}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/step 1 when to send/i), { target: { value: "before_event" } })

    expect(screen.queryByText(/does not start from a camp or clinic signup/i)).not.toBeInTheDocument()
    // But it still says what happens to people already part-way through, who
    // were enrolled before the anchor column existed.
    expect(screen.getByText(/already part-way through/i)).toBeInTheDocument()
  })

  it("tells the coach in plain words what the countdown hangs off", () => {
    // A coach picking "before the event" cannot be expected to know that it
    // only works for camp and clinic signups, or that somebody added by hand
    // has no event date. Saying so here is cheaper than a support message.
    renderEditor({ initialSteps: waitSteps() })
    fireEvent.change(screen.getByLabelText(/step 1 when to send/i), { target: { value: "before_event" } })
    // Matched on the help text's own sentence, not a bare /camp or clinic/,
    // which now also appears in the not-an-event-sequence warning.
    expect(screen.getByText(/Counts back from the start of the camp or clinic/i)).toBeInTheDocument()
    expect(screen.getByText(/added to this sequence by hand has no event date/i)).toBeInTheDocument()
  })
})

// @vitest-environment jsdom
// __tests__/components/admin/pipeline-settings.test.tsx
//
// G29 Task 7. The screen a coach uses to reshape a board's stage list, plus
// the server component that feeds it.
//
// EVERY ASSERTION HERE IS A PAIR, not a string sighting. "7 appears somewhere
// on the page" passes just as well when row 1 is rendering row 2's numbers —
// which is the single most likely way this table breaks — so every row check
// is scoped with `within(row)` and checks name + key + kind + BOTH thresholds
// together, and at least one check proves the OTHER row's values are not in
// this one.
//
// The rules themselves are NOT re-implemented here: `validateStageList`
// (lib/lead-engine/stage-list.ts) is the same pure function the route and the
// DAL call, and this file only checks the component reads it correctly and
// puts each problem where the spec says it goes (per-stage against the field,
// board-level at the top).

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { PipelineSettings } from "@/components/admin/pipeline-settings"
import type { SavedStage, StageDraft } from "@/lib/lead-engine/stage-list"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// next/navigation's useRouter is globally mocked in __tests__/setup.tsx.

// The page (bottom of this file) is a server component. Its guard reaches
// auth() and its tenant resolver reads cookies(), neither of which exists
// outside a request scope — both mocked to sentinels, which is also what lets
// the DAL reads below be pinned to the RESOLVED tenant.
vi.mock("@/lib/permissions/guard", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/pipeline", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/pipeline")>("@/lib/db/pipeline")
  return { ...actual, listPipelines: vi.fn(), readStagesForEdit: vi.fn() }
})

import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { listPipelines, readStagesForEdit } from "@/lib/db/pipeline"
import PipelineSettingsPage from "@/app/(admin)/admin/pipeline/settings/page"

const BOARD = { id: "board-1", key: "coaching", name: "Coaching" }

function stage(over: Partial<SavedStage> & Pick<SavedStage, "id" | "key" | "position" | "name">): SavedStage {
  return {
    kind: "open",
    amberAfterDays: null,
    redAfterDays: null,
    ...over,
  }
}

/**
 * Four stages whose thresholds all DIFFER, so a row rendering a sibling's
 * numbers cannot pass by coincidence.
 */
function stages(): SavedStage[] {
  return [
    stage({ id: "s1", key: "enquired", position: 1, name: "Enquired", amberAfterDays: 3, redAfterDays: 7 }),
    stage({ id: "s2", key: "consulted", position: 2, name: "Consulted", amberAfterDays: 5, redAfterDays: 14 }),
    stage({ id: "s3", key: "won", position: 3, name: "Won", kind: "won" }),
    stage({ id: "s4", key: "lost", position: 4, name: "Lost", kind: "lost" }),
  ]
}

function renderSettings(
  over: Partial<{
    board: { id: string; key: string; name: string }
    stages: SavedStage[]
    cardCounts: Record<string, number>
    isDefaultBoard: boolean
  }> = {},
) {
  return render(
    <PipelineSettings
      board={over.board ?? BOARD}
      stages={over.stages ?? stages()}
      // Two stages hold cards, with DIFFERENT counts and not in adjacent
      // positions; a stage with none is ABSENT from this map rather than
      // present with 0, which is the shape readStagesForEdit returns. The
      // spread matters: a component keying counts by ROW INDEX instead of by
      // stage id passed an earlier version of this fixture.
      cardCounts={over.cardCounts ?? { s2: 2, s4: 1 }}
      isDefaultBoard={over.isDefaultBoard ?? true}
    />,
  )
}

function okFetch(body: unknown = { ok: true }) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }) as unknown as typeof fetch
}

function failFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: false, status, json: async () => body }) as unknown as typeof fetch
}

function lastBody<T>(): T {
  const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  const init = calls[calls.length - 1][1] as RequestInit
  return JSON.parse(init.body as string) as T
}

function row(index: number): HTMLElement {
  return screen.getByTestId(`stage-row-${index}`)
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save stages" })
}

/** The two board cards, so an error can be asserted to be on ONE of them. */
function boardCard(): HTMLElement {
  return screen.getByTestId("board-card")
}

function newBoardCard(): HTMLElement {
  return screen.getByTestId("new-board-card")
}

/**
 * The block that holds ONE labelled box — its label, its input and the slot a
 * field-level refusal renders into.
 *
 * Scoping to the whole card is not enough to prove the route's `field` was
 * read: a card-level fallback message is inside the card too. This is what
 * tells "under the box that caused it" apart from "somewhere on the same
 * card".
 */
function fieldBlock(label: string): HTMLElement {
  const input = screen.getByLabelText(label)
  const block = input.parentElement
  if (!block) throw new Error(`no field block around "${label}"`)
  return block
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = okFetch()
})

describe("<PipelineSettings> — every row shows its OWN name, kind and both thresholds", () => {
  it("renders the pairs, and one row's numbers never appear in another's", () => {
    renderSettings()

    const expected = [
      { name: "Enquired", key: "enquired", kind: "open", kindLabel: "Still open", amber: 3, red: 7 },
      { name: "Consulted", key: "consulted", kind: "open", kindLabel: "Still open", amber: 5, red: 14 },
      { name: "Won", key: "won", kind: "won", kindLabel: "Won", amber: null, red: null },
      { name: "Lost", key: "lost", kind: "lost", kindLabel: "Lost", amber: null, red: null },
    ]

    expected.forEach((want, i) => {
      const r = row(i)
      const n = i + 1
      expect(within(r).getByLabelText(`Stage ${n} name`)).toHaveValue(want.name)
      expect(within(r).getByLabelText(`Stage ${n} key`)).toHaveValue(want.key)
      // The select's VALUE is the stored kind; the text a coach READS is the
      // plain-language label. Both are asserted so neither the stored value
      // leaking onto the screen nor a mislabelled option can pass. Read off
      // `selectedOptions` rather than getByDisplayValue, because the Won
      // stage is NAMED "Won" too and the display-value query cannot tell the
      // name box and the kind box apart.
      const kind = within(r).getByLabelText(`Stage ${n} kind`) as HTMLSelectElement
      expect(kind).toHaveValue(want.kind)
      expect(kind.selectedOptions[0].textContent).toBe(want.kindLabel)
      expect(within(r).getByLabelText(`Stage ${n}: days in this step before it looks slow`)).toHaveValue(want.amber)
      expect(within(r).getByLabelText(`Stage ${n}: days with no reply before it is flagged`)).toHaveValue(want.red)
    })

    // The pair guard. Consulted's 5/14 must not be readable anywhere inside
    // the Enquired row, and vice versa — this is the assertion a
    // render-the-wrong-row bug fails.
    expect(within(row(0)).queryByDisplayValue("5")).not.toBeInTheDocument()
    expect(within(row(0)).queryByDisplayValue("14")).not.toBeInTheDocument()
    expect(within(row(1)).queryByDisplayValue("3")).not.toBeInTheDocument()
    expect(within(row(1)).queryByDisplayValue("7")).not.toBeInTheDocument()
  })

  it("shows each row's own card count, and the count follows the STAGE when it moves", () => {
    renderSettings()
    expect(within(row(0)).getByText("No cards")).toBeInTheDocument()
    expect(within(row(1)).getByText("2 cards")).toBeInTheDocument()
    expect(within(row(2)).getByText("No cards")).toBeInTheDocument()
    expect(within(row(3)).getByText("1 card")).toBeInTheDocument()
    expect(within(row(0)).queryByText("2 cards")).not.toBeInTheDocument()

    // The count belongs to the STAGE, not to the row it happens to sit in.
    // A component reading counts by array index passes every assertion above
    // and fails this one — which is exactly what it did before this line
    // existed.
    fireEvent.click(screen.getByRole("button", { name: "Move stage 2 up" }))
    expect(within(row(0)).getByText("2 cards")).toBeInTheDocument()
    expect(within(row(1)).getByText("No cards")).toBeInTheDocument()
  })
})

describe("<PipelineSettings> — where each problem appears", () => {
  it("puts a per-stage problem against its row and a board-level one at the top", () => {
    renderSettings()

    // Presence control: neither message is on screen before the edit, so the
    // absence assertions below mean something.
    expect(screen.queryByText("Every stage needs a name.")).not.toBeInTheDocument()
    expect(screen.queryByTestId("board-problems")).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Stage 2 name"), { target: { value: "" } })

    // index 1 -> against the SECOND row, not the first and not the top.
    expect(within(row(1)).getByText("Every stage needs a name.")).toBeInTheDocument()
    expect(within(row(0)).queryByText("Every stage needs a name.")).not.toBeInTheDocument()

    // index null -> the top strip, and only there.
    fireEvent.change(screen.getByLabelText("Stage 1 kind"), { target: { value: "won" } })
    const top = screen.getByTestId("board-problems")
    expect(within(top).getByText("A board needs exactly one Won stage. This one has 2.")).toBeInTheDocument()
    expect(within(top).queryByText("Every stage needs a name.")).not.toBeInTheDocument()
  })

  it("disables Save while a problem is showing", () => {
    renderSettings()
    expect(saveButton()).toBeEnabled() // presence control
    fireEvent.change(screen.getByLabelText("Stage 2 name"), { target: { value: "  " } })
    expect(saveButton()).toBeDisabled()
  })

  it("refuses the save itself, so the disabled button is never the only guard", async () => {
    renderSettings()

    // Control: submitting the form in a VALID state DOES send the save, so
    // the bypass below is a real bypass and not a dead event.
    fireEvent.submit(screen.getByTestId("stage-form"))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))

    vi.clearAllMocks()
    global.fetch = okFetch()

    // Now make it invalid and submit the form directly — exactly what a
    // keyboard Enter, a script, or a stale disabled attribute would do.
    fireEvent.change(screen.getByLabelText("Stage 2 name"), { target: { value: "" } })
    fireEvent.submit(screen.getByTestId("stage-form"))
    await Promise.resolve()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(within(row(1)).getByText("Every stage needs a name.")).toBeInTheDocument()
  })
})

describe("<PipelineSettings> — removing a stage that holds cards", () => {
  it("reveals a destination picker naming the OTHER stages", () => {
    renderSettings()
    expect(screen.queryByLabelText(/Where should/)).not.toBeInTheDocument() // presence control

    fireEvent.click(screen.getByRole("button", { name: "Remove stage 2" }))

    const picker = screen.getByLabelText('Where should the 2 cards on "Consulted" go?')
    const options = within(picker as HTMLElement)
      .getAllByRole("option")
      .map((o) => o.textContent)
    expect(options).toEqual(["Choose a stage…", "Enquired", "Won", "Lost"])
    expect(options).not.toContain("Consulted")

    // Until a destination is chosen the save is refused, in the same words
    // the route would use (strandedStageProblems) — the stage's NAME, and
    // "2 cards", not the key and not "card(s)" (R16).
    expect(
      screen.getByText(
        'Stage "Consulted" still has 2 cards on it. Say which stage they should move to before removing it.',
      ),
    ).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    fireEvent.change(picker, { target: { value: "s1" } })
    expect(screen.queryByText(/still has 2 cards on it/)).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it("asks nothing when the removed stage holds no cards", () => {
    renderSettings()
    fireEvent.click(screen.getByRole("button", { name: "Remove stage 1" }))
    expect(screen.queryByLabelText(/Where should/)).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  // Fix round 1, item 4. The picker's onChange used to clear `serverProblems`
  // but not `stageError`, so the footer kept showing the refusal the coach had
  // just acted on. Every step before the last one exists to isolate the picker
  // as the ONLY thing that happens between the refusal and the assertion —
  // editing a row, removing one or adding one all clear it through a
  // different path.
  it("clears a stale save refusal the moment the coach answers the destination question", async () => {
    renderSettings()
    fireEvent.click(screen.getByRole("button", { name: "Remove stage 2" }))
    const picker = screen.getByLabelText('Where should the 2 cards on "Consulted" go?')
    fireEvent.change(picker, { target: { value: "s1" } })

    global.fetch = failFetch(400, { error: "This stage list could not be saved." })
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText("This stage list could not be saved.")).toBeInTheDocument())

    fireEvent.change(picker, { target: { value: "s3" } })
    expect(screen.queryByText("This stage list could not be saved.")).not.toBeInTheDocument()
  })

  it("sends the destination map with the save", async () => {
    renderSettings()
    fireEvent.click(screen.getByRole("button", { name: "Remove stage 2" }))
    fireEvent.change(screen.getByLabelText('Where should the 2 cards on "Consulted" go?'), {
      target: { value: "s1" },
    })
    fireEvent.click(saveButton())

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const body = lastBody<{ stages: StageDraft[]; destinations: Record<string, string> }>()
    expect(body.destinations).toEqual({ s2: "s1" })
    expect(body.stages.map((s) => s.key)).toEqual(["enquired", "won", "lost"])
  })
})

describe("<PipelineSettings> — the save payload", () => {
  it("PUTs the whole list in array order and sends NO position field", async () => {
    renderSettings()

    // Reorder: Consulted moves above Enquired. The submitted ARRAY ORDER is
    // the new position — nothing else carries it.
    fireEvent.click(screen.getByRole("button", { name: "Move stage 2 up" }))
    fireEvent.click(saveButton())

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/api/admin/pipeline/boards/board-1/stages")
    expect((init as RequestInit).method).toBe("PUT")

    const body = lastBody<{ stages: StageDraft[] }>()
    expect(body.stages.map((s) => s.key)).toEqual(["consulted", "enquired", "won", "lost"])

    // THE TRAP. StageDraftSchema is .strict(): a `position` field — which
    // SavedStage carries and StageDraft does not — makes the route reject
    // the WHOLE save. Assert the exact key set, not just the absence of
    // `position`, so any other stray field fails too.
    for (const s of body.stages) {
      expect(Object.keys(s).sort()).toEqual(["amberAfterDays", "id", "key", "kind", "name", "redAfterDays"])
    }
    expect(body.stages[0]).toMatchObject({
      id: "s2",
      key: "consulted",
      name: "Consulted",
      amberAfterDays: 5,
      redAfterDays: 14,
    })
  })

  it("shows the route's own problems when the save is refused", async () => {
    renderSettings()
    global.fetch = failFetch(400, {
      error: "This stage list could not be saved.",
      problems: [{ index: null, message: "A board needs exactly one Lost stage. This one has 0." }],
    })
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(screen.getByText("A board needs exactly one Lost stage. This one has 0.")).toBeInTheDocument(),
    )
    expect(toast.error).toHaveBeenCalledWith("This stage list could not be saved.")
  })
})

describe("<PipelineSettings> — a stage's key", () => {
  it("is read-only once saved, and editable (and suggested) only on a brand-new stage", async () => {
    renderSettings()
    expect(screen.getByLabelText("Stage 1 key")).toHaveAttribute("readonly")

    fireEvent.click(screen.getByRole("button", { name: "Add a stage" }))

    const newKey = screen.getByLabelText("Stage 5 key")
    expect(newKey).not.toHaveAttribute("readonly")
    expect(newKey).toHaveValue("")

    // The key is suggested from the name until the coach types one.
    fireEvent.change(screen.getByLabelText("Stage 5 name"), { target: { value: "Proposal Sent" } })
    expect(newKey).toHaveValue("proposal_sent")
    fireEvent.change(newKey, { target: { value: "offer" } })
    fireEvent.change(screen.getByLabelText("Stage 5 name"), { target: { value: "Proposal Sent!" } })
    expect(newKey).toHaveValue("offer")

    fireEvent.click(saveButton())
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const body = lastBody<{ stages: StageDraft[] }>()
    expect(body.stages[4]).toEqual({
      id: null,
      key: "offer",
      name: "Proposal Sent!",
      kind: "open",
      amberAfterDays: null,
      redAfterDays: null,
    })
  })
})

describe("<PipelineSettings> — the route's length caps, enforced at the field", () => {
  it("stops an over-long name on its own row instead of losing every other edit", () => {
    renderSettings()

    // An edit on a DIFFERENT row, made first: a `.max()` refusal rejects the
    // whole payload, so the point of catching it at the field is that this
    // edit survives.
    fireEvent.change(screen.getByLabelText("Stage 1 name"), { target: { value: "First contact" } })
    fireEvent.change(screen.getByLabelText("Stage 2 name"), { target: { value: "x".repeat(201) } })

    expect(within(row(1)).getByText("Stage name must be 200 characters or fewer.")).toBeInTheDocument()
    expect(within(row(0)).queryByText("Stage name must be 200 characters or fewer.")).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(screen.getByLabelText("Stage 1 name")).toHaveValue("First contact")

    fireEvent.change(screen.getByLabelText("Stage 2 name"), { target: { value: "x".repeat(200) } })
    expect(saveButton()).toBeEnabled()
  })

  it("stops an over-long key on its own row too — the branch maxLength cannot reach", () => {
    renderSettings()
    // A saved stage's key box is read-only, so the reachable case is a NEW
    // stage. `fireEvent.change` bypasses `maxLength` exactly as a paste does.
    fireEvent.click(screen.getByRole("button", { name: "Add a stage" }))
    fireEvent.change(screen.getByLabelText("Stage 5 name"), { target: { value: "Proposal sent" } })
    expect(saveButton()).toBeEnabled() // presence control

    fireEvent.change(screen.getByLabelText("Stage 5 key"), { target: { value: "k".repeat(101) } })
    expect(within(row(4)).getByText("Stage key must be 100 characters or fewer.")).toBeInTheDocument()
    expect(within(row(0)).queryByText("Stage key must be 100 characters or fewer.")).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Stage 5 key"), { target: { value: "k".repeat(100) } })
    expect(saveButton()).toBeEnabled()
  })

  it("refuses a negative or fractional number of days at the field", () => {
    renderSettings()
    const days = () => screen.getByLabelText("Stage 1: days in this step before it looks slow")
    const message = "Days must be a whole number, 0 or more. Leave it blank for no warning."
    expect(screen.queryByText(message)).not.toBeInTheDocument() // presence control

    // `type="number"` accepts both of these in a real browser, and `toDays`
    // turns each into null — so this check is the only thing between them and
    // a save that silently clears the threshold.
    for (const bad of ["-5", "1.5"]) {
      fireEvent.change(days(), { target: { value: bad } })
      expect(within(row(0)).getByText(message)).toBeInTheDocument()
      expect(within(row(1)).queryByText(message)).not.toBeInTheDocument()
      expect(saveButton()).toBeDisabled()
    }

    fireEvent.change(days(), { target: { value: "2" } })
    expect(screen.queryByText(message)).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it("caps the boxes themselves at the same limits the route uses", () => {
    renderSettings()
    expect(screen.getByLabelText("Stage 1 name")).toHaveAttribute("maxlength", "200")
    fireEvent.click(screen.getByRole("button", { name: "Add a stage" }))
    expect(screen.getByLabelText("Stage 5 key")).toHaveAttribute("maxlength", "100")
  })
})

describe("<PipelineSettings> — the board itself", () => {
  it("renames the board", async () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText("Board name"), { target: { value: "One-to-one coaching" } })
    fireEvent.click(screen.getByRole("button", { name: "Save board name" }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/api/admin/pipeline/boards/board-1")
    expect((init as RequestInit).method).toBe("PATCH")
    expect(lastBody<{ name: string }>()).toEqual({ name: "One-to-one coaching" })
  })

  it("shows the route's refusal VERBATIM when the default board cannot be archived, on the card it is about", async () => {
    renderSettings({ isDefaultBoard: true })
    const refusal =
      'The board "Coaching" is where every unrouted enquiry lands, so it cannot be archived. Point the default somewhere else first.'
    // No `field` — this one is a readable DAL refusal about the board as a
    // whole, not about a box, so it belongs at the foot of THIS card.
    global.fetch = failFetch(400, { error: refusal })

    fireEvent.click(screen.getByRole("button", { name: "Archive this board" }))
    fireEvent.click(screen.getByRole("button", { name: "Yes, archive it" }))

    await waitFor(() => expect(within(boardCard()).getByText(refusal)).toBeInTheDocument())
    // The other card must not be carrying somebody else's refusal.
    expect(within(newBoardCard()).queryByText(refusal)).not.toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(refusal)
    // It must not pretend the archive happened.
    expect(toast.success).not.toHaveBeenCalled()
  })

  // The pre-emptive half of the same rule. The post-click refusal above is
  // the route doing its job; this sentence is what stops the coach being
  // ambushed by it, and the two `it`s are each other's presence control —
  // one asserts the default board's note and the absence of the other, the
  // next asserts exactly the reverse.
  it("says the default board cannot be archived BEFORE anyone clicks", () => {
    renderSettings({ isDefaultBoard: true })
    expect(
      within(boardCard()).getByText(
        "This is the board every enquiry lands on when nothing else claims it, so it cannot be archived.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Archiving takes this board off the pipeline screens/)).not.toBeInTheDocument()
  })

  it("warns instead that archiving is one-way, on a board that CAN be archived", () => {
    renderSettings({ board: { id: "board-2", key: "camps_clinics", name: "Camps & Clinics" }, isDefaultBoard: false })
    expect(within(boardCard()).getByText(/Archiving takes this board off the pipeline screens/)).toBeInTheDocument()
    expect(screen.queryByText(/it cannot be archived/)).not.toBeInTheDocument()
  })
})

describe("<PipelineSettings> — the add-another-board card", () => {
  it("creates another board", async () => {
    renderSettings()
    global.fetch = okFetch({ ok: true, board: { id: "board-2", key: "camps", name: "Camps" } })
    fireEvent.change(screen.getByLabelText("New board name"), { target: { value: "Camps" } })
    fireEvent.click(screen.getByRole("button", { name: "Create board" }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/api/admin/pipeline/boards")
    expect((init as RequestInit).method).toBe("POST")
    expect(lastBody<{ name: string }>()).toEqual({ name: "Camps" })
  })

  // THE BUG THIS EXISTS FOR (fix round 1, Important 1). Rename, archive and
  // create shared one `boardError`, which rendered only inside the "This
  // board" card — so a duplicate-name 400 printed against the board being
  // EDITED, ~135 lines up the page, while the box that caused it said
  // nothing at all. The route names the field; the screen has to use it.
  it("puts a refused creation under the box that caused it, not under the board being edited", async () => {
    renderSettings()
    const refusal = 'A board with the key "camps" already exists for this business. Choose a different name.'
    global.fetch = failFetch(400, { error: refusal, field: "name" })

    fireEvent.change(screen.getByLabelText("New board name"), { target: { value: "Camps" } })
    fireEvent.click(screen.getByRole("button", { name: "Create board" }))

    await waitFor(() => expect(within(newBoardCard()).getByText(refusal)).toBeInTheDocument())
    // Not merely on the right CARD — under the right BOX. The route answers
    // `field: "name"` precisely so this is possible.
    expect(within(fieldBlock("New board name")).getByText(refusal)).toBeInTheDocument()
    expect(within(boardCard()).queryByText(refusal)).not.toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(refusal)
    expect(toast.success).not.toHaveBeenCalled()

    // And it goes away once the coach does what it asked.
    fireEvent.change(screen.getByLabelText("New board name"), { target: { value: "Camps and clinics" } })
    expect(screen.queryByText(refusal)).not.toBeInTheDocument()
  })

  it("falls back to the foot of its own card when the route names no field", async () => {
    renderSettings()
    global.fetch = failFetch(500, {})
    fireEvent.change(screen.getByLabelText("New board name"), { target: { value: "Camps" } })
    fireEvent.click(screen.getByRole("button", { name: "Create board" }))

    await waitFor(() =>
      expect(within(newBoardCard()).getByText("That board could not be created.")).toBeInTheDocument(),
    )
    // The converse of the test above: with no field named, it must NOT be
    // pinned to a box it may have nothing to do with.
    expect(within(fieldBlock("New board name")).queryByText("That board could not be created.")).not.toBeInTheDocument()
    expect(within(boardCard()).queryByText("That board could not be created.")).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The server component that feeds the screen. Same shape as
// pipeline-board.test.tsx: the real guard reaches auth() and throws outside a
// request scope, and resolveAdminTenant reads cookies, so both are mocked to
// sentinels — which is also what pins the two DAL reads to the RESOLVED
// tenant rather than to whatever the page felt like passing.
// ---------------------------------------------------------------------------

describe("/admin/pipeline/settings — the server component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveAdminTenant).mockResolvedValue({ businessId: "biz-1" } as never)
    vi.mocked(listPipelines).mockResolvedValue([
      { id: "board-1", key: "coaching", name: "Coaching" },
      { id: "board-2", key: "camps_clinics", name: "Camps & Clinics" },
    ])
    vi.mocked(readStagesForEdit).mockResolvedValue({
      stages: stages(),
      cardCountByStageId: new Map([
        ["s2", 2],
        ["s4", 1],
      ]),
    })
  })

  it("gates on the contacts permission and reads the requested board for the RESOLVED tenant", async () => {
    render(await PipelineSettingsPage({ searchParams: Promise.resolve({ board: "camps_clinics" }) }))

    expect(requirePermission).toHaveBeenCalledWith("contacts")
    expect(listPipelines).toHaveBeenCalledWith("biz-1")
    expect(readStagesForEdit).toHaveBeenCalledWith("board-2", "biz-1")
    expect(screen.getByLabelText("Board name")).toHaveValue("Camps & Clinics")
  })

  it("falls back to the default board when ?board names one this tenant does not have", async () => {
    render(await PipelineSettingsPage({ searchParams: Promise.resolve({ board: "not_a_board" }) }))
    expect(readStagesForEdit).toHaveBeenCalledWith("board-1", "biz-1")
    expect(screen.getByLabelText("Board name")).toHaveValue("Coaching")
  })

  it("hands the card counts down as a plain object, so every row can show its own", async () => {
    render(await PipelineSettingsPage({ searchParams: Promise.resolve({}) }))
    expect(within(row(1)).getByText("2 cards")).toBeInTheDocument()
    expect(within(row(3)).getByText("1 card")).toBeInTheDocument()
    expect(within(row(0)).getByText("No cards")).toBeInTheDocument()
  })
})

// @vitest-environment jsdom
// The editor, and the gate its Activate button shares with the save route.
//
// `quizGate` is NOT mocked here. It is the pure rule deciding whether a quiz
// can go live, and stubbing it would make test 3 — the one that matters —
// assert nothing at all.
import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QuizEditor } from "@/components/admin/quizzes/QuizEditor"
import type { QuizDefinition } from "@/lib/quizzes/types"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const BRANCH_A = "44444444-4444-4444-8444-444444444441"
const BRANCH_B = "44444444-4444-4444-8444-444444444442"

function healthy(): QuizDefinition {
  return {
    id: QUIZ_ID, key: "rpi_athlete_quiz", name: "Athlete Quiz", status: "draft",
    introHeadline: "Find your gaps", introBody: "", gateHeadline: "", gateBody: "", resultHeadline: "",
    seedMarker: null,
    branches: [
      { id: BRANCH_A, quizId: QUIZ_ID, key: "alpha", name: "Ceiling Breaker", description: null, position: 1 },
      { id: BRANCH_B, quizId: QUIZ_ID, key: "beta", name: "Rebuilder", description: null, position: 2 },
    ],
    profiles: [{ id: "pf0", quizId: QUIZ_ID, key: "unsure", name: "Not sure", description: "d", position: 0 }],
    tiers: [{ id: "t1", quizId: QUIZ_ID, key: "red", position: 1, minScore: 0, maxScore: 100, headline: "Large gaps", body: "b", ctaLabel: null, ctaHref: null }],
    questions: [
      { id: "q-router", quizId: QUIZ_ID, branchId: null, position: 10, prompt: "Which describes you?", helpText: null, mediaUrl: null, mediaPosterUrl: null, isActive: true,
        options: [
          { id: "o-a", questionId: "q-router", position: 1, label: "Alpha", weight: 0, routesToBranchId: BRANCH_A, profileId: "pf0" },
          { id: "o-b", questionId: "q-router", position: 2, label: "Beta", weight: 0, routesToBranchId: BRANCH_B, profileId: null },
        ] },
      { id: "q-shared", quizId: QUIZ_ID, branchId: null, position: 20, prompt: "Where are you based?", helpText: null, mediaUrl: null, mediaPosterUrl: null, isActive: true,
        options: [
          { id: "o-s1", questionId: "q-shared", position: 1, label: "Tampa", weight: 0, routesToBranchId: null, profileId: null },
          { id: "o-s2", questionId: "q-shared", position: 2, label: "Elsewhere", weight: 0, routesToBranchId: null, profileId: null },
        ] },
      { id: "q-a1", quizId: QUIZ_ID, branchId: BRANCH_A, position: 50, prompt: "An Alpha question", helpText: null, mediaUrl: null, mediaPosterUrl: null, isActive: true,
        options: [
          { id: "o-a1", questionId: "q-a1", position: 1, label: "Yes", weight: 3, routesToBranchId: null, profileId: null },
          { id: "o-a2", questionId: "q-a1", position: 2, label: "No", weight: 0, routesToBranchId: null, profileId: null },
        ] },
      { id: "q-b1", quizId: QUIZ_ID, branchId: BRANCH_B, position: 50, prompt: "A Beta question", helpText: null, mediaUrl: null, mediaPosterUrl: null, isActive: true,
        options: [
          { id: "o-b1", questionId: "q-b1", position: 1, label: "Yes", weight: 3, routesToBranchId: null, profileId: null },
          { id: "o-b2", questionId: "q-b1", position: 2, label: "No", weight: 0, routesToBranchId: null, profileId: null },
        ] },
    ],
  }
}

/** Unreachable branch — quizGate refuses it. */
function broken(): QuizDefinition {
  const d = healthy()
  d.questions[0].options[1].routesToBranchId = BRANCH_A
  return d
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, gate: { ok: true } }), { status: 200 })))
})

const openQuestions = () => fireEvent.click(screen.getByRole("button", { name: "Questions" }))

describe("QuizEditor", () => {
  it("1. shows a tab per branch plus Everyone", () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    // "Everyone" is where the router and the shared questions live — without
    // it they belong to no branch and would be unreachable in the editor.
    expect(screen.getByRole("button", { name: "Everyone" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ceiling Breaker" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Rebuilder" })).toBeTruthy()
  })

  it("1b. the Everyone tab shows the shared questions and not a branch's own", () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    expect(screen.getByDisplayValue("Which describes you?")).toBeTruthy()
    expect(screen.queryByDisplayValue("An Alpha question")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Ceiling Breaker" }))
    expect(screen.getByDisplayValue("An Alpha question")).toBeTruthy()
    expect(screen.queryByDisplayValue("Which describes you?")).toBeNull()
  })

  it("2. an option row edits label, weight, routes-to and profile vote", () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()

    const label = screen.getByLabelText("Label for Alpha") as HTMLInputElement
    fireEvent.change(label, { target: { value: "I am a Ceiling Breaker" } })
    expect((screen.getByLabelText("Label for I am a Ceiling Breaker") as HTMLInputElement).value).toBe(
      "I am a Ceiling Breaker",
    )

    const weight = screen.getByLabelText("Weight for Beta") as HTMLInputElement
    fireEvent.change(weight, { target: { value: "2" } })
    expect((screen.getByLabelText("Weight for Beta") as HTMLInputElement).value).toBe("2")

    const routes = screen.getByLabelText("Routes to for Beta") as HTMLSelectElement
    expect(routes.value).toBe(BRANCH_B)
    fireEvent.change(routes, { target: { value: "" } })
    expect((screen.getByLabelText("Routes to for Beta") as HTMLSelectElement).value).toBe("")

    const vote = screen.getByLabelText("Profile vote for Beta") as HTMLSelectElement
    fireEvent.change(vote, { target: { value: "pf0" } })
    expect((screen.getByLabelText("Profile vote for Beta") as HTMLSelectElement).value).toBe("pf0")
  })

  it("3. disables Activate while the gate reports a blocker, AND lists the reasons", () => {
    render(<QuizEditor initial={broken()} />)
    expect((screen.getByRole("button", { name: "Activate" }) as HTMLButtonElement).disabled).toBe(true)
    // The reason, on screen. A greyed-out button with no explanation is a
    // support ticket.
    expect(screen.getByText(/cannot be activated yet/)).toBeTruthy()
    expect(screen.getByText(/unreachable/)).toBeTruthy()
  })

  it("3b. enables Activate on a quiz that passes, and shows no blocker list", () => {
    render(<QuizEditor initial={healthy()} />)
    expect((screen.getByRole("button", { name: "Activate" }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/cannot be activated yet/)).toBeNull()
  })

  it("3c. re-enables Activate as soon as the operator fixes the blocker", () => {
    render(<QuizEditor initial={broken()} />)
    expect((screen.getByRole("button", { name: "Activate" }) as HTMLButtonElement).disabled).toBe(true)
    openQuestions()
    fireEvent.change(screen.getByLabelText("Routes to for Beta"), { target: { value: BRANCH_B } })
    expect((screen.getByRole("button", { name: "Activate" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("3d. says something DIFFERENT when the broken quiz is already live", () => {
    // Found by looking at a screenshot: an active quiz with a failing gate
    // showed "Active" and "cannot be activated yet" together, which reads as
    // a contradiction and buries the real problem. Editing a live quiz is
    // deliberately allowed — blocking it would make a broken one impossible
    // to repair — so the wording is the only protection.
    render(<QuizEditor initial={{ ...broken(), status: "active" }} />)
    expect(screen.getByText(/LIVE and these changes would break it/)).toBeTruthy()
    expect(screen.queryByText(/cannot be activated yet/)).toBeNull()
  })

  it("4. reordering writes new position values, not just a new array order", async () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    fireEvent.click(screen.getByLabelText('Move "Where are you based?" earlier'))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled())
    const body = JSON.parse(
      ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as { body: string }).body,
    ) as { questions: { id: string; position: number }[] }
    // The two shared questions swapped POSITIONS — 10 and 20 traded owners.
    // An array reorder that never writes the number is a reorder the visitor
    // never sees, because the walk sorts on position.
    expect(body.questions.find((q) => q.id === "q-shared")?.position).toBe(10)
    expect(body.questions.find((q) => q.id === "q-router")?.position).toBe(20)
  })

  // G47. A clone of the built-in quiz arrives with no buttons; this is where a
  // coach writes their own, and the gate's warning is what sends them here.
  const savedTiers = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled())
    const body = JSON.parse(
      ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as { body: string }).body,
    ) as { tiers: { id: string; ctaLabel: string | null; ctaHref: string | null }[] }
    return body.tiers
  }

  it("5. lets a band's button be written, clears the warning, and saves it trimmed", async () => {
    render(<QuizEditor initial={healthy()} />)
    expect(screen.getByText(/Band "red" \(0-100\) has no button/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Tiers" }))
    fireEvent.change(screen.getByLabelText("red button text"), { target: { value: "  Book a call  " } })
    fireEvent.change(screen.getByLabelText("red button link"), { target: { value: " /go/my-page " } })
    expect(screen.queryByText(/has no button/)).toBeNull()
    expect(await savedTiers()).toEqual([
      expect.objectContaining({ id: "t1", ctaLabel: "Book a call", ctaHref: "/go/my-page" }),
    ])
  })

  it("5b. does not resend an unchanged button, so a stored link the rule refuses cannot block a save", async () => {
    const legacy = healthy()
    legacy.tiers[0].ctaLabel = "Book now"
    legacy.tiers[0].ctaHref = "calendly.com/someone"
    render(<QuizEditor initial={legacy} />)
    const [tier] = await savedTiers()
    expect(tier.id).toBe("t1")
    expect(tier).not.toHaveProperty("ctaLabel")
    expect(tier).not.toHaveProperty("ctaHref")
  })

  it("5d. refuses a changed link before sending, naming the band and the rule", async () => {
    render(<QuizEditor initial={healthy()} />)
    fireEvent.click(screen.getByRole("button", { name: "Tiers" }))
    fireEvent.change(screen.getByLabelText("red button text"), { target: { value: "Book a call" } })
    fireEvent.change(screen.getByLabelText("red button link"), { target: { value: "www.mysite.com/book" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByText(/Band "red": A button link must start with \//)).toBeTruthy()
    expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })

  it("5e. caps the button text at the length the server accepts", () => {
    render(<QuizEditor initial={healthy()} />)
    fireEvent.click(screen.getByRole("button", { name: "Tiers" }))
    expect((screen.getByLabelText("red button text") as HTMLInputElement).maxLength).toBe(60)
  })

  it("5c. saves a blanked button as null, not as an empty string", async () => {
    const withButton = healthy()
    withButton.tiers[0].ctaLabel = "See the options"
    withButton.tiers[0].ctaHref = "/online"
    render(<QuizEditor initial={withButton} />)
    fireEvent.click(screen.getByRole("button", { name: "Tiers" }))
    fireEvent.change(screen.getByLabelText("red button text"), { target: { value: "   " } })
    fireEvent.change(screen.getByLabelText("red button link"), { target: { value: "" } })
    expect(await savedTiers()).toEqual([expect.objectContaining({ id: "t1", ctaLabel: null, ctaHref: null })])
  })

  it("shows the unverified banner while the seed marker is present", () => {
    render(<QuizEditor initial={{ ...healthy(), seedMarker: "reconstructed-from-ghl-export-2026-08-23" }} />)
    expect(screen.getByText(/reconstructed scoring/)).toBeTruthy()
  })

  it("surfaces the server's own blockers when it refuses an activation this browser thought was fine", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "This quiz cannot be activated yet.", blockers: ["Server said no."] }), {
          status: 409,
        }),
      ),
    )
    render(<QuizEditor initial={healthy()} />)
    fireEvent.click(screen.getByRole("button", { name: "Activate" }))
    await waitFor(() => expect(screen.getByText("Server said no.")).toBeTruthy())
  })

  it("saves the results-map label and side a human typed", async () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    fireEvent.click(screen.getAllByText(/Video and results map/)[0])
    fireEvent.change(screen.getAllByLabelText("Results map label")[0], { target: { value: "  Copenhagen  " } })
    fireEvent.change(screen.getAllByLabelText("Side")[0], { target: { value: "left" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body as string)
    expect(
      body.questions.some(
        (q: { reportLabel: string | null; side: string | null }) => q.reportLabel === "Copenhagen" && q.side === "left",
      ),
    ).toBe(true)
  })

  it("caps the results-map label at the 80 characters the save route accepts", () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    fireEvent.click(screen.getAllByText(/Video and results map/)[0])
    expect(screen.getAllByLabelText("Results map label")[0].getAttribute("maxlength")).toBe("80")
  })

  // The movement tests' scoring points live in the help text, and the editor
  // had no field for it: the owner could not change them at all.
  it("edits a question's instructions and saves them with their line breaks", async () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    const field = screen.getAllByLabelText("Instructions under the question")[0]
    expect(field.getAttribute("maxlength")).toBe("500")
    fireEvent.change(field, { target: { value: "Lie face down.\n1. Hip stays down" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body as string)
    expect(body.questions.find((q: { id: string }) => q.id === "q-router").helpText).toBe("Lie face down.\n1. Hip stays down")
  })

  it("saves cleared instructions as null, not as an empty string", async () => {
    const withHelp = healthy()
    withHelp.questions[0].helpText = "Old help"
    render(<QuizEditor initial={withHelp} />)
    openQuestions()
    fireEvent.change(screen.getAllByLabelText("Instructions under the question")[0], { target: { value: "  " } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body as string)
    expect(body.questions.find((q: { id: string }) => q.id === "q-router").helpText).toBeNull()
  })
})

// The owner edited the RPI quiz on 2026-10-07 and no save ever reached the
// server: the editor gave no sign the change was unsaved, and leaving the page
// threw it away.
describe("QuizEditor — unsaved changes", () => {
  const editPrompt = () =>
    fireEvent.change(screen.getByDisplayValue("Which describes you?"), { target: { value: "Which one are you?" } })
  const leave = () => {
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it("says nothing is unsaved until something changes, then says so", () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    expect(screen.queryByText("Unsaved changes")).toBeNull()
    editPrompt()
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
  })

  it("clears the notice once the save succeeds", async () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    editPrompt()
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull())
  })

  it("keeps the notice when the save is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Invalid save." }), { status: 400 })))
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    editPrompt()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.getByText("Invalid save.")).toBeTruthy())
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
  })

  it("asks before the browser leaves the page with unsaved changes, and not otherwise", () => {
    render(<QuizEditor initial={healthy()} />)
    openQuestions()
    expect(leave()).toBe(false)
    editPrompt()
    expect(leave()).toBe(true)
  })

  it("asks before a link in the app takes the owner away, and stays when they say no", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(
      <>
        <a href="/admin/funnels">Funnels</a>
        <QuizEditor initial={healthy()} />
      </>,
    )
    openQuestions()
    const click = () => !fireEvent.click(screen.getByText("Funnels"))
    expect(click()).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    editPrompt()
    expect(click()).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(1)
    confirm.mockReturnValue(true)
    expect(click()).toBe(false)
  })
})

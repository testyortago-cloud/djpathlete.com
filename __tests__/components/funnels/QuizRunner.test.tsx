// __tests__/components/funnels/QuizRunner.test.tsx
//
// The visitor's walk. The two behaviours worth guarding hardest are that the
// NEXT question is not in the document before the current one is answered
// (hiding it with CSS would leak the branch structure to view-source), and
// that a TEST RUN posts no progress at all (a preview that wrote attempt rows
// would break the promise the preview route exists to keep).

import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import fs from "node:fs"
import path from "node:path"
import { QuizRunner } from "@/components/funnels/islands/QuizRunner"
import type { PublicQuizDefinition } from "@/lib/quizzes/public-definition"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const BRANCH_A = "44444444-4444-4444-8444-444444444441"
const BRANCH_B = "44444444-4444-4444-8444-444444444442"

const DEFINITION: PublicQuizDefinition = {
  id: QUIZ_ID,
  key: "rpi",
  introHeadline: "Find your gaps",
  introBody: "Three minutes.",
  gateHeadline: "Where should we send it?",
  gateBody: "We score it against a full assessment.",
  resultHeadline: "Your readout",
  branches: [
    { id: BRANCH_A, key: "alpha", name: "Alpha" },
    { id: BRANCH_B, key: "beta", name: "Beta" },
  ],
  questions: [
    {
      id: "q-router", branchId: null, position: 10, prompt: "Which describes you?", helpText: null,
      options: [
        { id: "o-a", label: "I am an Alpha", routesToBranchId: BRANCH_A },
        { id: "o-b", label: "I am a Beta", routesToBranchId: BRANCH_B },
      ],
    },
    {
      id: "q-alpha", branchId: BRANCH_A, position: 50, prompt: "An Alpha question", helpText: "Alpha help",
      options: [{ id: "o-a1", label: "Alpha answer", routesToBranchId: null }],
    },
    {
      id: "q-beta", branchId: BRANCH_B, position: 50, prompt: "A Beta question", helpText: null,
      options: [{ id: "o-b1", label: "Beta answer", routesToBranchId: null }],
    },
  ],
}

function renderRunner(extra: Record<string, unknown> = {}) {
  return render(<QuizRunner definition={DEFINITION} submitLabel="See my result" {...extra} />)
}

/** Walk past the intro screen. */
function start() {
  fireEvent.click(screen.getByRole("button", { name: "Start" }))
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ attemptId: "att-1" }), { status: 200 })),
  )
})

describe("QuizRunner — the walk", () => {
  it("1. shows one question at a time; question two is not in the document until question one is answered", () => {
    renderRunner()
    start()
    expect(screen.getByText("Which describes you?")).toBeTruthy()
    // NOT `toBeVisible`. A hidden-but-present question is still readable in
    // view-source, and the ordering of a branching quiz leaks which archetype
    // each option leads to.
    expect(screen.queryByText("An Alpha question")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    expect(screen.getByText("An Alpha question")).toBeTruthy()
    expect(screen.queryByText("Which describes you?")).toBeNull()
  })

  it("1b. does not promise a TOTAL before the router is answered", () => {
    // FOUND BY LOOKING AT A SCREENSHOT, not by a test. Before branching the
    // walk is the shared questions only, so this read "Question 1 of 6"; one
    // click later it read "Question 2 of 13". Being told a quiz is six
    // questions, answering one, and then being told it is thirteen is worse
    // than not being given a number.
    //
    // Every other test in this file asserts WHICH question is shown. None of
    // them looked at the counter — the false positive a guard's own tests
    // structurally cannot see.
    renderRunner()
    start()
    expect(screen.getByText("Question 1")).toBeTruthy()
    expect(screen.queryByText(/Question 1 of/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    // Once the branch is known the total is real, so it is shown.
    expect(screen.getByText("Question 2 of 2")).toBeTruthy()
  })

  it("2. goes back to the previous question with the previous answer still selected", () => {
    renderRunner()
    start()
    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    fireEvent.click(screen.getByRole("button", { name: "Back" }))

    expect(screen.getByText("Which describes you?")).toBeTruthy()
    expect(screen.getByRole("button", { name: "I am an Alpha" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "I am a Beta" }).getAttribute("aria-pressed")).toBe("false")
  })

  it("3. shows the gate only after the last walked question", () => {
    renderRunner()
    start()
    expect(screen.queryByLabelText("Email")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    expect(screen.queryByLabelText("Email")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Alpha answer" }))
    expect(screen.getByLabelText("Email")).toBeTruthy()
  })

  it("4. asks a different second question depending on the router answer", () => {
    renderRunner()
    start()
    fireEvent.click(screen.getByRole("button", { name: "I am a Beta" }))
    expect(screen.getByText("A Beta question")).toBeTruthy()
    expect(screen.queryByText("An Alpha question")).toBeNull()
  })

  it("5. a testRun makes ZERO progress calls", async () => {
    renderRunner({ testRun: true })
    start()
    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    fireEvent.click(screen.getByRole("button", { name: "Alpha answer" }))
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy())

    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.filter((c) => String(c[0]).includes("/api/quiz/progress"))).toHaveLength(0)
  })

  it("5b. a normal run DOES post progress — so test 5 is not vacuous", async () => {
    renderRunner()
    start()
    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.filter((c) => String(c[0]).includes("/api/quiz/progress")).length).toBeGreaterThan(0)
    })
  })

  it("6. renders the tier headline, the profile name and the CTA the server returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/quiz/progress")) {
          return new Response(JSON.stringify({ attemptId: "att-1" }), { status: 200 })
        }
        return new Response(
          JSON.stringify({
            score: 42,
            tier: { key: "orange", headline: "Real gaps", body: "Findable.", ctaLabel: "Book a call", ctaHref: "/contact" },
            profile: { key: "tight", name: "Explosive but tight", description: "Stiffness limits it." },
            branch: { key: "alpha", name: "Alpha" },
          }),
          { status: 200 },
        )
      }),
    )
    renderRunner()
    start()
    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    fireEvent.click(screen.getByRole("button", { name: "Alpha answer" }))
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } })
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "See my result" }))

    await waitFor(() => expect(screen.getByText("Real gaps")).toBeTruthy())
    expect(screen.getByText("42")).toBeTruthy()
    expect(screen.getByText("Explosive but tight")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Book a call" }).getAttribute("href")).toBe("/contact")
  })

  it("7. contains no dangerouslySetInnerHTML anywhere in its source", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components", "funnels", "islands", "QuizRunner.tsx"),
      "utf8",
    )
    // Matched as a JSX PROP or object KEY, not as a bare substring: the
    // component's own header comment names the thing it promises not to do,
    // and a substring check cannot tell prose from a call. This regex fails
    // on `dangerouslySetInnerHTML=` and `dangerouslySetInnerHTML:` only.
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*[=:]/)
  })

  it("shows no SMS checkbox when no wording was supplied", () => {
    renderRunner()
    start()
    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    fireEvent.click(screen.getByRole("button", { name: "Alpha answer" }))
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("shows the SMS checkbox with the exact wording it was given", () => {
    renderRunner({ smsConsentWording: "I agree to receive text messages from DJP Athlete." })
    start()
    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    fireEvent.click(screen.getByRole("button", { name: "Alpha answer" }))
    expect(screen.getByRole("checkbox")).toBeTruthy()
    expect(screen.getByText("I agree to receive text messages from DJP Athlete.")).toBeTruthy()
  })

  it("refuses to submit in a plain preview that is not a test run", async () => {
    renderRunner({ isPreview: true })
    start()
    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    fireEvent.click(screen.getByRole("button", { name: "Alpha answer" }))
    fireEvent.click(screen.getByRole("button", { name: "See my result" }))
    await waitFor(() => expect(screen.getByText(/Submissions are disabled/)).toBeTruthy())
  })
})

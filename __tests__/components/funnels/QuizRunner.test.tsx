// @vitest-environment jsdom
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
      id: "q-router", branchId: null, position: 10, prompt: "Which describes you?", helpText: null, mediaUrl: null, mediaPosterUrl: null,
      options: [
        { id: "o-a", label: "I am an Alpha", routesToBranchId: BRANCH_A },
        { id: "o-b", label: "I am a Beta", routesToBranchId: BRANCH_B },
      ],
    },
    {
      id: "q-alpha", branchId: BRANCH_A, position: 50, prompt: "An Alpha question", helpText: "Alpha help", mediaUrl: null, mediaPosterUrl: null,
      options: [{ id: "o-a1", label: "Alpha answer", routesToBranchId: null }],
    },
    {
      id: "q-beta", branchId: BRANCH_B, position: 50, prompt: "A Beta question", helpText: null, mediaUrl: null, mediaPosterUrl: null,
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

/** Pick an answer, then press Next. Picking alone no longer moves on. */
function answer(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }))
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
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

    answer("I am an Alpha")
    expect(screen.getByText("An Alpha question")).toBeTruthy()
    expect(screen.queryByText("Which describes you?")).toBeNull()
  })

  it("1a. picking an answer only selects it; Next moves on, and is disabled until something is picked", () => {
    // THE OWNER'S REPORT (2026-10-06): a click on an answer jumped straight to
    // the next test, and the page stayed scrolled down, so tapping the same
    // spot flicked through every movement test without showing its title.
    renderRunner()
    start()
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement
    expect(next.disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    expect(screen.getByText("Which describes you?")).toBeTruthy()
    expect(screen.getByRole("button", { name: "I am an Alpha" }).getAttribute("aria-pressed")).toBe("true")
    expect(next.disabled).toBe(false)

    // Changing your mind before Next is allowed.
    fireEvent.click(screen.getByRole("button", { name: "I am a Beta" }))
    expect(screen.getByRole("button", { name: "I am an Alpha" }).getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(next)
    expect(screen.getByText("A Beta question")).toBeTruthy()
  })

  it("1a2. Next brings the top of the quiz back into view when the visitor had scrolled past it", () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scrollIntoView, configurable: true })
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: -400 } as DOMRect)
    try {
      renderRunner()
      start()
      scrollIntoView.mockClear()
      answer("I am an Alpha")
      expect(screen.getByText("An Alpha question")).toBeTruthy()
      expect(scrollIntoView).toHaveBeenCalled()
    } finally {
      rect.mockRestore()
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
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

    answer("I am an Alpha")
    // Once the branch is known the total is real, so it is shown.
    expect(screen.getByText("Question 2 of 2")).toBeTruthy()
  })

  it("2. goes back to the previous question with the previous answer still selected", () => {
    renderRunner()
    start()
    answer("I am an Alpha")
    fireEvent.click(screen.getByRole("button", { name: "Back" }))

    expect(screen.getByText("Which describes you?")).toBeTruthy()
    expect(screen.getByRole("button", { name: "I am an Alpha" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "I am a Beta" }).getAttribute("aria-pressed")).toBe("false")
  })

  it("3. shows the gate only after the last walked question", () => {
    renderRunner()
    start()
    expect(screen.queryByLabelText("Email")).toBeNull()
    answer("I am an Alpha")
    expect(screen.queryByLabelText("Email")).toBeNull()
    answer("Alpha answer")
    expect(screen.getByLabelText("Email")).toBeTruthy()
  })

  it("4. asks a different second question depending on the router answer", () => {
    renderRunner()
    start()
    answer("I am a Beta")
    expect(screen.getByText("A Beta question")).toBeTruthy()
    expect(screen.queryByText("An Alpha question")).toBeNull()
  })

  it("4b. a quiz with no branches and no intro copy opens on question one, with its total", () => {
    const flat: PublicQuizDefinition = {
      ...DEFINITION,
      introHeadline: "",
      introBody: "",
      branches: [],
      questions: [
        { ...DEFINITION.questions[1], id: "q-1", branchId: null, position: 10, prompt: "First shared" },
        { ...DEFINITION.questions[2], id: "q-2", branchId: null, position: 20, prompt: "Second shared" },
      ],
    }
    render(<QuizRunner definition={flat} submitLabel="See my result" />)
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull()
    expect(screen.getByText("First shared")).toBeTruthy()
    expect(screen.getByText("Question 1 of 2")).toBeTruthy()
  })

  it("4c. still shows the intro screen when the quiz has intro copy", () => {
    renderRunner()
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy()
    expect(screen.queryByText("Which describes you?")).toBeNull()
  })

  it("4d. prefills the gate from the name and email a landing form carried over", async () => {
    window.sessionStorage.setItem("djp-funnel-contact", JSON.stringify({ name: "Sam Park", email: "sam@example.com" }))
    try {
      renderRunner()
      start()
      answer("I am an Alpha")
      answer("Alpha answer")
      await waitFor(() => expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("sam@example.com"))
      expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Sam Park")
    } finally {
      window.sessionStorage.clear()
    }
  })

  it("4e. leaves the gate empty when nothing was carried over", () => {
    renderRunner()
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("")
  })

  it("5. a testRun makes ZERO progress calls", async () => {
    renderRunner({ testRun: true })
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy())

    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.filter((c) => String(c[0]).includes("/api/quiz/progress"))).toHaveLength(0)
  })

  it("5b. a normal run DOES post progress — so test 5 is not vacuous", async () => {
    renderRunner()
    start()
    answer("I am an Alpha")
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
    answer("I am an Alpha")
    answer("Alpha answer")
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
    answer("I am an Alpha")
    answer("Alpha answer")
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("shows the SMS checkbox with the exact wording it was given", () => {
    renderRunner({ smsConsentWording: "I agree to receive text messages from DJP Athlete." })
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    expect(screen.getByRole("checkbox")).toBeTruthy()
    expect(screen.getByText("I agree to receive text messages from DJP Athlete.")).toBeTruthy()
  })

  it("shows no email consent checkbox when no wording was supplied", () => {
    renderRunner()
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
  })

  it("shows the email consent checkbox, UNCHECKED, with the exact wording it was given", () => {
    renderRunner({
      emailConsentWording:
        "Yes, DJP Athlete can email me training tips, news and offers. I can unsubscribe at any time.",
    })
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    expect(
      screen.getByText("Yes, DJP Athlete can email me training tips, news and offers. I can unsubscribe at any time."),
    ).toBeTruthy()
  })

  it("shows BOTH the SMS and email checkboxes, independently, when both wordings are given", () => {
    renderRunner({
      smsConsentWording: "I agree to receive text messages from DJP Athlete.",
      emailConsentWording:
        "Yes, DJP Athlete can email me training tips, news and offers. I can unsubscribe at any time.",
    })
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    expect(screen.getAllByRole("checkbox")).toHaveLength(2)
  })

  it("posts emailConsent: true when the box is ticked before submit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/quiz/progress")) {
          return new Response(JSON.stringify({ attemptId: "att-1" }), { status: 200 })
        }
        return new Response(
          JSON.stringify({ score: 0, tier: null, profile: null, branch: null }),
          { status: 200 },
        )
      }),
    )
    renderRunner({
      emailConsentWording:
        "Yes, DJP Athlete can email me training tips, news and offers. I can unsubscribe at any time.",
    })
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } })
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "See my result" }))

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.some((c) => String(c[0]).includes("/api/quiz/submit"))).toBe(true)
    })
    const submitCall = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("/api/quiz/submit"),
    )!
    const body = JSON.parse((submitCall[1] as RequestInit).body as string)
    expect(body.emailConsent).toBe(true)
  })

  it("posts emailConsent: false when the box is left unchecked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/quiz/progress")) {
          return new Response(JSON.stringify({ attemptId: "att-1" }), { status: 200 })
        }
        return new Response(
          JSON.stringify({ score: 0, tier: null, profile: null, branch: null }),
          { status: 200 },
        )
      }),
    )
    renderRunner({
      emailConsentWording:
        "Yes, DJP Athlete can email me training tips, news and offers. I can unsubscribe at any time.",
    })
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } })
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "See my result" }))

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.some((c) => String(c[0]).includes("/api/quiz/submit"))).toBe(true)
    })
    const submitCall = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("/api/quiz/submit"),
    )!
    const body = JSON.parse((submitCall[1] as RequestInit).body as string)
    expect(body.emailConsent).toBe(false)
  })

  it("refuses to submit in a plain preview that is not a test run", async () => {
    renderRunner({ isPreview: true })
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    fireEvent.click(screen.getByRole("button", { name: "See my result" }))
    await waitFor(() => expect(screen.getByText(/Submissions are disabled/)).toBeTruthy())
  })
})

describe("QuizRunner — the mistakes clip", () => {
  const withClip: PublicQuizDefinition = {
    ...DEFINITION,
    questions: DEFINITION.questions.map((q) =>
      q.id === "q-router" ? { ...q, mediaUrl: "https://x/demo.mp4", mistakesMediaUrl: "https://x/mistakes.mp4", mistakesMediaPosterUrl: "https://x/m.jpg" } : q,
    ),
  }

  it("shows no toggle when a question has no mistakes clip", () => {
    renderRunner()
    start()
    expect(screen.queryByRole("button", { name: "Common mistakes" })).toBeNull()
  })

  it("swaps the player to the mistakes clip and back", () => {
    const { container } = render(<QuizRunner definition={withClip} submitLabel="See my result" />)
    start()
    const src = () => container.querySelector("video.djp-quiz-media")?.getAttribute("src")
    expect(src()).toBe("https://x/demo.mp4")
    fireEvent.click(screen.getByRole("button", { name: "Common mistakes" }))
    expect(src()).toBe("https://x/mistakes.mp4")
    expect(container.querySelector("video.djp-quiz-media")?.getAttribute("poster")).toBe("https://x/m.jpg")
    fireEvent.click(screen.getByRole("button", { name: "How to do it" }))
    expect(src()).toBe("https://x/demo.mp4")
  })
})

describe("QuizRunner — the mini-assessment result", () => {
  async function walkToResult(body: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/api/quiz/progress")
        ? new Response(JSON.stringify({ attemptId: "att-1" }), { status: 200 })
        : new Response(JSON.stringify(body), { status: 200 }),
    ))
    const view = renderRunner()
    start()
    answer("I am an Alpha")
    answer("Alpha answer")
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } })
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "See my result" }))
    await waitFor(() => expect(screen.getByText("Real gaps")).toBeTruthy())
    return view
  }
  const tier = { key: "orange", headline: "Real gaps", body: "First para.\n\nSecond para.", ctaLabel: "Go", ctaHref: "/x" }

  it("renders the mirror, the map rows with sides and status, and splits the body into paragraphs", async () => {
    await walkToResult({
      score: 48, tier, profile: null, branch: null,
      mirror: [{ prompt: "Which sport?", answer: "Golf" }],
      map: [{ label: "Short lever Copenhagen", left: 3, right: 1, single: null, max: 3, status: "gap" }],
    })
    expect(screen.getByText("What you told us")).toBeTruthy()
    expect(screen.getByText("Golf")).toBeTruthy()
    expect(screen.getByText("Your movement map")).toBeTruthy()
    expect(screen.getByText("Short lever Copenhagen")).toBeTruthy()
    expect(screen.getByText("Left/right gap")).toBeTruthy()
    expect(screen.getByLabelText("Left: 3 of 3")).toBeTruthy()
    expect(screen.getByLabelText("Right: 1 of 3")).toBeTruthy()
    expect(screen.getByText("First para.")).toBeTruthy()
    expect(screen.getByText("Second para.")).toBeTruthy()
  })

  it("athlete-quiz result unchanged: no mirror, no map when the map is empty", async () => {
    const { container } = await walkToResult({
      score: 48, tier: { ...tier, body: "One para." }, profile: null, branch: null,
      mirror: [{ prompt: "Which sport?", answer: "Golf" }], map: [],
    })
    expect(screen.queryByText("What you told us")).toBeNull()
    expect(screen.queryByText("Your movement map")).toBeNull()
    expect(container.querySelectorAll("p.djp-quiz-profile-body")).toHaveLength(1)
  })

  it("tolerates an older server response with no mirror or map", async () => {
    await walkToResult({ score: 48, tier, profile: null, branch: null })
    expect(screen.queryByText("Your movement map")).toBeNull()
  })
})

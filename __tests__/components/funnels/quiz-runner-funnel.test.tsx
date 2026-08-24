// THE CHAIN THIS PINS: `FunnelRenderContext` has always carried funnelId and
// stepId to every island. `QuizIsland` never passed them on, so the submit
// body could not name the funnel and no lead could be filed against it.
//
// AND THE ONE THAT MUST NOT MOVE: /preview/<slug> sets `testRun`, whose whole
// promise is that it writes nothing. Its body is `{quizId, answers}` and the
// route it posts to accepts nothing else -- a funnel id in that body is the
// first half of a preview that files leads.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QuizRunner } from "@/components/funnels/islands/QuizRunner"
import type { PublicQuizDefinition } from "@/lib/quizzes/public-definition"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const FUNNEL_ID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"
const STEP_ID = "dddddddd-1111-4111-8111-dddddddddddd"

const DEFINITION: PublicQuizDefinition = {
  id: QUIZ_ID,
  key: "rpi",
  introHeadline: "Find your gaps",
  introBody: "Three minutes.",
  gateHeadline: "Where should we send it?",
  gateBody: "",
  resultHeadline: "Your readout",
  branches: [],
  questions: [
    {
      id: "q-only",
      branchId: null,
      position: 10,
      prompt: "Only question",
      helpText: null,
      options: [{ id: "o-yes", label: "Yes", routesToBranchId: null }],
    },
  ],
}

const fetchMock = vi.fn()

function callTo(path: string) {
  return fetchMock.mock.calls.find((call) => String(call[0]) === path)
}
function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>
}

/** Intro -> the one question -> the details gate -> submit. */
async function complete(props: Record<string, unknown> = {}) {
  render(<QuizRunner definition={DEFINITION} submitLabel="See my result" {...props} />)
  fireEvent.click(screen.getByRole("button", { name: "Start" }))
  fireEvent.click(await screen.findByRole("button", { name: "Yes" }))
  fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Sam Athlete" } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } })
  fireEvent.click(screen.getByRole("button", { name: "See my result" }))
  await waitFor(() =>
    expect(callTo("/api/quiz/submit") ?? callTo("/api/quiz/preview-submit")).toBeTruthy(),
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ score: 50, tier: null, profile: null, branch: null }),
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("QuizRunner on a funnel page", () => {
  it("posts the funnel and step it is standing on", async () => {
    await complete({ funnelId: FUNNEL_ID, stepId: STEP_ID })
    const body = bodyOf(callTo("/api/quiz/submit")!)
    expect(body.funnelId).toBe(FUNNEL_ID)
    expect(body.stepId).toBe(STEP_ID)
  })

  it("posts neither when it is not on a funnel page", async () => {
    await complete()
    const body = bodyOf(callTo("/api/quiz/submit")!)
    expect(body.funnelId).toBeUndefined()
    expect(body.stepId).toBeUndefined()
  })

  it("a TEST RUN still posts only the quiz and the answers", async () => {
    await complete({ funnelId: FUNNEL_ID, stepId: STEP_ID, isPreview: true, testRun: true })
    expect(callTo("/api/quiz/submit")).toBeUndefined()
    const body = bodyOf(callTo("/api/quiz/preview-submit")!)
    expect(Object.keys(body).sort()).toEqual(["answers", "quizId"])
  })
})

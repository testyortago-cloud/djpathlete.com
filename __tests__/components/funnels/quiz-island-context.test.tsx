// @vitest-environment node
//
// THE ISLAND'S OWN WIRING. `QuizRunner` posting `funnelId` proves nothing
// about `QuizIsland` handing it the right one -- passing `context.funnelSlug`
// there would type-check, render, and file every quiz lead against a funnel id
// that does not exist. The island is an async server component, so it is
// CALLED rather than rendered and the element it returns is inspected.
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactElement } from "react"

const getQuizDefinition = vi.fn()
const getBusinessSettings = vi.fn()

vi.mock("@/lib/db/quizzes", () => ({ getQuizDefinition: (...a: unknown[]) => getQuizDefinition(...a) }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: (...a: unknown[]) => getBusinessSettings(...a) }))

// The route resolves its tenant from the request's Host through the ONE Host
// boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a route that hard-codes platformBusinessId() cannot pass.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { QuizIsland } from "@/components/funnels/islands/QuizIsland"
import type { FunnelRenderContext } from "@/components/funnels/islands"
import type { QuizDefinition } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const FUNNEL_ID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"
const STEP_ID = "dddddddd-1111-4111-8111-dddddddddddd"

const DEFINITION: QuizDefinition = {
  id: QUIZ_ID,
  key: "rpi_athlete_quiz",
  name: "RPI",
  status: "active",
  introHeadline: "Find your gaps",
  introBody: "",
  gateHeadline: "",
  gateBody: "",
  resultHeadline: "",
  seedMarker: null,
  branches: [],
  profiles: [],
  tiers: [],
  questions: [],
}

const CONTEXT: FunnelRenderContext = {
  funnelId: FUNNEL_ID,
  funnelSlug: "athlete-quiz",
  stepId: STEP_ID,
  stepSlug: "quiz",
  isPreview: false,
}

beforeEach(() => {
  vi.resetAllMocks()
  getQuizDefinition.mockResolvedValue(DEFINITION)
  getBusinessSettings.mockResolvedValue({ display_name: "DJP Athlete" })
})

describe("QuizIsland", () => {
  it("hands the runner the funnel's ID, not its slug", async () => {
    const element = (await QuizIsland({ props: { quizId: QUIZ_ID }, context: CONTEXT })) as ReactElement
    const props = element.props as { funnelId?: string; stepId?: string }
    expect(props.funnelId).toBe(FUNNEL_ID)
    expect(props.funnelId).not.toBe(CONTEXT.funnelSlug)
  })

  it("hands the runner the step's ID, not its slug", async () => {
    const element = (await QuizIsland({ props: { quizId: QUIZ_ID }, context: CONTEXT })) as ReactElement
    const props = element.props as { stepId?: string }
    expect(props.stepId).toBe(STEP_ID)
    expect(props.stepId).not.toBe(CONTEXT.stepSlug)
  })

  it("reads the business settings for the Host-resolved tenant, not the platform's", async () => {
    await QuizIsland({ props: { quizId: QUIZ_ID }, context: CONTEXT })
    expect(getBusinessSettings).toHaveBeenCalledWith("host-biz")
  })
})

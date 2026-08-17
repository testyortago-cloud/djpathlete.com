// __tests__/components/admin/funnel-publish-all.test.tsx — the split publish
// control, and the guard that stops the builder and the background draft queue
// building the same page twice.
//
// IT MOUNTS THE REAL `ConnectionsProvider` RATHER THAN MOCKING THE HOOK, and
// that is the load-bearing choice in this file. An earlier draft of these tests
// `vi.mock`-ed `connections-context` with a STATIC `draftPhase`, which makes the
// `writing -> done` transition unreachable by construction — and that
// transition is exactly where the initial-prompt guard was wrong: a bare
// `return` left the effect armed, so the creation prompt fired the moment the
// queue SUCCEEDED. A mocked phase cannot see it. The real provider can, and
// does (see "does NOT fire its creation prompt…", final two assertions).
//
// THE REPORT: "There should be no seperate publish again, if i publish it in
// the builder it should publish it now immidately, the whole funnel, also when
// its a funnel when i click publish you can choose publish all or publish
// steps."
//
// EVERY TEST NAMES THE MUTANT IT KILLS, because this repo's dominant defect
// class is a test that cannot fail — this feature alone has produced three.
//
// `fireEvent`, not `@testing-library/user-event`: that package is not a
// dependency of this repo. Same deviation, same reason, as
// __tests__/components/admin/funnel-builder.test.tsx:16-19.

import { useState } from "react"
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import { FunnelBuilder, type FunnelBuilderProps } from "@/components/admin/funnels/FunnelBuilder"
import {
  ConnectionsProvider,
  useConnections,
  type DraftJob,
  type RailPage,
} from "@/components/admin/funnels/connections-context"
import { encodeBuildStreamEvent, type BuildStreamEvent } from "@/lib/funnels/sections/build-stream"
import { sectionDocSchema } from "@/lib/funnels/sections/registry"
import type { StepWithDoc } from "@/lib/funnels/connections"
import type {
  BuildTurnResponse,
  CompileSummary,
  DanglingAnchor,
  SectionDoc,
} from "@/components/admin/funnels/builder/types"

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock("sonner", () => ({ toast }))

// next/navigation is globally mocked in __tests__/setup.tsx.

// Radix's DropdownMenu leans on Pointer Events APIs jsdom does not ship.
// Without these the menu never opens. Same three stubs, same reason, as
// __tests__/components/admin/content-studio/drawer/GenerateQuoteCardsButton.test.tsx:17-27.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FUNNEL_ID = "f1"
const STEP_ID = "s1"

/**
 * A document that REALLY PARSES.
 *
 * `heroPropsSchema` requires `primaryCta`, and the fixture in
 * funnel-builder.test.tsx omits it — harmless there because nothing in the
 * builder validates `initialDoc`, and a live landmine anywhere the document
 * reaches a schema. The provider-backed tests below hand this straight to
 * `funnelConnections`, so it is asserted against the real schema in the first
 * test rather than assumed.
 */
const DOC: SectionDoc = {
  v: 1,
  engine: "sections",
  theme: { tone: "light", accent: "accent", radius: "soft" },
  sections: [
    {
      id: "hero1",
      kind: "hero",
      variant: "centered",
      style: {},
      props: {
        headline: "Train like an athlete",
        primaryCta: { label: "Get started", target: { kind: "step", stepSlug: "thanks" } },
      },
    },
  ],
}

const CLEAN_COMPILE: CompileSummary = { ok: true, problems: [], warnings: [] }

/** Advisory, never blocking — the one state that opens the review with publish still allowed. */
const DANGLING: DanglingAnchor = { sectionId: "hero1", field: "primaryCta.target", target: "pricing" }

function turn(overrides: Partial<BuildTurnResponse> = {}): BuildTurnResponse {
  return {
    revision: 6,
    doc: DOC,
    reply: "Built the page.",
    blocked: false,
    receipt: null,
    compile: CLEAN_COMPILE,
    unresolved: [],
    danglingAnchors: [],
    resolutionError: null,
    source: "ai",
    ...overrides,
  }
}

const renderForPublish = vi.fn()

function baseProps(overrides: Partial<FunnelBuilderProps> = {}): FunnelBuilderProps {
  return {
    funnelId: FUNNEL_ID,
    funnelName: "Free trial week",
    stepId: STEP_ID,
    stepName: "Landing",
    publicUrl: "/go/free-trial-week",
    // A DRAFT FUNNEL, because that is the state the owner publishes from: the
    // whole complaint is that taking a funnel live used to be a second act on
    // a second screen.
    funnelStatus: "draft",
    funnelKind: "funnel",
    initialDoc: DOC,
    initialRevision: 5,
    docInvalid: false,
    resetToRevision: null,
    initialUnresolved: [],
    initialDanglingAnchors: [],
    initialCompile: CLEAN_COMPILE,
    initialResolutionError: null,
    initialMessages: [],
    maxMessageLength: 12_000,
    renderForPublish,
    ...overrides,
  }
}

const PAGES: RailPage[] = [
  { id: "s1", name: "Landing", slug: "index", position: 0, isEntry: true, live: false, published: false },
  { id: "s2", name: "Thank you", slug: "thanks", position: 1, isEntry: false, live: false, published: false },
  { id: "s3", name: "Offer", slug: "offer", position: 2, isEntry: false, live: false, published: false },
]

const BLANK_DOCS: StepWithDoc[] = PAGES.map((page) => ({ ...page, doc: null }))

// ---------------------------------------------------------------------------
// The transport.
//
// REAL `Response` objects, not `{ok, status, json}` literals: the builder
// branches on `Content-Type` and reads `response.body` through a stream reader,
// and an object literal cannot exercise either.
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function sseResponse(events: BuildStreamEvent[]): Response {
  return new Response(events.map(encodeBuildStreamEvent).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  })
}

/**
 * Routes by URL, and keeps the funnel route and the step route APART.
 *
 * `/api/admin/funnels/steps/s1/publish` also contains "/publish", so a
 * substring test would answer the two with the same body and the whole point of
 * this file — which route the button hits — would be untestable.
 */
function mockFetch(
  handlers: {
    funnelPublish?: () => { status: number; body: unknown }
    stepPublish?: () => { status: number; body: unknown }
    build?: () => Response
  } = {},
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `/api/admin/funnels/${FUNNEL_ID}/publish`) {
      const result = handlers.funnelPublish?.() ?? {
        status: 200,
        body: { published: 3, pages: [], warnings: [] },
      }
      return jsonResponse(result.status, result.body)
    }
    if (url.includes("/publish")) {
      const result = handlers.stepPublish?.() ?? { status: 200, body: { version: 4, warnings: [] } }
      return jsonResponse(result.status, result.body)
    }
    void init
    return handlers.build?.() ?? sseResponse([{ type: "result", turn: turn() }])
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

type FetchMock = ReturnType<typeof mockFetch>

const urlsOf = (fetchMock: FetchMock): string[] => fetchMock.mock.calls.map((call) => String(call[0]))

const buildUrls = (fetchMock: FetchMock): string[] => urlsOf(fetchMock).filter((url) => url.includes("/build"))

function bodyOf(fetchMock: FetchMock, call: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[call][1] as unknown as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown>
}

const publishFunnelButton = () => screen.getByRole("button", { name: /^publish funnel$/i })

/**
 * Radix opens on pointerdown and closes over a portal; `fireEvent.click` alone
 * does not open it in jsdom. Same driver as GenerateQuoteCardsButton's test.
 */
async function openPublishMenu(): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name: /more publish options/i })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.pointerUp(trigger, { button: 0 })
  fireEvent.click(trigger)
  return screen.findByRole("menuitem", { name: /publish this page only/i })
}

function renderInProvider(props: FunnelBuilderProps, draftJobs: DraftJob[], docs: StepWithDoc[] = BLANK_DOCS) {
  return render(
    <ConnectionsProvider
      funnelId={FUNNEL_ID}
      funnelSlug="free-trial-week"
      funnelKind="funnel"
      pages={PAGES}
      initialDocs={docs}
      draftJobs={draftJobs}
    >
      <FunnelBuilder {...props} />
    </ConnectionsProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  renderForPublish.mockResolvedValue({ ok: true, html: "<div></div>", css: "", problems: [], warnings: [] })
  mockFetch()
})

// ---------------------------------------------------------------------------
// The split control
// ---------------------------------------------------------------------------

describe("publishing a funnel from the builder", () => {
  it("publishes the WHOLE FUNNEL on the primary click", async () => {
    // The fixture has to be a real document or three tests below would be
    // measuring a shape the schema rejects.
    expect(sectionDocSchema.safeParse(DOC).success).toBe(true)

    // MUTANT: pointing the primary button at the per-step route. That is the
    // two-click, two-screen behaviour the owner rejected — the page would
    // publish and the funnel would stay a draft behind a 404.
    const fetchMock = mockFetch({
      funnelPublish: () => ({
        status: 200,
        body: {
          published: 3,
          pages: [
            { stepId: "s1", stepName: "Landing", version: 7 },
            { stepId: "s2", stepName: "Thank you", version: 2 },
            { stepId: "s3", stepName: "Offer", version: 1 },
          ],
          warnings: [],
        },
      }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(publishFunnelButton())

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/funnels/f1/publish",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    expect(urlsOf(fetchMock)).not.toContain("/api/admin/funnels/steps/s1/publish")

    // MUTANT: `version: 0` as a funnel-wide sentinel, which is what the plan
    // proposed. "Published version 0" is a lie about a row that does not exist,
    // and a sentinel only one branch understands is how the next reader gets it
    // wrong — so the funnel-wide result reports PAGES and nothing else.
    expect(await screen.findByText(/3 pages published/i)).toBeInTheDocument()
    expect(screen.queryByText(/published version/i)).toBeNull()

    // MUTANT: rendering this tab's document and POSTing it. The funnel route
    // reads every page's STORED draft — it is the only thing it could honestly
    // publish for the pages this tab is not holding — so sending one page's
    // in-memory copy would mean the button published two different things
    // depending on which tab it was pressed in.
    expect(renderForPublish).not.toHaveBeenCalled()
  })

  it("offers 'Publish this page only', which uses the step route", async () => {
    // MUTANT: dropping the menu, or wiring both halves to the same route. This
    // is the "publish steps" half of the request.
    const fetchMock = mockFetch({ stepPublish: () => ({ status: 200, body: { version: 4, warnings: [] } }) })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(await openPublishMenu())

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/funnels/steps/s1/publish",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    expect(urlsOf(fetchMock)).not.toContain("/api/admin/funnels/f1/publish")
    // And it is still the PAGE publish, with everything that hangs off it: the
    // rendered document goes over the wire and the strip names the version.
    expect(renderForPublish).toHaveBeenCalledWith(DOC)
    expect(await screen.findByText(/published version 4/i)).toBeInTheDocument()
  })

  it("shows ONE publish button, with no menu, for a landing page", async () => {
    // MUTANT: rendering the split control unconditionally. A landing page is
    // one page; offering to publish it two ways is noise, and "Publish funnel"
    // on a landing page is the wrong-screen wording the owner has already
    // objected to once.
    //
    // ASSERTED ON THE TRIGGER, NOT THE MENU ITEM. The brief's assertion was
    // `queryByRole("button", { name: /publish this page only/i })` — but that
    // item is a `menuitem` inside a closed portal, so the query answers `null`
    // for a FUNNEL too and the test could not fail either way.
    const fetchMock = mockFetch({ stepPublish: () => ({ status: 200, body: { version: 4, warnings: [] } }) })

    render(<FunnelBuilder {...baseProps({ funnelKind: "page" })} />)

    expect(screen.getByRole("button", { name: /^publish$/i })).toBeEnabled()
    expect(screen.queryByRole("button", { name: /more publish options/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /publish funnel/i })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/funnels/steps/s1/publish",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    expect(urlsOf(fetchMock)).not.toContain("/api/admin/funnels/f1/publish")
  })

  it("stops offering the funnel publish once the funnel IS this document", async () => {
    // MUTANT: the funnel primary button with no `upToDate` branch — which is
    // what the draft shipped. It renders a greyed-out "Publish funnel" beside a
    // strip reading "3 pages published", and the only available reading of that
    // is "the publish did not take, press it again". It is the owner's own
    // report, one control over: "when i publish there is no version showing
    // then the publish button is still available that its confusing".
    //
    // The landing-page button has said "Published" since an earlier stage
    // (funnel-builder.test.tsx, "stops offering Publish once the live page IS
    // this page"); this is the funnel half of the same rule.
    mockFetch({
      funnelPublish: () => ({
        status: 200,
        body: {
          published: 3,
          pages: [{ stepId: "s1", stepName: "Landing", version: 9 }],
          warnings: [],
        },
      }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(publishFunnelButton())

    await waitFor(() => expect(screen.getByText(/3 pages published/i)).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: /^publish funnel$/i })).toBeNull()
    expect(screen.getByRole("button", { name: /^published$/i })).toBeDisabled()

    // MUTANT: not reading this step's version out of the 200 body. The route
    // wrote a version row for this page too and NAMES it, so a header pill left
    // on the old number reports a snapshot that is no longer being served.
    expect(screen.getByText(/v9 live/i)).toBeInTheDocument()
  })

  it("makes the review's 'Publish now' the same act as the header's", async () => {
    // MUTANT: leaving the review's `onPublish` on `publishThisPage` for a
    // funnel — which is what the draft shipped. The review is reachable from
    // "N to check" while publishing is still allowed, so the screen would carry
    // two controls both labelled publish that did different things. That is the
    // complaint that started this feature ("there is two publish, and also a
    // publish now"), and it is worse here: the review's own copy says the
    // funnel is not live yet, so the button beside that sentence has to be the
    // one that fixes it.
    const fetchMock = mockFetch()

    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)
    // A dangling anchor is advisory, so it opens the review without blocking.
    fireEvent.click(screen.getByRole("button", { name: /\d+ to check/i }))
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/funnels/f1/publish",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    expect(urlsOf(fetchMock)).not.toContain("/api/admin/funnels/steps/s1/publish")
  })
})

// ---------------------------------------------------------------------------
// A refusal that is about a page you are not looking at
// ---------------------------------------------------------------------------

describe("a funnel-wide publish refusal", () => {
  it("routes a 422 naming ANOTHER page into the chat, with a link to it", async () => {
    // MUTANT: rendering the problems as bare strings, the way `reportRefusal`
    // does. The owner is told a page name and left to find it — and this repo's
    // own rule is that in a chat builder an error the AI can fix must never be
    // a dead end.
    mockFetch({
      funnelPublish: () => ({
        status: 422,
        body: {
          error: "This funnel could not be published.",
          pages: [
            { stepId: "s2", stepName: "Thank you", problems: ["Thank you has no content yet."], blank: true },
          ],
        },
      }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(publishFunnelButton())

    expect(await screen.findByText(/Thank you has no content yet/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Thank you/ })).toHaveAttribute(
      "href",
      "/admin/funnels/f1/edit/s2",
    )
    // MUTANT: `reportPageRefusal` without `setServerBlockers`, which is the
    // exact hole the step route's 422 branch shipped with — the route refuses
    // and the button that triggered it stays armed, ready to spend another
    // round trip on the same refusal.
    expect(publishFunnelButton()).toBeDisabled()
  })

  it("gives the fail-closed refusal no link, because there is no page to open", async () => {
    // The route's catch emits `stepId: ""` / `stepName: "This funnel"` — the
    // gate itself failed, so the problem is about the funnel and not about any
    // one page.
    //
    // MUTANT: linking every row. `adminStepHref(kind, "f1", "")` is
    // "/admin/funnels/f1/edit/", a 404 offered as the way out of a refusal.
    mockFetch({
      funnelPublish: () => ({
        status: 422,
        body: {
          error: "This funnel could not be published.",
          pages: [
            {
              stepId: "",
              stepName: "This funnel",
              problems: ["Its pages could not be checked, so nothing was published: catalogue read failed"],
              blank: false,
            },
          ],
        },
      }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(publishFunnelButton())

    expect(await screen.findByText(/nothing was published/i)).toBeInTheDocument()
    expect(screen.getByText("This funnel")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /this funnel/i })).toBeNull()
  })

  it("offers 'Generate it now' for a page that is merely blank", async () => {
    // MUTANT: offering it for every problem. "Generate it now" is a real fix
    // for an empty page and nonsense for a dead CTA — which is exactly why
    // `blank` is computed by the planner rather than sniffed from the message.
    const fetchMock = mockFetch({
      funnelPublish: () => ({
        status: 422,
        body: {
          error: "This funnel could not be published.",
          pages: [
            { stepId: "s2", stepName: "Thank you", problems: ["Thank you has no content yet."], blank: true },
            {
              stepId: "s3",
              stepName: "Offer",
              problems: ['Its buy button points at "Comeback Cod", which does not exist.'],
              blank: false,
            },
          ],
        },
      }),
    })

    renderInProvider(baseProps(), [
      { stepId: "s2", prompt: "Write the thank-you page", revision: 0 },
      { stepId: "s3", prompt: "Write the offer page", revision: 0 },
    ])
    fireEvent.click(publishFunnelButton())

    expect(await screen.findByText(/Thank you has no content yet/)).toBeInTheDocument()
    expect(screen.getByText(/Comeback Cod/)).toBeInTheDocument()

    // ONE button for two refused pages — the blank one.
    const generate = screen.getAllByRole("button", { name: /generate it now/i })
    expect(generate).toHaveLength(1)

    fireEvent.click(generate[0])
    // MUTANT: a button that only looks like a fix. `draftStep` is the provider's
    // real writer, so the proof is the build request for THAT page and no other.
    await waitFor(() => expect(buildUrls(fetchMock)).toContain("/api/admin/funnels/steps/s2/build"))
    expect(buildUrls(fetchMock)).not.toContain("/api/admin/funnels/steps/s3/build")
  })
})

// ---------------------------------------------------------------------------
// The builder and the background queue must not both build the same page
// ---------------------------------------------------------------------------

/** Mounts the builder on demand, so the queue can already be running when it does. */
function LateBuilder({ builderProps }: { builderProps: FunnelBuilderProps }) {
  const context = useConnections()
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => context?.draftStep(STEP_ID)}>queue this page</button>
      <button onClick={() => setOpen(true)}>open the builder</button>
      <span data-testid="phase-s1">{context?.draftPhase(STEP_ID)}</span>
      {open ? <FunnelBuilder {...builderProps} /> : null}
    </div>
  )
}

describe("the creation prompt and the background queue", () => {
  it("does NOT fire its creation prompt for a step the queue is already writing", async () => {
    // MUTANT: dropping the guard. `[stepId]/page.tsx` still computes
    // `wantsFirstDraft` as true while the queue is mid-build (the build route
    // writes its turn LAST), so clicking into a page being drafted would start
    // a SECOND build on the same step — racing the optimistic lock and burning
    // a model call.
    let release: (() => void) | null = null
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/build")) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return sseResponse([{ type: "result", turn: turn() }])
      }
      return jsonResponse(200, {})
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(
      <ConnectionsProvider
        funnelId={FUNNEL_ID}
        funnelSlug="free-trial-week"
        funnelKind="funnel"
        pages={PAGES}
        initialDocs={BLANK_DOCS}
        draftJobs={[{ stepId: STEP_ID, prompt: "The queue's own prompt", revision: 0 }]}
      >
        <LateBuilder
          builderProps={baseProps({
            initialPrompt: "The builder's own prompt",
            initialDoc: null,
            initialCompile: null,
          })}
        />
      </ConnectionsProvider>,
    )

    fireEvent.click(screen.getByText("queue this page"))
    await waitFor(() => expect(screen.getByTestId("phase-s1")).toHaveTextContent("writing"))

    fireEvent.click(screen.getByText("open the builder"))
    await act(async () => {
      await Promise.resolve()
    })

    expect(buildUrls(fetchMock as unknown as FetchMock)).toHaveLength(1)
    expect(bodyOf(fetchMock as unknown as FetchMock, 0).message).toBe("The queue's own prompt")

    // AND IT STAYS SPENT — the half a bare `return` gets wrong, and the half a
    // mocked static `draftPhase` cannot observe. `draftPhase` is a
    // `useCallback` over the phase map, so its identity changes on every
    // transition and the effect RE-RUNS. On `writing -> done` every remaining
    // guard is still satisfied (`props.initialDoc` is a PROP — still the null
    // the server rendered), so an armed effect fires the creation prompt the
    // moment the queue SUCCEEDED: the same double build, thirty seconds later,
    // over a page that was just written.
    act(() => release?.())
    await waitFor(() => expect(screen.getByTestId("phase-s1")).toHaveTextContent("done"))
    expect(buildUrls(fetchMock as unknown as FetchMock)).toHaveLength(1)
  })

  it("starts the queue only once this page's own draft has reached the graph", async () => {
    // Two mutants, and the second is invisible without the s1 job in the list.
    //
    // MUTANT: no `startAutoDraft()` call at all — steps 2..n sit blank until
    // the owner opens each one, which is the whole complaint Task 4 answered.
    //
    // MUTANT: declaring the kick effect BEFORE the `publishStepConnections`
    // effect. The queue's skip reads the graph at run time, so a kick that runs
    // first sees s1 still blank and drafts it a SECOND time — a full redundant
    // model call per funnel, with a red "failed" badge over the page the owner
    // just watched succeed when the two writers race the revision check.
    const fetchMock = mockFetch()

    renderInProvider(
      baseProps({ initialPrompt: "The builder's own prompt", initialDoc: null, initialCompile: null }),
      [
        { stepId: "s1", prompt: "The queue's copy of step 1", revision: 0 },
        { stepId: "s2", prompt: "Write the thank-you page", revision: 0 },
      ],
    )

    await waitFor(() => expect(buildUrls(fetchMock)).toContain("/api/admin/funnels/steps/s2/build"))
    expect(buildUrls(fetchMock).filter((url) => url.includes("/steps/s1/build"))).toHaveLength(1)
    expect(bodyOf(fetchMock, 0).message).toBe("The builder's own prompt")
  })
})

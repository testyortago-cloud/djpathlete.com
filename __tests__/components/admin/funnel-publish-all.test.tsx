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
import { publishedSummary } from "@/components/admin/funnels/publish-funnel"
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
    previewUrl: "/preview/summer-camp",
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

const composer = () => screen.getByLabelText(/describe the change/i)
const typeMessage = (text: string) => fireEvent.change(composer(), { target: { value: text } })
const clickSend = () => fireEvent.click(screen.getByRole("button", { name: /^send$/i }))

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

/**
 * The queue's phase for one step, rendered so a test can WAIT for it.
 *
 * Needed because several of the assertions below are about what the builder
 * does once a background draft has settled, and "settled" is not observable
 * from the builder's own DOM — a disabled publish button, for one, looks
 * identical before and after a draft fails. Waiting on a microtask instead
 * would be waiting on nothing in particular.
 */
function PhaseProbe({ stepId }: { stepId: string }) {
  const context = useConnections()
  return <span data-testid={`phase-${stepId}`}>{context?.draftPhase(stepId)}</span>
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
      {PAGES.map((page) => (
        <PhaseProbe key={page.id} stepId={page.id} />
      ))}
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
    expect(await screen.findByText(/published 3 pages/i)).toBeInTheDocument()
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
    // strip reading "Published 3 pages", and the only available reading of that
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

    await waitFor(() => expect(screen.getByText(/published 3 pages/i)).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: /^publish funnel$/i })).toBeNull()
    expect(screen.getByRole("button", { name: /^published$/i })).toBeDisabled()

    // MUTANT: not reading this step's version out of the 200 body. The route
    // wrote a version row for this page too and NAMES it, so a header pill left
    // on the old number reports a snapshot that is no longer being served.
    expect(screen.getByText(/v9 live/i)).toBeInTheDocument()
  })

  it("reports an all-legacy funnel publish as a success, not a failure", async () => {
    // MUTANT: `!body?.published` instead of `typeof body?.published !== "number"`.
    // `funnelPublishPlan` (`publish-plan.ts:86`) skips a step that already
    // carries a compiled version and has no `SectionDoc` to render — so a
    // funnel made entirely of legacy GrapesJS pages produces `plan.ok` with
    // `publish: []`, and the route still flips the funnel row live and returns
    // a real 200 `{published: 0}`. `0` is falsy, so the naive check reported
    // that success as "Could not publish. The live funnel is unchanged." while
    // the funnel had, in fact, just gone live — the same defect family as the
    // draft queue calling a failed build "done".
    mockFetch({
      funnelPublish: () => ({ status: 200, body: { published: 0, pages: [], warnings: [] } }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(publishFunnelButton())

    await waitFor(() => expect(screen.getByText(/published 0 pages/i)).toBeInTheDocument())
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("does not read a route's internal error out to the owner", async () => {
    // MUTANT: `toast.error(body?.error ?? "Could not publish…")`, which is what
    // shipped. On a 24-hour session expiry this route answers 403
    // `{error: "Forbidden"}` — so pressing Publish showed a toast that said, in
    // full, "Forbidden". The path this replaced said "Could not change the
    // status."
    //
    // Only 400 and 422 carry a sentence written for the owner, and the 422 is
    // asserted at length below ("routes a 422 naming ANOTHER page into the
    // chat"), so this rule cannot be passing by muting every message.
    mockFetch({ funnelPublish: () => ({ status: 403, body: { error: "Forbidden" } }) })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(publishFunnelButton())

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const message = String(toast.error.mock.calls[0][0])
    expect(message).not.toContain("Forbidden")
    expect(message).toMatch(/the live funnel is unchanged/i)
  })

  it("words a funnel publish the same way every other surface does", async () => {
    // MUTANT: the inlined literal this call site used to hold. `publishedSummary`
    // exists precisely so the builder's toast, the builder's result strip, the
    // funnel detail control and the board's Go live cannot drift — and the
    // builder was re-typing the sentence rather than calling the helper, while
    // the strip beside it worded it a third way ("3 pages published — the
    // funnel is live").
    //
    // Asserted against the HELPER, not a literal, so a reworded sentence moves
    // both surfaces or fails here.
    mockFetch({ funnelPublish: () => ({ status: 200, body: { published: 3, pages: [], warnings: [] } }) })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(publishFunnelButton())

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(publishedSummary(3)))
    expect(await screen.findByText(publishedSummary(3))).toBeInTheDocument()
  })

  it("keeps offering the funnel publish after only ONE page was published", async () => {
    // MUTANT: the funnel button reading the shared `upToDate`, which is what
    // shipped. `publishThisPage` also sets `publishedRevision`, so publishing
    // one page through the menu turned the primary into a disabled
    // "✓ Published" — claiming the whole funnel was live, on a funnel whose row
    // is still `draft`, with the one-click whole-funnel action gone from the
    // screen. That is the owner's original complaint rebuilt inside the control
    // that exists to remove it.
    const fetchMock = mockFetch({ stepPublish: () => ({ status: 200, body: { version: 4, warnings: [] } }) })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(await openPublishMenu())
    await waitFor(() => expect(screen.getByText(/published version 4/i)).toBeInTheDocument())

    // The page is done, so its own control stands down…
    expect(await screen.findByText(/this funnel is still a draft/i)).toBeInTheDocument()
    // …and the funnel's does NOT: nothing has taken the funnel live.
    expect(publishFunnelButton()).toBeEnabled()
    expect(screen.queryByRole("button", { name: /^published$/i })).toBeNull()

    fireEvent.click(publishFunnelButton())
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/funnels/f1/publish",
        expect.objectContaining({ method: "POST" }),
      ),
    )
  })

  it("stops calling the funnel a draft once it has taken it live", async () => {
    // MUTANT: `funnelIsDraft = props.funnelStatus !== "published"` alone, which
    // is what shipped. `funnelStatus` is a PROP and nothing reloads the page, so
    // every review opened after a successful one-click publish went on saying
    // "This funnel isn't live yet — set it to Published", linking to the very
    // screen this feature exists to delete. The route flips the row before it
    // returns 200, so this is a fact, not a guess.
    mockFetch({
      funnelPublish: () => ({ status: 200, body: { published: 3, pages: [], warnings: [] } }),
      build: () => sseResponse([{ type: "result", turn: turn({ revision: 9, danglingAnchors: [DANGLING] }) }]),
    })

    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)
    // Before: the review says the funnel is a draft.
    fireEvent.click(screen.getByRole("button", { name: /\d+ to check/i }))
    expect(screen.getByText(/isn't live yet/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /back to editing/i }))

    fireEvent.click(publishFunnelButton())
    await waitFor(() => expect(screen.getByText(/published 3 pages/i)).toBeInTheDocument())

    // A turn moves the revision on, so there is something to publish again and
    // the review is reachable exactly as it was.
    typeMessage("make the headline shorter")
    clickSend()
    await waitFor(() => expect(publishFunnelButton()).toBeEnabled())

    fireEvent.click(screen.getByRole("button", { name: /\d+ to check/i }))
    expect(screen.queryByText(/isn't live yet/i)).toBeNull()
  })

  it("hides the whole split control in review mode, menu included", () => {
    // MUTANT: dropping the `mode === "review"` guard from the funnel arm. The
    // page arm has been covered since an earlier stage ("the header button is
    // gone in review"); the funnel arm brought a second affordance with it —
    // and "Publish funnel", "More publish options" and "Publish now" all on
    // screen at once is three publish controls, which is the complaint that
    // started this feature with one more added.
    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)
    fireEvent.click(screen.getByRole("button", { name: /\d+ to check/i }))

    expect(screen.getByRole("button", { name: /publish now/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^publish funnel$/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /more publish options/i })).toBeNull()
  })

  it("names the funnel, not the page, in a review whose button publishes the funnel", () => {
    // MUTANT: leaving the review's heading page-scoped. "Nothing is blocking
    // this page" sitting directly above a button that takes five pages live is
    // the near-miss wording this screen exists to remove — the reader is being
    // told the scope of the CHECK where they need the scope of the ACT.
    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)
    fireEvent.click(screen.getByRole("button", { name: /\d+ to check/i }))

    expect(screen.getByText(/nothing is blocking this funnel/i)).toBeInTheDocument()
    expect(screen.queryByText(/nothing is blocking this page/i)).toBeNull()
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

  it("lets the fix it offers REOPEN the gate it shut", async () => {
    // MUTANT: `setServerBlockers(...)` on the funnel path with nothing that
    // clears it — which is what shipped, and it makes the headline feature's
    // primary error path a trap. `serverBlockers` is cleared in exactly one
    // other place, `applyTurn`, which only runs for THIS step's turns. So the
    // owner presses the "Generate it now" the refusal itself put in front of
    // him, the sibling page is written perfectly well through the provider, and
    // both publish controls stay disabled until he reloads the browser.
    //
    // The per-page 422 path self-heals only because the fix IT offers ("Fix it
    // for me") is a chat turn about this page. This path had no such property.
    const fetchMock = mockFetch({
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

    renderInProvider(baseProps(), [{ stepId: "s2", prompt: "Write the thank-you page", revision: 0 }])
    fireEvent.click(publishFunnelButton())

    await waitFor(() => expect(publishFunnelButton()).toBeDisabled())

    fireEvent.click(await screen.findByRole("button", { name: /generate it now/i }))
    await waitFor(() => expect(buildUrls(fetchMock)).toContain("/api/admin/funnels/steps/s2/build"))

    // REOPENED BY THE DRAFT LANDING, not by the click. The gate reopens because
    // a page really has been written, which is the honest trigger — a click
    // that reopened it would unblock publish for a page that had just failed.
    await waitFor(() => expect(publishFunnelButton()).toBeEnabled())
    expect(screen.queryByText(/thank you has no content yet/i)).not.toBeNull()
  })

  it("keeps the gate shut when the page it named FAILS to draft", async () => {
    // MUTANT: clearing `serverBlockers` on the click instead of on the phase.
    // The refusal would be dismissed by pressing a button, and publish would be
    // re-armed over a page that is still exactly as blank as it was reported.
    //
    // THE FAILURE IS WAITED FOR, NOT ASSUMED. This used to assert
    // `toBeDisabled()` after a single microtask — and disabled is ALSO the
    // state before the failure lands, so a pass proved the button was shut, not
    // that it STAYED shut through a failed draft. It did kill the mutant it
    // names (which re-arms on the click, before any phase moves), so it was
    // never vacuous; it simply did not prove what its title claims. `s2`
    // reaching `failed` is the event this test is about, so it waits for it.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url) === "/api/admin/funnels/f1/publish") {
        return jsonResponse(422, {
          error: "This funnel could not be published.",
          pages: [
            { stepId: "s2", stepName: "Thank you", problems: ["Thank you has no content yet."], blank: true },
          ],
        })
      }
      // The build route refuses: `runJob` reports this step "failed".
      return jsonResponse(500, {})
    })
    global.fetch = fetchMock as unknown as typeof fetch

    renderInProvider(baseProps(), [{ stepId: "s2", prompt: "Write the thank-you page", revision: 0 }])
    fireEvent.click(publishFunnelButton())
    await waitFor(() => expect(publishFunnelButton()).toBeDisabled())

    fireEvent.click(await screen.findByRole("button", { name: /generate it now/i }))
    await waitFor(() =>
      expect(buildUrls(fetchMock as unknown as FetchMock)).toContain("/api/admin/funnels/steps/s2/build"),
    )

    // THE DRAFT HAS ACTUALLY FAILED BY THIS LINE. `runJob` sets `failed` on a
    // non-streaming response, so this is the same signal the rail paints — and
    // it is the one thing that distinguishes "still shut" from "not open yet".
    await waitFor(() => expect(screen.getByTestId("phase-s2")).toHaveTextContent("failed"))
    expect(publishFunnelButton()).toBeDisabled()
    // ...and the reason is still on screen, rather than a gate shut for no
    // stated cause.
    expect(screen.getByText(/thank you has no content yet/i)).toBeInTheDocument()
  })

  it("says so rather than doing nothing when a blank page has no job to draft", async () => {
    // MUTANT: handing `draftStep` to the chat raw. It is a NO-OP when the layout
    // composed no job for that step — a page with neither a goal nor a template
    // composes no creation prompt — so the page is reported blank, offered the
    // button, and the press does nothing whatsoever. A control that silently
    // does nothing reads as a broken app; this repo calls that
    // `silent_gate_reads_as_broken`.
    const fetchMock = mockFetch({
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

    // NO JOB for s2 — the case the provider cannot report on its own.
    renderInProvider(baseProps(), [{ stepId: "s3", prompt: "Write the offer page", revision: 0 }])
    fireEvent.click(publishFunnelButton())

    fireEvent.click(await screen.findByRole("button", { name: /generate it now/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/can't be written automatically/i)))
    expect(buildUrls(fetchMock)).toHaveLength(0)
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

  // -------------------------------------------------------------------------
  // WHAT THE SCREEN SAYS WHILE THE QUEUE HAS THE PAGE.
  //
  // Declining to fire the creation prompt (above) was the whole of the guard,
  // and it left the editor saying the opposite of what the rail said. These
  // drive a REAL `writing -> done` transition against the real provider for the
  // reason this file's header gives: a mocked static `draftPhase` cannot see
  // the second half, and that is exactly where the guard was wrong once before.
  // -------------------------------------------------------------------------

  /** Holds the queue's build open until `release()`, then answers with `turn`. */
  function heldBuild(response: BuildTurnResponse = turn()) {
    let release: (() => void) | null = null
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init
      if (String(url).includes("/build")) {
        if (release === null) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return sseResponse([{ type: "result", turn: response }])
        }
        // Any LATER build — a second one would mean the guard failed.
        return sseResponse([{ type: "result", turn: response }])
      }
      return jsonResponse(200, {})
    })
    global.fetch = fetchMock as unknown as typeof fetch
    return { fetchMock, release: () => release?.() }
  }

  function openOnAQueuedStep(response: BuildTurnResponse = turn()) {
    const held = heldBuild(response)
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
    return held
  }

  it("says the page is being written, instead of inviting a competing build", async () => {
    // MUTANT: the guard alone, with nothing said on screen — which is what
    // shipped. With a null document this builder showed an empty transcript, an
    // ENABLED composer, and a blocker reading "There is no page yet. Describe
    // what you want in the chat first." — two inches from a rail badge saying
    // `writing…`. Taking that explicit invitation calls `send`, which opens a
    // SECOND build on the step the queue is writing; whichever loses the build
    // route's revision check loses, and if the queue loses then `runJob` paints
    // `draft failed` over a page that was written perfectly well. The
    // lying-status-badge defect this feature exists to remove, produced by the
    // feature itself.
    const { fetchMock } = openOnAQueuedStep()

    fireEvent.click(screen.getByText("queue this page"))
    await waitFor(() => expect(screen.getByTestId("phase-s1")).toHaveTextContent("writing"))
    fireEvent.click(screen.getByText("open the builder"))

    // 1. It SAYS so.
    expect(await screen.findByText(/being written for you/i)).toBeInTheDocument()
    // 2. The composer cannot be used to say it again.
    expect(composer()).toBeDisabled()
    // 3. And the gate is not carrying the sentence that told them to. That
    //    sentence is a blocker, so with it back the header grows a
    //    "Fix 1 blocker" button and the review behind it prints the copy.
    expect(screen.queryByRole("button", { name: /fix \d+ blocker/i })).toBeNull()

    // 4. THE STARTER CHIPS ARE GONE, not merely greyed.
    //    MUTANT: `startersHidden` dropped, leaving `composerDisabled` to dim
    //    them. The transcript is empty here, so `ChatPane`'s empty state
    //    renders — heading "What is this page for?", five chips — directly
    //    above a card saying the page is already being written and there is
    //    nothing to type. Disabled chips make that unclickable but leave the
    //    screen holding two answers to the same question, which is the
    //    contradiction this branch exists to remove. Asserted by ABSENCE
    //    (`queryBy`), because a `toBeDisabled` check passes on exactly the
    //    version being ruled out.
    expect(screen.queryByText(/what is this page for/i)).toBeNull()
    expect(screen.queryByRole("button", { name: /^(Landing|Opt-in|Sales|Thank-you|Waitlist)/ })).toBeNull()

    // Still exactly one build: the guard AND the disabled composer.
    expect(buildUrls(fetchMock as unknown as FetchMock)).toHaveLength(1)
  })

  it("fills the editor in when the queue's draft lands, rather than waiting for a reload", async () => {
    // MUTANT: the three items above without the adoption effect. `FunnelBuilder`
    // holds its own `doc`, seeded from `props.initialDoc` and only ever PUSHED
    // into the provider — so the card would promise a page that never arrives.
    // The rail goes `writing… → done` and the editor sits blank until someone
    // thinks to reload.
    //
    // A REAL PHASE TRANSITION, against the real provider. A mocked static
    // `draftPhase` cannot reach `done` at all, which is the mistake this file's
    // header records having already been made once on this branch.
    const { fetchMock, release } = openOnAQueuedStep()

    fireEvent.click(screen.getByText("queue this page"))
    await waitFor(() => expect(screen.getByTestId("phase-s1")).toHaveTextContent("writing"))
    fireEvent.click(screen.getByText("open the builder"))
    expect(await screen.findByText(/being written for you/i)).toBeInTheDocument()

    act(() => release())
    await waitFor(() => expect(screen.getByTestId("phase-s1")).toHaveTextContent("done"))

    // The turn's own reply is in the transcript, the card is gone, and the
    // composer is back — the editor is simply on a page that now exists.
    expect(await screen.findByText("Built the page.")).toBeInTheDocument()
    expect(screen.queryByText(/being written for you/i)).toBeNull()
    await waitFor(() => expect(composer()).toBeEnabled())
    expect(publishFunnelButton()).toBeEnabled()

    // MUTANT: adopting the DOCUMENT alone and leaving `revision` at the one the
    // server rendered. `applyTurn` is used precisely so the revision comes with
    // it: the queue's build moved this step from 5 to 6, so a builder still
    // holding 5 would 409 the owner's very first message against a page nobody
    // else had touched.
    typeMessage("make the headline shorter")
    clickSend()
    await waitFor(() => expect(buildUrls(fetchMock as unknown as FetchMock)).toHaveLength(2))
    expect(bodyOf(fetchMock as unknown as FetchMock, 1).revision).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// A LEGACY PAGE MUST NOT LOCK THE FUNNEL PUBLISH
// ---------------------------------------------------------------------------

describe("the funnel gate on a page the funnel route would skip", () => {
  /** A legacy GrapesJS step: unreadable draft, real compiled version, live. */
  const legacy = () =>
    baseProps({
      docInvalid: true,
      initialDoc: null,
      initialCompile: null,
      initialPublishedVersion: 3,
    })

  it("still offers the funnel publish from a legacy page", async () => {
    // MUTANT: `publishable = … && blockers.length === 0 && doc !== null` shared
    // by both controls, which is what shipped. On a legacy page `docInvalid` is
    // true, so `blockers` carries "This page's saved content is not something
    // the builder can read." and `doc` is null — making `canPublishFunnel`
    // permanently false with the tooltip "Publishing is blocked".
    //
    // The route would have published that funnel without complaint:
    // `funnelPublishPlan` (`publish-plan.ts:86`) SKIPS a doc-less step that
    // already carries a published version. So the builder was stricter than the
    // route, and the owner standing on a legacy page was told the funnel could
    // not go live and sent to another screen to do it — a small rebuild of the
    // two-screens complaint this branch exists to remove.
    const fetchMock = mockFetch({
      funnelPublish: () => ({ status: 200, body: { published: 2, pages: [], warnings: [] } }),
    })

    render(<FunnelBuilder {...legacy()} />)

    expect(publishFunnelButton()).toBeEnabled()
    fireEvent.click(publishFunnelButton())
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/funnels/f1/publish",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    // ...and nothing was rendered to send, because the funnel route reads the
    // STORED drafts. A legacy page has nothing this tab could render anyway.
    expect(renderForPublish).not.toHaveBeenCalled()
  })

  it("keeps the PAGE publish shut on that same legacy page, and says why", () => {
    // MUTANT: opening both halves. `publishThisPage` renders THIS tab's
    // document through `renderForPublish`, and on a legacy page there is no
    // document to render — the split button's two halves genuinely disagree
    // here, and the dropdown must stay shut.
    render(<FunnelBuilder {...legacy()} />)

    const menu = screen.getByRole("button", { name: /more publish options/i })
    expect(menu).toBeDisabled()
    // MUTANT: a bare disabled chevron. With this page's blocker out of the
    // funnel-scoped "Fix N blockers" count, nothing else on screen explains the
    // grey half — `silent_gate_reads_as_broken`, which this repo has shipped
    // before.
    expect(menu).toHaveAttribute("title", expect.stringMatching(/can't be published on its own/i))
  })

  it("still refuses the funnel publish on a page that has never been written at all", async () => {
    // MUTANT: dropping the `doc !== null || publishedVersion !== null` term
    // along with the blocker, i.e. letting the funnel button through on any
    // blank page. `funnelPublishPlan` calls a doc-less step with NO published
    // version a problem — "<name> has no content yet." — so the button would be
    // offering an act the route is certain to refuse.
    const fetchMock = mockFetch()

    render(
      <FunnelBuilder {...baseProps({ initialDoc: null, initialCompile: null, initialPublishedVersion: null })} />,
    )

    expect(publishFunnelButton()).toBeDisabled()
    fireEvent.click(publishFunnelButton())
    await act(async () => {
      await Promise.resolve()
    })
    expect(urlsOf(fetchMock)).not.toContain("/api/admin/funnels/f1/publish")
  })
})

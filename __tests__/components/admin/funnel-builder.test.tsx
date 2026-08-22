// __tests__/components/admin/funnel-builder.test.tsx — Stage 1.9's UI.
//
// EVERY TEST HERE NAMES THE MUTANT IT KILLS, because this repo's dominant
// defect class is tests that cannot fail — six instances in this feature alone.
// A test that renders the component and asserts a string exists somewhere kills
// nothing; the assertions below are chosen so that flipping one specific line
// of FunnelBuilder.tsx turns one of them red.
//
// The four behaviours under test are the four the earlier stages' reviews found
// missing from tools like this one:
//   1. `unresolved` blocks publish, and `compile.ok` must not be the gate.
//   2. `danglingAnchors` warn and never block.
//   3. `compile.warnings` are shown BEFORE the write, not toasted after it.
//   4. A 409 re-syncs and says so; it never silently overwrites.
//
// `fireEvent`, not `@testing-library/user-event`: that package is not a
// dependency of this repo and adding one is not in this stage's scope. Same
// deviation, same reason, as __tests__/components/admin/bookkeeping/
// DuplicateScanDialog.test.tsx:1-8.
//
// No fake timers anywhere: `shouldAdvanceTime` starves `waitFor`, which is
// documented in this repo as a trap, and nothing here needs a clock.

import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { FunnelBuilder, type FunnelBuilderProps } from "@/components/admin/funnels/FunnelBuilder"
import {
  MESSAGING_DOCK_INSET_PX,
  SM_BUTTON_HEIGHT_PX,
  clearsMessagingDock,
  tailwindBottomPaddingPx,
} from "@/components/messaging/dock-geometry"
import { encodeBuildStreamEvent, type BuildStreamEvent } from "@/lib/funnels/sections/build-stream"
import type {
  BuildTurnResponse,
  CompileSummary,
  DanglingAnchor,
  DiffReceipt,
  SectionDoc,
  UnresolvedCta,
} from "@/components/admin/funnels/builder/types"

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock("sonner", () => ({ toast }))

// next/navigation is globally mocked in __tests__/setup.tsx.

// Radix DropdownMenu relies on Pointer Events APIs jsdom doesn't ship. Without
// these, opening the split publish button's menu (one test below, for a
// funnelKind: "funnel" override) hangs — see
// __tests__/components/admin/content-studio/drawer/GenerateQuoteCardsButton.test.tsx.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// `primaryCta` IS REQUIRED BY `heroPropsSchema` AND WAS MISSING, so this
// fixture did not satisfy `sectionDocSchema` at all. Nothing in `FunnelBuilder`
// validates `initialDoc`, which is why it went unnoticed — and it is a landmine
// the moment a test hands the document to anything that does parse it (the
// funnel-wide publish tests mount the real `ConnectionsProvider`, which feeds
// `funnelConnections`). Fixed here rather than only in the copy, so the shape
// this file teaches by example is a legal one.
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

const UNRESOLVED: UnresolvedCta = {
  sectionId: "hero1",
  field: "primaryCta.target",
  ref: "Comeback Cod",
  kind: "program",
  reason: "no_match",
  candidates: [{ id: "prog-1", name: "Comeback Code" }],
}

const DANGLING: DanglingAnchor = {
  sectionId: "hero1",
  field: "primaryCta.target",
  target: "pricing",
}

const RECEIPT: DiffReceipt = {
  changed: [{ id: "hero1", kind: "hero", label: "Hero", action: "updated", reasons: ["headline size"] }],
  unchangedCount: 8,
  totalSections: 9,
  themeChanged: false,
  isRewrite: false,
}

function turn(overrides: Partial<BuildTurnResponse> = {}): BuildTurnResponse {
  return {
    revision: 6,
    doc: DOC,
    reply: "Made the headline shorter.",
    blocked: false,
    receipt: RECEIPT,
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
    funnelId: "funnel-1",
    funnelName: "Summer camp",
    stepId: "step-1",
    stepName: "Landing",
    publicUrl: "/go/summer-camp",
    previewUrl: "/preview/summer-camp",
    // Default to a LIVE funnel so the existing gate tests keep testing the
    // gate. A draft funnel is a legitimate thing to warn about, and it has its
    // own tests below — but it must not silently become the baseline, or every
    // assertion here would be measuring the draft banner instead.
    funnelStatus: "published",
    // Default to "page" rather than "funnel". Task 5 gave `funnelKind ===
    // "funnel"` its own primary action — a "Publish funnel" split button that
    // calls the FUNNEL-WIDE route — while `publishButton()` below and every
    // test in this file exercise the single-button PER-PAGE publish gate
    // (`publishThisPage`): unresolved CTAs, dangling anchors, compile
    // warnings, 409 conflicts, one-click publish. None of that depends on
    // `funnelKind` except the strip's noun, which already has its own explicit
    // `funnelKind: "page"` override below ("calls a landing page a landing
    // page, not a funnel") — so "page" here keeps every other assertion
    // testing exactly the mechanism its comment names, unchanged by the split
    // control. See __tests__/components/admin/funnel-publish-all.test.tsx for
    // the funnel-wide control itself.
    funnelKind: "page",
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

// ---------------------------------------------------------------------------
// The transport.
//
// The build route streams; publish and reset do not. These fakes are REAL
// `Response` objects rather than `{ok, status, json}` literals, because the
// component now branches on `Content-Type` and reads `response.body` through a
// stream reader — an object literal cannot exercise either, and one that
// happened to satisfy the old shape would let a broken reader pass.
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** An SSE body delivered whole — the turn is already over by the time it lands. */
function sseResponse(events: BuildStreamEvent[]): Response {
  return new Response(events.map(encodeBuildStreamEvent).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  })
}

/**
 * A stream the test holds OPEN, so it can assert what is on screen partway
 * through a turn.
 *
 * `sseResponse` above cannot do that: its body is complete before the component
 * reads a byte, so every event is consumed in one pass and the stage is gone by
 * the first assertion. Anything about the wireframe has to be observed mid-turn
 * or it is not being observed at all.
 */
function controlledStream() {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    }),
    push(event: BuildStreamEvent) {
      controller.enqueue(encoder.encode(encodeBuildStreamEvent(event)))
    },
    close() {
      controller.close()
    },
  }
}

/** A `section` event with the fields a test does not care about filled in. */
function sectionEvent(overrides: Partial<BuildStreamEvent & { section: unknown }>): BuildStreamEvent {
  return {
    type: "section",
    section: { key: "0:0", op: "set_page", kind: "hero", id: null, variant: null, headline: null },
    ...(overrides as object),
  } as BuildStreamEvent
}

/**
 * Routes by URL so a test can answer the build and publish routes differently.
 *
 * Handlers keep their original `{status, body}` contract and this decides how
 * to deliver it, so the existing call sites did not have to learn about
 * framing:
 *
 *  - publish, and any reset, stay JSON;
 *  - a NON-200 build stays JSON, because a pre-flight failure never opens a
 *    stream and must keep its real status;
 *  - a 200 build becomes a stream ending in `result`.
 *
 * `events` overrides all of that for the tests that are specifically about
 * progress or about a mid-stream failure.
 */
function mockFetch(handlers: {
  build?: () => { status: number; body: unknown }
  publish?: () => { status: number; body: unknown }
  events?: () => BuildStreamEvent[]
  /** A stream the test drives by hand — see `controlledStream`. */
  raw?: () => Response
}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/publish")) {
      const result = handlers.publish ? handlers.publish() : { status: 200, body: {} }
      return jsonResponse(result.status, result.body)
    }

    if (handlers.raw) return handlers.raw()
    if (handlers.events) return sseResponse(handlers.events())

    const result = handlers.build ? handlers.build() : { status: 200, body: turn() }

    const requestBody = init?.body ? (JSON.parse(init.body as string) as { action?: string }) : {}
    const isReset = requestBody.action === "reset"
    if (isReset || result.status !== 200) return jsonResponse(result.status, result.body)

    return sseResponse([{ type: "result", turn: result.body }])
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

/**
 * The review is no longer reached by clicking Publish — Publish publishes.
 * Warnings get their own quiet door ("N to check"); blockers keep theirs
 * ("Fix N blockers"). Both open the same review.
 */
function openReview() {
  const door =
    screen.queryByRole("button", { name: /\d+ to check/i }) ??
    screen.getByRole("button", { name: /fix \d+ blocker/i })
  fireEvent.click(door)
}

function publishButton() {
  return screen.getByRole("button", { name: /^publish$/i })
}

function composer() {
  return screen.getByLabelText(/describe the change/i)
}

function typeMessage(text: string) {
  fireEvent.change(composer(), { target: { value: text } })
}

function clickSend() {
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
}

function bodyOf(fetchMock: ReturnType<typeof mockFetch>, call: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[call][1] as unknown as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  renderForPublish.mockResolvedValue({
    ok: true,
    html: "<div></div>",
    css: "",
    problems: [],
    warnings: [],
  })
  mockFetch({})
})

// ---------------------------------------------------------------------------
// 1. `unresolved` blocks publish — and `compile.ok` is NOT the gate
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — the publish gate", () => {
  it("disables Publish while a CTA is unresolved, even though the page compiles perfectly clean", () => {
    // MUTANT KILLED: `canPublish = compile.ok` (or anything else derived from
    // the compiler). The compile summary handed in is `ok: true, warnings: []`
    // — exactly what a page full of disabled CTA placeholders produces — so a
    // gate reading the compiler would enable this button.
    render(<FunnelBuilder {...baseProps({ initialUnresolved: [UNRESOLVED], initialCompile: CLEAN_COMPILE })} />)

    expect(publishButton()).toBeDisabled()
    expect(screen.getByRole("button", { name: /fix 1 blocker/i })).toBeEnabled()
  })

  it("enables Publish when nothing is unresolved", () => {
    // MUTANT KILLED: a Publish button hardcoded disabled, which would make the
    // test above pass for the wrong reason.
    render(<FunnelBuilder {...baseProps()} />)
    expect(publishButton()).toBeEnabled()
  })

  it("enables Publish once a turn clears the unresolved CTA", async () => {
    // MUTANT KILLED: never adopting the response's `unresolved`, which would
    // leave publish blocked forever after one bad ref.
    mockFetch({ build: () => ({ status: 200, body: turn({ unresolved: [] }) }) })

    render(<FunnelBuilder {...baseProps({ initialUnresolved: [UNRESOLVED] })} />)
    expect(publishButton()).toBeDisabled()

    typeMessage("point it at Comeback Code")
    clickSend()

    await waitFor(() => expect(publishButton()).toBeEnabled())
  })

  it("keeps publish blocked when a turn reports that CTA links were NOT checked", async () => {
    // MUTANT KILLED: `setUnresolved(data.unresolved)` unconditionally. The
    // response below carries `unresolved: []` beside a non-null
    // `resolutionError` — which the route documents as "not checked", never
    // "all clear". Taking the empty list would silently unblock publish on a
    // page whose buy button still points at nothing.
    mockFetch({
      build: () => ({
        status: 200,
        body: turn({
          unresolved: [],
          resolutionError: "CTA links were not checked this turn: the catalogue could not be read.",
        }),
      }),
    })

    render(<FunnelBuilder {...baseProps({ initialUnresolved: [UNRESOLVED] })} />)
    typeMessage("tweak the copy")
    clickSend()

    await waitFor(() => expect(screen.getByText(/were not checked this turn/i)).toBeInTheDocument())
    expect(publishButton()).toBeDisabled()
  })

  it("keeps publish blocked when a turn produced no document at all", async () => {
    // MUTANT KILLED: adopting `unresolved` / `danglingAnchors` from a
    // `compile: null` response. The route returns those as empty PLACEHOLDERS
    // on the declined and both-attempts-failed paths, where the document did
    // not change — treating them as findings clears a real blocker.
    mockFetch({
      build: () => ({
        status: 200,
        body: turn({
          revision: 7,
          blocked: true,
          reply: "I can't write medical claims.",
          receipt: null,
          compile: null,
          unresolved: [],
        }),
      }),
    })

    render(<FunnelBuilder {...baseProps({ initialUnresolved: [UNRESOLVED] })} />)
    typeMessage("say it cures injuries")
    clickSend()

    await waitFor(() => expect(screen.getByText(/can't write medical claims/i)).toBeInTheDocument())
    expect(publishButton()).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// 2. `danglingAnchors` warn and never block
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — dangling anchors", () => {
  it("shows a dangling anchor in the review but leaves Publish enabled", () => {
    // MUTANT KILLED: folding `danglingAnchors` into the blocker set. A dead
    // in-page link is degraded, not lead-losing, and must never hold a
    // campaign page hostage — but it still has to be visible.
    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)

    expect(publishButton()).toBeEnabled()
    expect(screen.queryByRole("button", { name: /fix \d+ blocker/i })).not.toBeInTheDocument()

    openReview()
    expect(screen.getByText(/jumps to "#pricing"/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /publish now/i })).toBeEnabled()
  })
})

// ---------------------------------------------------------------------------
// 3. `compile.warnings` reach the PRE-publish review
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — the pre-publish review", () => {
  it("shows compiler warnings before anything is written, not after", () => {
    // MUTANT KILLED: FunnelEditor.tsx:182's shape — `toast.warning(...)` on
    // the publish SUCCESS path. The assertions that nothing has been rendered
    // or POSTed at this point are what make that mutant fail; without them a
    // post-publish toast would still satisfy "the warning is on screen".
    const fetchMock = mockFetch({})

    render(
      <FunnelBuilder
        {...baseProps({
          initialCompile: { ok: true, problems: [], warnings: ["A video embed was removed."] },
        })}
      />,
    )

    // STILL BEFORE THE WRITE. Publish now publishes on one click, so the
    // warning moved behind its own affordance rather than in front of the
    // publish button — but it is still reachable without writing anything,
    // which is the property this test exists for.
    openReview()

    expect(screen.getByText("A video embed was removed.")).toBeInTheDocument()
    expect(renderForPublish).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("routes a 422 from publish back into the chat behind Fix it for me", async () => {
    // MUTANT KILLED: `toast.error(problems[0])` — a dead-end toast in a chat
    // builder, where the one thing that can fix the problem is the chat.
    const fetchMock = mockFetch({
      publish: () => ({
        status: 422,
        body: { error: "This page could not be published.", problems: ["The page HTML is too large."] },
      }),
      build: () => ({ status: 200, body: turn({ revision: 6 }) }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    // ONE CLICK. A clean page with a live funnel publishes straight from the
    // header button now; there is no review to pass through.
    fireEvent.click(publishButton())

    await waitFor(() => expect(screen.getByText("The page HTML is too large.")).toBeInTheDocument())

    // MUTANT KILLED: `reportRefusal(...)` on this branch WITHOUT
    // `setServerBlockers(...)` — which is what shipped. `reportRefusal`'s own
    // comment says "callers ALSO set `serverBlockers`, which is what keeps the
    // gate shut", and the server-action refusal path does exactly that; this
    // branch did not, so the route refused a publish and the button that
    // triggered it stayed enabled, ready to spend another round trip on the
    // same refusal.
    expect(publishButton()).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: /fix it for me/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(fetchMock.mock.calls[1][0]).toContain("/build")
    expect(String(bodyOf(fetchMock, 1).message)).toContain("The page HTML is too large.")
  })

  it("surfaces the server-side publish gate's refusal as blockers rather than publishing", async () => {
    // MUTANT KILLED: ignoring `renderForPublish`'s `ok: false` and POSTing
    // anyway — the client's `unresolved` is a cache, and the action re-resolves
    // against a live catalogue at the moment of publish.
    const fetchMock = mockFetch({})
    renderForPublish.mockResolvedValue({
      ok: false,
      blockers: ['The program "Comeback Code" no longer exists.'],
      warnings: [],
    })

    render(<FunnelBuilder {...baseProps()} />)
    // ONE CLICK. A clean page with a live funnel publishes straight from the
    // header button now; there is no review to pass through.
    fireEvent.click(publishButton())

    await waitFor(() => expect(screen.getByText('The program "Comeback Code" no longer exists.')).toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("gives the server gate's refusal the same Fix it for me the 422 gets", async () => {
    // MUTANT KILLED: `setServerBlockers(rendered.blockers)` on its own — the
    // refusal as an inert bullet list. It is the same class of problem as the
    // route's 422 (something the AI wrote that the AI can rewrite: a page over
    // the size cap, a CTA pointing at a deleted program), so one path having a
    // fix button and the other being a dead end is a coin flip for the owner.
    const fetchMock = mockFetch({ build: () => ({ status: 200, body: turn({ revision: 6 }) }) })
    renderForPublish.mockResolvedValue({
      ok: false,
      blockers: ['The program "Comeback Code" no longer exists.'],
      warnings: [],
    })

    render(<FunnelBuilder {...baseProps()} />)
    // ONE CLICK. A clean page with a live funnel publishes straight from the
    // header button now; there is no review to pass through.
    fireEvent.click(publishButton())

    await waitFor(() => expect(screen.getByRole("button", { name: /fix it for me/i })).toBeInTheDocument())
    // MUTANT KILLED: routing the refusal into the chat and forgetting to keep
    // `serverBlockers` — the fix affordance must not double as an unblock.
    expect(publishButton()).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: /fix it for me/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(fetchMock.mock.calls[0][0]).toContain("/build")
    expect(String(bodyOf(fetchMock, 0).message)).toContain('The program "Comeback Code" no longer exists.')
  })

  it("reports what the compiler removed in a strip that stays, never a toast", async () => {
    // MUTANT KILLED: `for (const w of warnings) toast.warning(w)` after a
    // successful publish. `toast.warning` must not be called at all.
    mockFetch({
      publish: () => ({ status: 200, body: { version: 3, warnings: ["An <iframe> was removed."] } }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    // ONE CLICK. A clean page with a live funnel publishes straight from the
    // header button now; there is no review to pass through.
    fireEvent.click(publishButton())

    await waitFor(() => expect(screen.getByText(/published version 3/i)).toBeInTheDocument())
    expect(screen.getByText("An <iframe> was removed.")).toBeInTheDocument()
    expect(toast.warning).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The publish affordance has to be CLICKABLE, not just enabled
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — the publish button and the global Messages dock", () => {
  it("reserves clearance so Publish now is not under the fixed dock at any breakpoint", () => {
    // THE BUG THIS PINS WAS FOUND IN A BROWSER, NOT HERE. Measured in Chromium
    // at 1600x1000: "Publish now" at x1460 y956 124x32, the global Messages
    // dock at x1457 y940 127x44, and `document.elementFromPoint` at the
    // button's own centre returning the DOCK. The button rendered, reported
    // enabled, and satisfied every other test in this file — a human could not
    // click it. jsdom has no layout engine, so no amount of rendering here can
    // observe that; the geometry is therefore a VALUE both sides read
    // (components/messaging/dock-geometry.ts) and this asserts the derivation.
    //
    // MUTANT KILLED: dropping `MESSAGING_DOCK_CLEARANCE_CLASS` from the review
    // footer, i.e. the `py-3` that shipped. The final assertion runs the
    // predicate against that exact string to prove it discriminates rather
    // than returning `true` for everything.
    // A dangling anchor is a WARNING, so it opens the review without blocking
    // publish — which is exactly the state this test needs to inspect.
    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)
    openReview()

    const footer = screen.getByRole("button", { name: /publish now/i }).closest("div")
    expect(footer).not.toBeNull()
    const classes = (footer as HTMLElement).className

    for (const scope of ["base", "lg"] as const) {
      expect(clearsMessagingDock(tailwindBottomPaddingPx(classes, scope), SM_BUTTON_HEIGHT_PX, scope)).toBe(true)
    }

    expect(clearsMessagingDock(tailwindBottomPaddingPx("px-4 py-3", "lg"), SM_BUTTON_HEIGHT_PX, "lg")).toBe(false)
  })

  it("keeps the dock's own footprint constants honest against MessagingDock.tsx", () => {
    // MUTANT KILLED: repositioning the dock (or restyling it) without updating
    // `MESSAGING_DOCK_INSET_PX`. The clearance above is derived from those two
    // numbers, so a dock that moved down while they stayed put would swallow
    // the publish button again with this whole file still green. Reading the
    // component's source is the only link available: the class string is a
    // Tailwind literal, and jsdom cannot resolve it to a box.
    const source = fs.readFileSync(path.join(process.cwd(), "components/messaging/MessagingDock.tsx"), "utf8")
    expect(source).toContain(`bottom-${MESSAGING_DOCK_INSET_PX.base / 4} `)
    expect(source).toContain(`lg:bottom-${MESSAGING_DOCK_INSET_PX.lg / 4}`)
    expect(source).toContain("fixed")
  })
})

// ---------------------------------------------------------------------------
// 4. A 409 means someone else moved
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — a concurrent writer", () => {
  it("re-syncs to the server's revision, says so, blocks publish, and keeps the message", async () => {
    // MUTANT KILLED (three of them): retrying the request with the new
    // revision (a silent overwrite of the other tab's work); dropping the
    // owner's typed message on the floor; and leaving Publish enabled, which
    // would push this tab's now-stale document over theirs.
    const fetchMock = mockFetch({
      build: () => ({
        status: 409,
        body: {
          error: "Someone else changed this page while you were working on it.",
          code: "stale_revision",
          currentRevision: 9,
        },
      }),
    })

    render(<FunnelBuilder {...baseProps({ initialRevision: 5 })} />)
    typeMessage("shorten the headline")
    clickSend()

    await waitFor(() => expect(screen.getByText(/someone else changed this page/i)).toBeInTheDocument())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock, 0).revision).toBe(5)
    expect(publishButton()).toBeDisabled()
    expect(composer()).toHaveValue("shorten the headline")
  })

  it("sends the NEXT turn against the revision the 409 reported", async () => {
    // MUTANT KILLED: showing the notice but never storing `currentRevision`,
    // which leaves the owner in a 409 loop that no amount of retrying escapes.
    let calls = 0
    const fetchMock = mockFetch({
      build: () => {
        calls += 1
        return calls === 1
          ? { status: 409, body: { code: "stale_revision", currentRevision: 9, error: "stale" } }
          : { status: 200, body: turn({ revision: 10 }) }
      },
    })

    render(<FunnelBuilder {...baseProps({ initialRevision: 5 })} />)
    typeMessage("shorten the headline")
    clickSend()
    await waitFor(() => expect(screen.getByText(/someone else changed this page/i)).toBeInTheDocument())

    clickSend()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(bodyOf(fetchMock, 1).revision).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// The diff receipt
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — the diff receipt", () => {
  it("prints what changed AND how much was left alone", async () => {
    // MUTANT KILLED: printing only `changed`. The untouched count is the half
    // that answers the owner's actual question — "did it quietly rewrite my
    // page?" — and it is the half a naive receipt drops.
    mockFetch({ build: () => ({ status: 200, body: turn() }) })

    render(<FunnelBuilder {...baseProps()} />)
    typeMessage("shorten the headline")
    clickSend()

    await waitFor(() =>
      expect(screen.getByText(/Changed: Hero \(headline size\)\. Untouched: 8 sections\./)).toBeInTheDocument(),
    )
  })

  it("labels a rewrite as a rewrite", async () => {
    // MUTANT KILLED: ignoring `receipt.isRewrite`, which is the difference
    // between "it edited my hero" and "it replaced my page".
    mockFetch({
      build: () => ({
        status: 200,
        body: turn({ receipt: { ...RECEIPT, isRewrite: true, unchangedCount: 0 } }),
      }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    typeMessage("start again")
    clickSend()

    await waitFor(() => expect(screen.getByText(/rewrote most of the page/i)).toBeInTheDocument())
  })
})

// ---------------------------------------------------------------------------
// The unreadable document, and the way back out of it
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — an unreadable document", () => {
  it("offers the reset recovery and POSTs the reset action", async () => {
    // MUTANT KILLED: no recovery UI at all. `applyOps` rejects an invalid
    // document before it inspects a single op, so chat cannot repair one — an
    // owner whose page reaches this state with no reset button has NO way out.
    const fetchMock = mockFetch({
      build: () => ({ status: 200, body: turn({ revision: 8, source: "revert", receipt: null }) }),
    })

    render(
      <FunnelBuilder
        {...baseProps({ docInvalid: true, resetToRevision: 4, initialDoc: null, initialCompile: null })}
      />,
    )

    expect(screen.getByText(/this page can't be opened/i)).toBeInTheDocument()
    expect(composer()).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: /restore step 4/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(bodyOf(fetchMock, 0)).toEqual({ action: "reset", toRevision: 4 })
    await waitFor(() => expect(screen.queryByText(/this page can't be opened/i)).not.toBeInTheDocument())
  })

  it("says so plainly when there is no earlier version to restore", () => {
    // MUTANT KILLED: rendering a "Restore step null" button, which POSTs a
    // body the validator rejects and tells the owner nothing.
    render(
      <FunnelBuilder
        {...baseProps({ docInvalid: true, resetToRevision: null, initialDoc: null, initialCompile: null })}
      />,
    )
    expect(screen.getByText(/no earlier version to restore/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /restore step/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The empty state
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — the empty state", () => {
  it("offers five starter chips and sends the chip verbatim", async () => {
    // MUTANT KILLED: chips that only prefill the composer. For a non-engineer
    // facing an empty page this is the highest-leverage surface in the feature,
    // and a chip that needs a second click to do anything is a label.
    const fetchMock = mockFetch({ build: () => ({ status: 200, body: turn() }) })

    render(<FunnelBuilder {...baseProps({ initialDoc: null, initialCompile: null, initialMessages: [] })} />)

    expect(screen.getAllByRole("button", { name: /^(Landing|Opt-in|Sales|Thank-you|Waitlist)/ })).toHaveLength(5)

    fireEvent.click(screen.getByRole("button", { name: "Landing page for a summer camp" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(bodyOf(fetchMock, 0).message).toBe("Landing page for a summer camp")
  })
})

// ---------------------------------------------------------------------------
// The preview across a review round-trip
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — the preview across a review round-trip", () => {
  function draftFrame(container: HTMLElement): HTMLIFrameElement {
    const frame = container.querySelector<HTMLIFrameElement>('iframe[title="Draft preview of this page"]')
    expect(frame).not.toBeNull()
    return frame as HTMLIFrameElement
  }
  /**
   * The COLUMN, which is what carries the show/hide classes — the pane itself
   * now fills it absolutely so the generation stage can be laid over it.
   *
   * Found by its testid rather than by counting `parentElement` hops: the walk
   * this used to do (iframe -> box -> pane) broke silently the moment a wrapper
   * appeared, and it broke into reading SOME element's className, not into an
   * error.
   */
  function paneClasses(frame: HTMLIFrameElement): string {
    return frame.closest<HTMLElement>('[data-testid="preview-column"]')?.className ?? ""
  }

  it("hides the draft preview for the review instead of unmounting it", () => {
    // MUTANT KILLED: `mode === "review" ? <PublishReview/> : <PreviewPane/>`.
    // The ternary tears the preview down on the way into the review and mounts
    // a fresh one on the way out, so the draft document is fetched and
    // re-compiled twice per round trip and the owner is returned to the top of
    // the page — the exact defect PreviewPane's double buffer exists to
    // prevent, reintroduced one level up. The element identity check is what
    // kills it: a remount is a different node.
    // Needs the review to actually open, so give it something to report.
    const { container } = render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)
    const before = draftFrame(container)
    expect(paneClasses(before)).toContain("lg:block")
    openReview()
    expect(screen.getByRole("button", { name: /publish now/i })).toBeInTheDocument()

    expect(draftFrame(container)).toBe(before)
    // MUTANT KILLED: hiding it with `hidden` while leaving `lg:block` attached,
    // which loses on precedence at exactly the width the review is open at, so
    // the review and the preview would fight over the same column.
    expect(paneClasses(draftFrame(container))).not.toContain("lg:block")

    fireEvent.click(screen.getByRole("button", { name: /back to editing/i }))

    expect(draftFrame(container)).toBe(before)
    expect(paneClasses(draftFrame(container))).toContain("lg:block")
  })
})

// ---------------------------------------------------------------------------
// Message identity
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — message keys", () => {
  it("keeps two turns apart when the route reports the same revision twice", async () => {
    // MUTANT KILLED: `id: `rev-${data.revision}``. A FAILED turn falls back to
    // the revision the owner's message already got (build/route.ts:824), so two
    // builder messages can carry the same number — and React given two children
    // with the same key warns and reconciles by dropping or duplicating one.
    // The console assertion is the one that fails on the mutant; the two text
    // assertions are what say why it matters.
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    try {
      let calls = 0
      mockFetch({
        build: () => {
          calls += 1
          return {
            status: 200,
            body: turn({ revision: 6, reply: calls === 1 ? "First answer." : "Second answer." }),
          }
        },
      })

      render(<FunnelBuilder {...baseProps()} />)
      typeMessage("shorten the headline")
      clickSend()
      await waitFor(() => expect(screen.getByText("First answer.")).toBeInTheDocument())

      typeMessage("now make it louder")
      clickSend()
      await waitFor(() => expect(screen.getByText("Second answer.")).toBeInTheDocument())

      expect(screen.getByText("First answer.")).toBeInTheDocument()
      expect(errors.flat().join(" ")).not.toMatch(/same key/i)
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// The unresolved-CTA picker
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — the unresolved CTA picker", () => {
  it("offers only real candidate rows and turns a pick into a build turn", async () => {
    // MUTANT KILLED: a findings list with no reachable fix. A blocker whose
    // fix lives somewhere the owner cannot get to from the blocker is
    // unclearable, which is worse than not reporting it.
    const fetchMock = mockFetch({ build: () => ({ status: 200, body: turn({ revision: 6 }) }) })

    render(<FunnelBuilder {...baseProps({ initialUnresolved: [UNRESOLVED] })} />)
    fireEvent.click(screen.getByRole("button", { name: /fix 1 blocker/i }))

    expect(screen.getByText(/points at "Comeback Cod"/)).toBeInTheDocument()

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Comeback Code" } })
    fireEvent.click(screen.getByRole("button", { name: /use this/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = bodyOf(fetchMock, 0)
    expect(String(body.message)).toContain('"kind":"program","ref":"Comeback Code"')
    expect(String(body.message)).toContain("hero1")
  })
})

// ---------------------------------------------------------------------------
// One click when there is nothing to review — and a review when there is.
//
// The owner's complaint: "there is two publish, and also a publish now — I want
// it to publish now immediately". Two separate defects sat behind that. The
// header button had no `mode === "review"` guard, so BOTH publish affordances
// were on screen at once and the header one was a no-op that only re-entered
// the mode it was already in. And publish was unconditionally two clicks, even
// on a page whose own review said "Nothing is blocking this page".
//
// The review is NOT removed: warnings must be seen BEFORE the write, because
// the previous editor showed them after and they faded away over a page that
// was already live. So silence earns one click; anything worth saying earns
// the review.
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — one click when there is nothing to say", () => {
  it("publishes on a SINGLE click when nothing needs reviewing", async () => {
    // MUTANT KILLED: the shipped `onClick={() => { setMode("review") }}` with no
    // branch — i.e. always two clicks. Under that, no publish request is made
    // by this point and the assertion below fails.
    const fetchMock = mockFetch({
      publish: () => ({ status: 200, body: { version: 4, warnings: [] } }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(publishButton())

    await waitFor(() => expect(screen.getByText(/published version 4/i)).toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/publish"))).toBe(true)
    // And it went straight there — the review never rendered.
    expect(screen.queryByRole("button", { name: /publish now/i })).not.toBeInTheDocument()
  })

  it("publishes on ONE CLICK even when there are warnings", async () => {
    // THIS REVERSES AN EARLIER RULE, ON THE OWNER'S INSTRUCTION: "theres
    // another publish now, i dont want that if i click the publish it should
    // publish now."
    //
    // The old rule sent every publish through a confirmation whenever there was
    // anything to report. In practice that was every page, because a funnel
    // that has not been taken live yet counts — i.e. every new one. Publish now
    // means publish; the warnings keep a door of their own, and the result
    // strip that reports them afterwards does not fade.
    const fetchMock = mockFetch({
      publish: () => ({ status: 200, body: { version: 4, warnings: [] } }),
    })

    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)
    fireEvent.click(publishButton())

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/publish"))).toBe(true),
    )
    expect(screen.queryByRole("button", { name: /publish now/i })).not.toBeInTheDocument()
  })

  it("still shows warnings BEFORE the write, behind their own door", () => {
    // MUTANT KILLED: dropping the advisory affordance along with the
    // confirmation. The review was the ONLY home these had — without a way in
    // that does not write, a dangling anchor becomes invisible until after the
    // page is live, which is worse than the friction that was removed.
    const fetchMock = mockFetch({})
    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)

    openReview()

    expect(screen.getByText(/jumps to "#pricing"/i)).toBeInTheDocument()
    expect(renderForPublish).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows only ONE publish affordance at a time — the header button is gone in review", () => {
    // MUTANT KILLED: the shipped header button with no `mode === "review"`
    // guard. Under that, "Publish" and "Publish now" are both on screen and
    // the header one does nothing but re-enter review.
    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)
    openReview()

    expect(screen.getByRole("button", { name: /publish now/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Publishing a PAGE does not take the FUNNEL live.
//
// The owner published a page on production, was told "Published version 1",
// and got a 404 at the public URL — because `funnels.status` was still 'draft'
// and the public route serves only published funnels. Nothing in the builder
// mentioned it. That is this repo's `silent_gate_reads_as_broken` pattern: a
// gate that hides its control reads as broken.
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — a funnel that is still a draft", () => {
  it("says so AFTER publishing, in a strip that does not fade, with the fix on it", async () => {
    // THE FAILURE THIS PINS IS REAL AND HAPPENED ON PRODUCTION: page published,
    // "Published version 1" reported, and a 404 at the public URL, because
    // `funnels.status` was still draft and the public route serves only
    // published funnels.
    //
    // It used to be reported BEFORE the write, in a confirmation. That
    // confirmation is gone on the owner's instruction — but the notice is not,
    // because losing it is how the 404 happened in the first place. It moved to
    // the publish RESULT strip, which is persistent (not a toast) and now
    // carries the link that fixes it.
    //
    // MUTANT KILLED: dropping the notice along with the confirmation.
    //
    // funnelKind: "funnel" HERE ON PURPOSE — this describe block is about a
    // FUNNEL, and the href assertion below is what proves it (a landing page
    // gets `/admin/pages`, see the sibling test just below). Task 5 gave
    // funnelKind: "funnel" a split "Publish funnel" primary action that always
    // reports `notLive: false` (a funnel-wide publish takes the funnel row
    // live as part of the same write, so there is nothing left to say) — so
    // the single-page publish this test is actually about now lives behind
    // the menu, as "Publish this page only".
    mockFetch({ publish: () => ({ status: 200, body: { version: 4, warnings: [] } }) })
    render(<FunnelBuilder {...baseProps({ funnelStatus: "draft", funnelKind: "funnel" })} />)

    const menuTrigger = screen.getByRole("button", { name: /more publish options/i })
    fireEvent.pointerDown(menuTrigger, { button: 0 })
    fireEvent.pointerUp(menuTrigger, { button: 0 })
    fireEvent.click(menuTrigger)
    fireEvent.click(await screen.findByRole("menuitem", { name: /publish this page only/i }))

    expect(await screen.findByText(/still a draft/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /take it live/i })).toHaveAttribute(
      "href",
      "/admin/funnels/funnel-1",
    )
  })

  it("calls a landing page a landing page, not a funnel", async () => {
    // The owner, on his own landing page: "it still says its not a funnel yet
    // which isnt true its different". Same row, same editor, different noun —
    // and the noun is the whole of what he sees.
    mockFetch({ publish: () => ({ status: 200, body: { version: 4, warnings: [] } }) })
    render(<FunnelBuilder {...baseProps({ funnelStatus: "draft", funnelKind: "page" })} />)

    fireEvent.click(publishButton())

    expect(await screen.findByText(/this landing page is still a draft/i)).toBeInTheDocument()
  })

  it("publishes a draft funnel on one click rather than interposing", async () => {
    // MUTANT KILLED: putting `funnelIsDraft` back into the pre-publish gate.
    // It is true for every funnel nobody has taken live yet — i.e. every new
    // one — so it made the second click universal, which is the complaint.
    const fetchMock = mockFetch({
      publish: () => ({ status: 200, body: { version: 4, warnings: [] } }),
    })

    render(<FunnelBuilder {...baseProps({ funnelStatus: "draft" })} />)
    fireEvent.click(publishButton())

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/publish"))).toBe(true),
    )
    expect(screen.queryByRole("button", { name: /publish now/i })).not.toBeInTheDocument()
  })

  it("says nothing about drafts when the funnel is live", async () => {
    // MUTANT KILLED: `funnelIsDraft = true` unconditionally, which would make
    // the two tests above pass for the wrong reason and nag on every publish.
    mockFetch({ publish: () => ({ status: 200, body: { version: 4, warnings: [] } }) })
    render(<FunnelBuilder {...baseProps({ initialDanglingAnchors: [DANGLING] })} />)
    fireEvent.click(publishButton())

    expect(await screen.findByText(/published version 4/i)).toBeInTheDocument()
    expect(screen.queryByText(/still a draft/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The generation stage
//
// What the owner watches for the ~30 seconds a turn takes. The claim is that
// every block on screen came out of the stream, so each test drives the stream
// by hand and asserts against what it pushed.
// ---------------------------------------------------------------------------

describe("FunnelBuilder — watching the page get written", () => {
  it("draws a block per streamed section, captioned with the model's own headline", async () => {
    // MUTANT: rendering a fixed skeleton, or captioning blocks with the section
    // KIND instead of the copy. Either would look identical on a happy path and
    // would be showing the owner something the model never wrote.
    const stream = controlledStream()
    const fetchMock = mockFetch({ raw: () => stream.response })

    render(<FunnelBuilder {...baseProps()} />)
    typeMessage("waitlist page")
    clickSend()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    stream.push({ type: "phase", phase: "writing" })
    stream.push(
      sectionEvent({
        section: {
          key: "0:0",
          op: "set_page",
          kind: "hero",
          id: null,
          variant: null,
          headline: "Six athletes, one coach",
        },
      }),
    )
    expect(await screen.findByText("Six athletes, one coach")).toBeInTheDocument()

    stream.push(
      sectionEvent({
        section: { key: "0:1", op: "set_page", kind: "form", id: null, variant: null, headline: "Get on the waitlist" },
      }),
    )
    expect(await screen.findByText("Get on the waitlist")).toBeInTheDocument()

    // And it is gone once the turn lands — the stage is transient, the receipt
    // is what persists.
    stream.push({ type: "result", turn: turn({ revision: 6 }) })
    stream.close()
    await waitFor(() => expect(screen.queryByText("Six athletes, one coach")).not.toBeInTheDocument())
  })

  it("clears the drawn sections on a retry instead of appending to them", async () => {
    // MUTANT: ignoring `restart`. Attempt 2 rewrites the same page, so its
    // sections would pile on top of attempt 1's and the owner would watch a
    // 2-section page grow into 4 sections that do not exist.
    const stream = controlledStream()
    const fetchMock = mockFetch({ raw: () => stream.response })

    render(<FunnelBuilder {...baseProps()} />)
    typeMessage("waitlist page")
    clickSend()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    stream.push(
      sectionEvent({
        section: { key: "0:0", op: "set_page", kind: "hero", id: null, variant: null, headline: "First attempt hero" },
      }),
    )
    expect(await screen.findByText("First attempt hero")).toBeInTheDocument()

    stream.push({ type: "restart", attempt: 2 })
    await waitFor(() => expect(screen.queryByText("First attempt hero")).not.toBeInTheDocument())
    expect(screen.getByText(/second attempt/i)).toBeInTheDocument()

    stream.push(
      sectionEvent({
        section: { key: "0:0", op: "set_page", kind: "hero", id: null, variant: null, headline: "Second attempt hero" },
      }),
    )
    expect(await screen.findByText("Second attempt hero")).toBeInTheDocument()

    stream.push({ type: "result", turn: turn({ revision: 6 }) })
    stream.close()
    // AWAITED, not just closed. The reader's loop resolves after the body ends
    // and sets `busy`/`stream` on the way out, so a test that returned here
    // left React updating an unmounted-in-a-moment tree outside `act` — a real
    // warning about a real unobserved state change, not noise. Asserting the
    // stage is gone is the cheapest way to wait for exactly that.
    await waitFor(() => expect(screen.queryByTestId("build-stage")).not.toBeInTheDocument())
  })

  it("marks the running token count as an estimate and drops the tilde when it is exact", async () => {
    // MUTANT: rendering both the same. The live figure is a count of delta
    // events, not the provider's number, and presenting it as measured on a
    // display whose whole point is honesty about the real work is precisely
    // the wrong trade.
    const stream = controlledStream()
    const fetchMock = mockFetch({ raw: () => stream.response })

    render(<FunnelBuilder {...baseProps()} />)
    typeMessage("hi")
    clickSend()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    stream.push({ type: "usage", outputTokens: 1840, exact: false })
    expect(await screen.findByText(/~1,840 tokens/)).toBeInTheDocument()

    stream.push({ type: "usage", outputTokens: 1912, exact: true })
    expect(await screen.findByText(/^1,912 tokens/)).toBeInTheDocument()

    stream.push({ type: "result", turn: turn({ revision: 6 }) })
    stream.close()
    // AWAITED, not just closed. The reader's loop resolves after the body ends
    // and sets `busy`/`stream` on the way out, so a test that returned here
    // left React updating an unmounted-in-a-moment tree outside `act` — a real
    // warning about a real unobserved state change, not noise. Asserting the
    // stage is gone is the cheapest way to wait for exactly that.
    await waitFor(() => expect(screen.queryByTestId("build-stage")).not.toBeInTheDocument())
  })

  it("routes a mid-stream 409 through the same resync as an HTTP 409", async () => {
    // MUTANT: treating `fail` as a generic error toast. The compare-and-swap
    // can be lost AFTER the stream opens, and that failure has to reach the
    // same handler — otherwise the tab keeps its stale revision and the next
    // turn races again, which is the exact bug the lock exists to prevent.
    const fetchMock = mockFetch({
      events: () => [
        {
          type: "fail",
          status: 409,
          body: {
            error: "Someone else changed this page while you were working on it. Reload and try again.",
            code: "stale_revision",
            currentRevision: 11,
          },
        },
      ],
    })

    render(<FunnelBuilder {...baseProps()} />)
    typeMessage("hi")
    clickSend()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(await screen.findByText(/someone else changed this page/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /reload the latest version/i })).toBeInTheDocument()
  })

  it("never reports a stream that ended with no result as success", async () => {
    // MUTANT: defaulting a terminal-less stream to `{}` or to the last known
    // turn. A dropped connection would then look exactly like a successful
    // turn that changed nothing, and the owner's message would vanish from the
    // composer with no page to show for it.
    const stream = controlledStream()
    const fetchMock = mockFetch({ raw: () => stream.response })

    render(<FunnelBuilder {...baseProps()} />)
    typeMessage("build me a waitlist page")
    clickSend()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    stream.push({ type: "phase", phase: "writing" })
    stream.close()

    // The message goes back in the composer — the honest mirror of "we do not
    // know whether that saved".
    await waitFor(() => expect(composer()).toHaveValue("build me a waitlist page"))
  })
})

// ---------------------------------------------------------------------------
// Where the turn in flight is DRAWN
//
// The wireframe is a stand-in for the page, so it belongs in the space the page
// appears in — which on a first build is the space that otherwise reads
// "Nothing to preview yet" for the whole thirty seconds. It used to be wedged
// into the 340px transcript, where every arriving section shoved the
// conversation around.
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — the stage is over the preview, not in the chat", () => {
  it("draws the streamed sections in the preview column while the chat keeps a one-line heartbeat", async () => {
    // MUTANT KILLED: handing the stage back to `ChatPane` via its `stage` prop.
    // Both places render the same component and the same text, so a test that
    // only asked "is the headline on screen" (which every other test in this
    // file does) passes either way — the ANCESTRY is the whole claim.
    const stream = controlledStream()
    const fetchMock = mockFetch({ raw: () => stream.response })

    // A page with no document yet: the case the owner was looking at, where
    // the preview column has nothing else in it.
    const { container } = render(
      <FunnelBuilder {...baseProps({ initialDoc: null, initialCompile: null, initialMessages: [] })} />,
    )
    typeMessage("waitlist page")
    clickSend()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    stream.push(
      sectionEvent({
        section: { key: "0:0", op: "set_page", kind: "hero", id: null, variant: null, headline: "Six athletes, one coach" },
      }),
    )
    const headline = await screen.findByText("Six athletes, one coach")

    const column = container.querySelector<HTMLElement>('[data-testid="preview-column"]')
    expect(column).not.toBeNull()
    expect(column?.contains(headline)).toBe(true)
    // And the column really is the preview column rather than some ancestor of
    // the whole builder — without this the assertion above would hold even if
    // the stage had never moved.
    expect(column?.contains(composer())).toBe(false)

    // The chat still says something is happening. Losing that would trade one
    // silence for another: below `lg` the two are tabs, and a transcript that
    // goes completely quiet for thirty seconds is what the stage was built for.
    expect(screen.getByText(/working on it/i)).toBeInTheDocument()

    stream.push({ type: "result", turn: turn({ revision: 6 }) })
    stream.close()
    // AWAITED, not just closed. The reader's loop resolves after the body ends
    // and sets `busy`/`stream` on the way out, so a test that returned here
    // left React updating an unmounted-in-a-moment tree outside `act` — a real
    // warning about a real unobserved state change, not noise. Asserting the
    // stage is gone is the cheapest way to wait for exactly that.
    await waitFor(() => expect(screen.queryByTestId("build-stage")).not.toBeInTheDocument())
  })
})

// ---------------------------------------------------------------------------
// Publishing the same page twice
//
// "when i publish there is no version showing then the publish button is still
// available that its confusing, it should be activated again once there are
// changes" — the strip said "Published version 1" and the button beside it sat
// there enabled, so the only available reading was "that did not take".
// ---------------------------------------------------------------------------

describe("<FunnelBuilder> — Publish after a publish", () => {
  it("stops offering Publish once the live page IS this page, and offers it again after a change", async () => {
    // MUTANT KILLED (two): leaving `canPublish` alone after a publish, which is
    // the reported bug; and gating on "has ever been published" instead of on
    // the revision, which would leave the button dead for the rest of the
    // session no matter what the owner changed. The last assertion is the one
    // that separates them.
    const fetchMock = mockFetch({
      publish: () => ({ status: 200, body: { version: 3, warnings: [] } }),
      build: () => ({ status: 200, body: turn({ revision: 6 }) }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    expect(publishButton()).toBeEnabled()

    fireEvent.click(publishButton())
    await waitFor(() => expect(screen.getByText(/published version 3/i)).toBeInTheDocument())

    // Not "Publish, greyed out" — that reads as a publish that failed. The
    // button says what happened, and the header says what is live.
    expect(screen.queryByRole("button", { name: /^publish$/i })).toBeNull()
    expect(screen.getByRole("button", { name: /^published$/i })).toBeDisabled()
    expect(screen.getByText(/v3 live/i)).toBeInTheDocument()

    // A turn moves the revision past the published one, so there is something
    // to publish again.
    typeMessage("make the headline shorter")
    clickSend()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(publishButton()).toBeEnabled())
  })

  it("names the live version on load but keeps Publish armed, because nothing here proves the draft matches it", () => {
    // MUTANT KILLED: seeding `publishedRevision` from `initialRevision` when a
    // version exists. That would disable Publish on every page the owner opens
    // that has ever been published — including one whose draft has moved on
    // since — and the failure direction is "cannot publish my changes", which
    // is far worse than an extra identical version row. `getVersionNumber`
    // carries the reasoning; this pins the behaviour.
    render(<FunnelBuilder {...baseProps({ initialPublishedVersion: 2 })} />)

    expect(screen.getByText(/v2 live/i)).toBeInTheDocument()
    expect(publishButton()).toBeEnabled()
  })
})

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

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { FunnelBuilder, type FunnelBuilderProps } from "@/components/admin/funnels/FunnelBuilder"
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
      props: { headline: "Train like an athlete" },
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
  changed: [
    { id: "hero1", kind: "hero", label: "Hero", action: "updated", reasons: ["headline size"] },
  ],
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

/** Routes by URL so a test can answer the build and publish routes differently. */
function mockFetch(handlers: {
  build?: () => { status: number; body: unknown }
  publish?: () => { status: number; body: unknown }
}) {
  const fetchMock = vi.fn(async (url: string) => {
    const which = url.includes("/publish") ? handlers.publish : handlers.build
    const result = which ? which() : { status: 200, body: turn() }
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body,
    }
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
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

    fireEvent.click(publishButton())
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

    fireEvent.click(publishButton())

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
    fireEvent.click(publishButton())
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }))

    await waitFor(() => expect(screen.getByText("The page HTML is too large.")).toBeInTheDocument())

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
    fireEvent.click(publishButton())
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }))

    await waitFor(() =>
      expect(screen.getByText('The program "Comeback Code" no longer exists.')).toBeInTheDocument(),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reports what the compiler removed in a strip that stays, never a toast", async () => {
    // MUTANT KILLED: `for (const w of warnings) toast.warning(w)` after a
    // successful publish. `toast.warning` must not be called at all.
    mockFetch({
      publish: () => ({ status: 200, body: { version: 3, warnings: ["An <iframe> was removed."] } }),
    })

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(publishButton())
    fireEvent.click(screen.getByRole("button", { name: /publish now/i }))

    await waitFor(() => expect(screen.getByText(/published version 3/i)).toBeInTheDocument())
    expect(screen.getByText("An <iframe> was removed.")).toBeInTheDocument()
    expect(toast.warning).not.toHaveBeenCalled()
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
      expect(
        screen.getByText(/Changed: Hero \(headline size\)\. Untouched: 8 sections\./),
      ).toBeInTheDocument(),
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

    expect(
      screen.getAllByRole("button", { name: /^(Landing|Opt-in|Sales|Thank-you|Waitlist)/ }),
    ).toHaveLength(5)

    fireEvent.click(screen.getByRole("button", { name: "Landing page for a summer camp" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(bodyOf(fetchMock, 0).message).toBe("Landing page for a summer camp")
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

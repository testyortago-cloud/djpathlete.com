// __tests__/components/admin/funnel-builder-polish.test.tsx
//
// The review's client half. Two behaviours here are load-bearing and neither is
// visible from the server tests:
//
//   1. The built page must appear as soon as `result` lands, NOT when the
//      stream ends. The review holds the stream open for another 30-40 seconds
//      after the page is written, so a component that waits for the terminal
//      outcome leaves the owner watching a progress panel over a page that has
//      already been saved — which is the entire reason the server emits
//      `result` before it starts reviewing.
//
//   2. The Polish button must post `{action:"polish"}`. Posting a message body
//      instead would run the builder first, spending a call answering a
//      sentence the owner never typed.
//
// `fireEvent`, not `user-event`: that package is not a dependency of this repo
// (same deviation, same reason, as funnel-builder.test.tsx). No fake timers —
// `shouldAdvanceTime` starves `waitFor`, which is a documented trap here.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { FunnelBuilder, type FunnelBuilderProps } from "@/components/admin/funnels/FunnelBuilder"
import { encodeBuildStreamEvent, type BuildStreamEvent } from "@/lib/funnels/sections/build-stream"
import type { BuildTurnResponse, CompileSummary, SectionDoc } from "@/components/admin/funnels/builder/types"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const CLEAN_COMPILE: CompileSummary = { ok: true, problems: [], warnings: [] }

function docWith(headline: string): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [{ id: "hero1", kind: "hero", variant: "centered", style: {}, props: { headline } }],
  }
}

const DOC = docWith("Train like an athlete")

function turn(overrides: Partial<BuildTurnResponse> = {}): BuildTurnResponse {
  return {
    revision: 6,
    doc: DOC,
    reply: "Drafted the page.",
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
    funnelId: "funnel-1",
    funnelName: "Summer camp",
    stepId: "step-1",
    stepName: "Landing",
    publicUrl: "/go/summer-camp",
    funnelStatus: "published",
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

function sseResponse(events: BuildStreamEvent[]): Response {
  return new Response(events.map(encodeBuildStreamEvent).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  })
}

/** A stream held open, so the test can assert what is on screen partway. */
function openStream() {
  let push: (event: BuildStreamEvent) => void = () => {}
  let close: () => void = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      push = (event) => controller.enqueue(encoder.encode(encodeBuildStreamEvent(event)))
      close = () => controller.close()
    },
  })
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  })
  return { response, push: (event: BuildStreamEvent) => push(event), close: () => close() }
}

function lastFetchBody(): Record<string, unknown> {
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
  return JSON.parse((calls[calls.length - 1][1] as { body: string }).body)
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn() as never
})

describe("the Polish button", () => {
  it("is shown once a page exists", async () => {
    render(<FunnelBuilder {...baseProps()} />)
    expect(await screen.findByRole("button", { name: /polish/i })).toBeTruthy()
  })

  it("is HIDDEN when there is no page to polish", () => {
    // MUTANT: rendering it disabled instead. A greyed-out control with no
    // explanation reads as broken rather than as not-yet-applicable.
    render(<FunnelBuilder {...baseProps({ initialDoc: null })} />)
    expect(screen.queryByRole("button", { name: /polish/i })).toBeNull()
  })

  it("is HIDDEN when the draft cannot be read at all", () => {
    render(<FunnelBuilder {...baseProps({ docInvalid: true, resetToRevision: 3 })} />)
    expect(screen.queryByRole("button", { name: /polish/i })).toBeNull()
  })

  it("posts action polish and the current revision — never a message", async () => {
    // MUTANT: sending `{message: "Polish this page", revision}`. The builder
    // would run first, spending an Opus call on a sentence nobody typed, and
    // the owner's transcript would carry it as though they had.
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([{ type: "result", turn: turn({ revision: 6, source: "review" }) }]),
    )

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(await screen.findByRole("button", { name: /polish/i }))

    await waitFor(() => {
      expect(lastFetchBody()).toEqual({ action: "polish", revision: 5 })
    })
  })

  it("applies the polished document when the review changes the page", async () => {
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        { type: "phase", phase: "reviewing" },
        {
          type: "review",
          turn: turn({ revision: 6, source: "review", reply: "Retoned two seams.", doc: docWith("A polished headline") }),
        },
      ]),
    )

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(await screen.findByRole("button", { name: /polish/i }))

    expect(await screen.findByText("Retoned two seams.")).toBeTruthy()
  })

  it("reports a review that could not finish, without claiming the page changed", async () => {
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        { type: "phase", phase: "reviewing" },
        { type: "fail", status: 502, body: { error: "The reviewer could not finish." } },
      ]),
    )

    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(await screen.findByRole("button", { name: /polish/i }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("The reviewer could not finish.")
    })
  })
})

describe("a build turn that is then reviewed", () => {
  it("shows the built page BEFORE the review finishes", async () => {
    // THE POINT OF THE WHOLE ORDERING. `result` lands, then the review runs for
    // another half minute. If the component waited for the terminal outcome the
    // owner would watch a spinner over a page that was already saved.
    //
    // MUTANT: moving `applyTurn` back below the stream loop. This test goes red
    // because the reply is not on screen while the stream is still open.
    const stream = openStream()
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(stream.response)

    render(<FunnelBuilder {...baseProps({ initialDoc: null, initialRevision: 4 })} />)

    const composer = screen.getByLabelText(/describe the change/i)
    fireEvent.change(composer, { target: { value: "build me a waitlist page" } })
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())

    stream.push({ type: "result", turn: turn({ revision: 6, reply: "Drafted the page." }) })

    // On screen while the stream is STILL OPEN.
    expect(await screen.findByText("Drafted the page.")).toBeTruthy()

    stream.push({ type: "phase", phase: "reviewing" })
    stream.push({
      type: "finding",
      finding: {
        code: "tone-run",
        severity: "high",
        sectionIds: ["a", "b"],
        issue: "two sections share a tone and read as one band",
        suggestion: "retone one",
        source: "audit",
      },
    })

    // And the finding is narrated while the owner waits.
    expect(await screen.findByText(/two sections share a tone/i)).toBeTruthy()

    stream.push({ type: "review", turn: turn({ revision: 7, source: "review", reply: "Retoned two seams." }) })
    stream.close()

    expect(await screen.findByText("Retoned two seams.")).toBeTruthy()
  })

  it("keeps BOTH turns in the transcript — the builder wrote, the reviewer changed", async () => {
    // MUTANT: replacing the build turn with the review turn. The owner would
    // lose the record of what was originally drafted, and "Go back to here"
    // would have nothing to go back to.
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        { type: "result", turn: turn({ revision: 6, reply: "Drafted the page." }) },
        { type: "phase", phase: "reviewing" },
        { type: "review", turn: turn({ revision: 7, source: "review", reply: "Retoned two seams." }) },
      ]),
    )

    render(<FunnelBuilder {...baseProps({ initialDoc: null, initialRevision: 4 })} />)

    const composer = screen.getByLabelText(/describe the change/i)
    fireEvent.change(composer, { target: { value: "build me a page" } })
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))

    expect(await screen.findByText("Drafted the page.")).toBeTruthy()
    expect(await screen.findByText("Retoned two seams.")).toBeTruthy()
  })

  it("does not append the same turn twice", async () => {
    // MUTANT: applying `result` in the event handler AND again from the
    // terminal outcome after the loop. React would hold two children with the
    // same content, and the owner would see their turn duplicated.
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([{ type: "result", turn: turn({ revision: 6, reply: "Drafted the page." }) }]),
    )

    render(<FunnelBuilder {...baseProps({ initialDoc: null, initialRevision: 4 })} />)

    const composer = screen.getByLabelText(/describe the change/i)
    fireEvent.change(composer, { target: { value: "build me a page" } })
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))

    await screen.findByText("Drafted the page.")
    expect(screen.getAllByText("Drafted the page.")).toHaveLength(1)
  })
})

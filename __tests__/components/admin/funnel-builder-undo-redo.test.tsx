// __tests__/components/admin/funnel-builder-undo-redo.test.tsx
//
// Undo/redo in the builder — the buttons, the two shortcuts, and the one rule
// that decides whether this feature is usable or infuriating: Cmd+Z with the
// caret in the chat composer must undo TYPING, not the page.
//
// `FunnelBuilder` is mounted for both funnels and landing pages from the same
// component, so everything here covers both surfaces at once. The
// `funnelKind: "page"` case is asserted explicitly anyway, because "it works on
// landing pages too" is half of what was actually asked for.
//
// `fireEvent`, not `user-event`: that package is not a dependency of this repo
// (same deviation, same reason, as funnel-builder.test.tsx).

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { FunnelBuilder, type FunnelBuilderProps } from "@/components/admin/funnels/FunnelBuilder"
import type {
  BuildTurnResponse,
  BuilderMessage,
  CompileSummary,
  SectionDoc,
} from "@/components/admin/funnels/builder/types"

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
    revision: 7,
    doc: DOC,
    reply: "Restored.",
    blocked: false,
    receipt: null,
    compile: CLEAN_COMPILE,
    unresolved: [],
    danglingAnchors: [],
    resolutionError: null,
    source: "revert",
    ...overrides,
  }
}

/** A transcript with three restore points: revisions 2, 4 and 6. */
function transcript(): BuilderMessage[] {
  return [
    { id: "m2", role: "builder", text: "Drafted the page.", revision: 2, producedDoc: true },
    { id: "m4", role: "builder", text: "Changed the headline.", revision: 4, producedDoc: true },
    { id: "m6", role: "builder", text: "Added a pricing panel.", revision: 6, producedDoc: true },
  ]
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
    funnelStatus: "published",
    funnelKind: "funnel",
    initialDoc: DOC,
    initialRevision: 6,
    docInvalid: false,
    resetToRevision: null,
    initialUnresolved: [],
    initialDanglingAnchors: [],
    initialCompile: CLEAN_COMPILE,
    initialResolutionError: null,
    initialMessages: transcript(),
    maxMessageLength: 12_000,
    renderForPublish,
    ...overrides,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

function lastFetchBody(): Record<string, unknown> {
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
  return JSON.parse((calls[calls.length - 1][1] as { body: string }).body)
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(turn())) as never
})

describe("the undo and redo buttons", () => {
  it("are on screen for a funnel AND for a landing page", async () => {
    // One component serves both surfaces, which is the whole of "make it work
    // for both" — but the landing-page case is asserted rather than assumed.
    const funnel = render(<FunnelBuilder {...baseProps()} />)
    expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy()
    funnel.unmount()

    render(<FunnelBuilder {...baseProps({ funnelKind: "page" })} />)
    expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy()
  })

  it("undo restores the revision immediately behind the head", async () => {
    // MUTANT: sending the oldest revision. One press would throw away every
    // edit instead of stepping back one.
    render(<FunnelBuilder {...baseProps()} />)
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }))

    await waitFor(() => {
      expect(lastFetchBody()).toEqual({ action: "reset", toRevision: 4 })
    })
  })

  it("redo is disabled until something has been undone, then goes forward", async () => {
    // MUTANT: leaving Redo always enabled. Pressing it at the head would post a
    // reset to the revision already on screen — a no-op turn, a wasted write,
    // and a transcript entry recording nothing.
    render(<FunnelBuilder {...baseProps()} />)

    const redo = await screen.findByRole("button", { name: "Redo" })
    expect((redo as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(screen.getByRole("button", { name: "Redo" }))
    await waitFor(() => {
      expect(lastFetchBody()).toEqual({ action: "reset", toRevision: 6 })
    })
  })

  it("undo is disabled on a page with only one restore point", async () => {
    render(
      <FunnelBuilder
        {...baseProps({
          initialMessages: [{ id: "m2", role: "builder", text: "Drafted.", revision: 2, producedDoc: true }],
        })}
      />,
    )

    expect(((await screen.findByRole("button", { name: "Undo" })) as HTMLButtonElement).disabled).toBe(true)
  })

  it("undoing twice steps back twice, rather than sticking", async () => {
    // THE POINTER BUG THIS PINS: a restore mints a NEW revision, and an
    // implementation that pushed it would truncate the stack on the way past —
    // so the second undo would go nowhere.
    render(<FunnelBuilder {...baseProps()} />)

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }))
    await waitFor(() => expect(lastFetchBody()).toEqual({ action: "reset", toRevision: 4 }))

    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(lastFetchBody()).toEqual({ action: "reset", toRevision: 2 }))
  })
})

describe("the keyboard", () => {
  it("Cmd+Z undoes and Cmd+Shift+Z redoes", async () => {
    render(<FunnelBuilder {...baseProps()} />)
    await screen.findByRole("button", { name: "Undo" })

    fireEvent.keyDown(document, { key: "z", metaKey: true })
    await waitFor(() => expect(lastFetchBody()).toEqual({ action: "reset", toRevision: 4 }))

    // Wait for the undo to SETTLE before redoing. Both undo and redo refuse
    // while a restore is still in flight — the builder holds one revision lock,
    // and firing a second reset over an unfinished one is how two tabs 409 each
    // other. Redo becoming enabled is that settling, observable.
    await waitFor(() => expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(false))

    fireEvent.keyDown(document, { key: "z", metaKey: true, shiftKey: true })
    await waitFor(() => expect(lastFetchBody()).toEqual({ action: "reset", toRevision: 6 }))
  })

  it("Ctrl+Z works too, for the same reason the tooltip says Ctrl", async () => {
    render(<FunnelBuilder {...baseProps()} />)
    await screen.findByRole("button", { name: "Undo" })

    fireEvent.keyDown(document, { key: "z", ctrlKey: true })
    await waitFor(() => expect(lastFetchBody()).toEqual({ action: "reset", toRevision: 4 }))
  })

  it("DOES NOT fire while the caret is in the chat composer", async () => {
    // THE RULE THAT DECIDES WHETHER THIS FEATURE IS USABLE. An owner halfway
    // through a sentence presses Cmd+Z to fix a typo; losing their last page
    // edit instead of their last word is not a mistake they forgive.
    //
    // MUTANT: dropping the target check. This is the only test that catches it,
    // and it is the most likely line to be "simplified" away.
    render(<FunnelBuilder {...baseProps()} />)
    const composer = await screen.findByLabelText(/describe the change/i)

    fireEvent.change(composer, { target: { value: "make the hero bigger" } })
    fireEvent.keyDown(composer, { key: "z", metaKey: true })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("ignores a bare z, and z with alt", async () => {
    // The negative pair. Without these, a handler that fired on every `z`
    // would pass every other test in this file.
    render(<FunnelBuilder {...baseProps()} />)
    await screen.findByRole("button", { name: "Undo" })

    fireEvent.keyDown(document, { key: "z" })
    fireEvent.keyDown(document, { key: "z", metaKey: true, altKey: true })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("does nothing at the ends of the stack", async () => {
    render(
      <FunnelBuilder
        {...baseProps({
          initialMessages: [{ id: "m2", role: "builder", text: "Drafted.", revision: 2, producedDoc: true }],
        })}
      />,
    )
    await screen.findByRole("button", { name: "Undo" })

    fireEvent.keyDown(document, { key: "z", metaKey: true })
    fireEvent.keyDown(document, { key: "z", metaKey: true, shiftKey: true })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe("undo and a new edit", () => {
  it("abandons the redo future once the owner edits again", async () => {
    // Standard undo semantics, asserted through the UI rather than only in the
    // pure module: after undoing and then making a real edit, Redo must be off.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    render(<FunnelBuilder {...baseProps()} />)

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }))
    await waitFor(() => expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(false))

    // A new AI turn that writes a document.
    fetchMock.mockResolvedValue(
      new Response(`data: ${JSON.stringify({ type: "result", turn: turn({ revision: 9, source: "ai" }) })}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      }),
    )
    fireEvent.change(screen.getByLabelText(/describe the change/i), { target: { value: "add a testimonial" } })
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))

    await waitFor(() => expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true))
  })
})

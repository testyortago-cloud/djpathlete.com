// __tests__/components/admin/funnels/draft-queue.test.tsx
//
// The queue that answers "i dont want to click the other one for it to be
// generate". It lives in the PROVIDER, which the edit layout mounts, because
// Next keeps a layout mounted across `[stepId]` navigations — so a draft
// started while page 1 is on screen keeps running when the owner clicks to
// page 3. Anywhere else it would die on the first navigation.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import {
  ConnectionsProvider,
  useConnections,
  type DraftJob,
} from "@/components/admin/funnels/connections-context"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const JOBS: DraftJob[] = [
  { stepId: "s2", prompt: "Build step 2", revision: 0 },
  { stepId: "s3", prompt: "Build step 3", revision: 0 },
]

const PAGES = [
  { id: "s1", name: "Signup", slug: "index", position: 0, isEntry: true, live: false, published: false },
  { id: "s2", name: "Thanks", slug: "thanks", position: 1, isEntry: false, live: false, published: false },
  { id: "s3", name: "Done", slug: "done", position: 2, isEntry: false, live: false, published: false },
]

/** A build response carrying one `result` event, as the route streams it. */
function streamResponse(doc: unknown = null) {
  const payload =
    `data: ${JSON.stringify({ type: "result", turn: { revision: 1, doc, reply: "ok", blocked: false, receipt: null, compile: { ok: true, problems: [], warnings: [] }, unresolved: [], danglingAnchors: [], resolutionError: null } })}\n\n`
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } })
}

/** Reads the queue out of the context and exposes a way to start it. */
function Probe({ auto = true }: { auto?: boolean }) {
  const context = useConnections()
  if (!context) return null
  return (
    <div>
      <button onClick={() => context.startAutoDraft()}>start</button>
      {!auto ? null : null}
      <span data-testid="s2">{context.draftPhase("s2")}</span>
      <span data-testid="s3">{context.draftPhase("s3")}</span>
    </div>
  )
}

function mount(jobs: DraftJob[] = JOBS) {
  return render(
    <ConnectionsProvider
      funnelId="f1"
      funnelSlug="free-trial-week"
      funnelKind="funnel"
      pages={PAGES}
      initialDocs={PAGES.map((page) => ({ ...page, doc: null }))}
      draftJobs={jobs}
    >
      <Probe />
    </ConnectionsProvider>,
  )
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe("the draft queue", () => {
  it("drafts nothing until it is started", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    mount()
    // MUTANT: kicking the queue off in a mount effect. Step 1 is still being
    // written at that moment, and a second concurrent model call is both a
    // rate-limit hazard and a step 2 that does not know what step 1 said.
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("idle"))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("drafts the queued steps ONE AT A TIME, in order", async () => {
    const seen: string[] = []
    let release: (() => void) | null = null
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      if (seen.length === 1) {
        // Hold the first call open. If the queue were parallel, the second
        // fetch would already have happened by the time we look.
        await new Promise<void>((resolve) => { release = resolve })
      }
      return streamResponse()
    })

    mount()
    act(() => { screen.getByText("start").click() })

    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toContain("/api/admin/funnels/steps/s2/build")
    // MUTANT: `jobs.map(run)` instead of an await-in-loop. Parallel drafting
    // fires every step at the builder rate limit at once, and writes step 3
    // without step 2 existing — which is what the prompt's "the full sequence
    // is..." line and `resolveDoc`'s page list both depend on.
    expect(seen).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("writing"))
    expect(screen.getByTestId("s3")).toHaveTextContent("queued")

    act(() => { release?.() })
    await waitFor(() => expect(seen).toHaveLength(2))
    expect(seen[1]).toContain("/api/admin/funnels/steps/s3/build")
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("done"))
  })

  it("keeps going after one step fails", async () => {
    const seen: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      if (seen.length === 1) return new Response("{}", { status: 500, headers: { "content-type": "application/json" } })
      return streamResponse()
    })

    mount()
    act(() => { screen.getByText("start").click() })

    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("failed"))
    // MUTANT: a `throw` that escapes the loop, or a `return` on failure. One
    // model refusal must not strand every page behind it.
    await waitFor(() => expect(seen).toHaveLength(2))
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
  })

  it("cannot be started twice", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => streamResponse())
    mount()
    act(() => { screen.getByText("start").click() })
    act(() => { screen.getByText("start").click() })
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: no `started` ref. `FunnelBuilder` calls this from an effect that
    // can re-run, and a second pass would draft every page a second time —
    // over the top of the first pass's work, at full model cost.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("publishes each finished document into the graph", async () => {
    const doc = { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] }
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => streamResponse(doc))
    const seenDocs: unknown[] = []
    function DocProbe() {
      const context = useConnections()
      seenDocs.push(context?.docFor("s2") ?? null)
      return <button onClick={() => context?.startAutoDraft()}>start</button>
    }
    render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES} initialDocs={PAGES.map((p) => ({ ...p, doc: null }))} draftJobs={JOBS}
      >
        <DocProbe />
      </ConnectionsProvider>,
    )
    act(() => { screen.getByText("start").click() })
    // MUTANT: dropping the `publishStepConnections` call on completion. The
    // rail would keep drawing "leads nowhere" for a page that has just been
    // written — the "collected and then ignored" failure this area has shipped
    // twice already.
    await waitFor(() => expect(seenDocs.at(-1)).toEqual(doc))
  })

  it("skips a step whose document already arrived", async () => {
    // The queue is built by the LAYOUT before step 1's own draft has landed,
    // so it can list step 1 (or, here, s2) as a job. By the time the queue
    // actually RUNS, `FunnelBuilder` may already have published a document for
    // that step into the graph via `publishStepConnections` — most concretely,
    // step 1 finishing its own `initialPrompt` draft right as `startAutoDraft`
    // fires. Re-drafting it would cost nothing server-side (the build route's
    // revision check 409s before the model call) but would flip a page the
    // owner just watched succeed to a red "failed" badge: the exact
    // lying-status-badge defect this feature exists to remove.
    const seen: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      return streamResponse()
    })
    const seededDoc: SectionDoc = { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] }

    render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES}
        initialDocs={PAGES.map((p) => ({ ...p, doc: p.id === "s2" ? seededDoc : null }))}
        draftJobs={JOBS}
      >
        <Probe />
      </ConnectionsProvider>,
    )
    act(() => { screen.getByText("start").click() })

    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: removing the "document already exists" skip check. Without it,
    // the queue drafts s2 too — asserting on the URLs, not a call count, is
    // the only way to tell "skipped s2, ran s3" apart from "ran s2, ran s3".
    expect(seen.some((url) => url.includes("/api/admin/funnels/steps/s2/build"))).toBe(false)
    expect(seen.some((url) => url.includes("/api/admin/funnels/steps/s3/build"))).toBe(true)
  })
})

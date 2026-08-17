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
  useDraftQueue,
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

/** A document that parses — seeded into the graph to stand for "already built". */
const BUILT: SectionDoc = {
  v: 1,
  engine: "sections",
  theme: { tone: "light", accent: "accent", radius: "soft" },
  sections: [],
}

/**
 * A build response carrying one `result` event, as the route streams it.
 *
 * `doc` DEFAULTS TO A REAL DOCUMENT because that is what the route actually
 * sends on the path these tests are standing in for. On the build path the only
 * `result` with a null `doc` is a refusal, which carries `blocked: true` — a
 * fixture that returned `doc: null, blocked: false` and then asserted "done"
 * would be pinning a response the server cannot produce.
 *
 * `compile` is DERIVED, not a fixed value: the route's own contract
 * (`components/admin/funnels/builder/types.ts`) is that `compile` is null on
 * EXACTLY the two paths that leave no document — the model declined
 * (`blocked`) and both attempts failed (surfaced here by `doc: null`) — and
 * non-null on every path that wrote one. A fixture that hardcoded
 * `compile: { ok: true, ... }` regardless of `doc`/`blocked` would let a test
 * assert a (`doc`/`blocked`, `compile`) pairing the server cannot produce.
 */
function streamResponse(doc: unknown = BUILT, blocked = false) {
  const compile = doc === null || blocked ? null : { ok: true, problems: [], warnings: [] }
  const payload =
    `data: ${JSON.stringify({ type: "result", turn: { revision: 1, doc, reply: "ok", blocked, receipt: null, compile, unresolved: [], danglingAnchors: [], resolutionError: null, source: "ai" } })}\n\n`
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } })
}

/** Reads the queue out of the context and exposes a way to start it. */
function Probe() {
  const context = useConnections()
  if (!context) return null
  return (
    <div>
      <button onClick={() => context.startAutoDraft()}>start</button>
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

  it("cannot be started twice WHILE IT IS RUNNING", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => streamResponse())
    mount()
    act(() => { screen.getByText("start").click() })
    act(() => { screen.getByText("start").click() })
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: neither guard on its own — verified by deleting each
    // separately. Delete `started.current` alone and this still passes:
    // `runJob` sets its step's phase to "writing" SYNCHRONOUSLY, before its
    // `await fetch`, so by the time the second click lands the `some(writing)`
    // guard is already there to catch it. Delete `some(writing)` alone and
    // this still passes too, the other way round: `started.current` is set
    // synchronously on the first call, so it catches the second click before
    // the writing check is ever reached. Only deleting BOTH at once fails
    // this test (4 fetches instead of 2). Both clicks happen while the queue
    // is running, which is the only thing this test can see — hence the
    // drained-queue test below for what `started` buys once every phase is
    // terminal and the writing guard no longer applies. The writing guard is
    // also documented above as CURRENTLY UNREACHABLE in production, so no
    // test can pin it alone.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("does not restart once the queue has DRAINED", async () => {
    // A DRAINED QUEUE THAT WROTE NOTHING TO THE GRAPH — every job `blocked`, so
    // `turn.compile` is null and `runJob` lands on `failed` without publishing.
    //
    // THE FIXTURE IS THE WHOLE TEST, and the obvious version proves nothing: on
    // a drain of SUCCESSFUL builds, `startAutoDraft`'s run-time check
    // (`docsRef.current.find(...)?.doc`) skips every step on the second pass
    // and no fetch happens whether `started` exists or not. Verified — the
    // successful-drain version of this test passes with the ref deleted. Only a
    // drain that left the graph empty puts `started` on its own.
    //
    // It is also the case that MATTERS most: `failed` is terminal precisely so
    // a model refusal is not repeated automatically at twice the cost.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => streamResponse(BUILT, true))
    mount()
    act(() => { screen.getByText("start").click() })

    // DRAINED, not merely started: both phases terminal and `queueInFlight`
    // back to false. Every OTHER guard has stopped applying here — no phase is
    // "writing" any more — so `started` is the only thing holding the door.
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("failed"))
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("failed"))
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    act(() => { screen.getByText("start").click() })

    // MUTANT: no `started` ref — the mutant the test above was wrongly credited
    // with killing. `FunnelBuilder` calls `startAutoDraft` from an effect that
    // can re-run, and once the queue has drained nothing else refuses: every
    // page is drafted again at full model cost, and every page the model
    // declined is asked again, which `DraftPhase` explicitly forbids.
    //
    // `waitFor` on the COUNT rather than a bare assertion, so a restart that is
    // one microtask behind this line is still caught.
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("failed"))
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

    render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES}
        initialDocs={PAGES.map((p) => ({ ...p, doc: p.id === "s2" ? BUILT : null }))}
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

  it("re-reads the graph when the queue RUNS, not when it was composed", async () => {
    // The test above seeds the document through `initialDocs`, so it would pass
    // just as well against a queue that consulted the graph as it stood at
    // MOUNT. This one is the case that actually happens: the layout composed
    // the job list while every page was blank, and the document arrives
    // afterwards, from `FunnelBuilder` publishing step 1's own `initialPrompt`
    // draft — in the same tick that then starts the queue.
    //
    // So the skip must read a REF written by `publishStepConnections`, not the
    // `docs` state a callback closed over at some earlier render.
    const seen: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      return streamResponse()
    })

    function LateProbe() {
      const context = useConnections()
      if (!context) return null
      return (
        <div>
          <button
            onClick={() => {
              context.publishStepConnections("s2", BUILT)
              context.startAutoDraft()
            }}
          >
            go
          </button>
          <span data-testid="s3">{context.draftPhase("s3")}</span>
        </div>
      )
    }

    render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES} initialDocs={PAGES.map((p) => ({ ...p, doc: null }))} draftJobs={JOBS}
      >
        <LateProbe />
      </ConnectionsProvider>,
    )
    act(() => { screen.getByText("go").click() })

    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: mirroring `docs` into the ref from a `useEffect` instead of
    // writing it inside `publishStepConnections`. The effect has not run yet
    // when the queue starts in this same tick, so the queue would see the
    // stale blank graph and re-draft a page that was just written.
    expect(seen.some((url) => url.includes("/api/admin/funnels/steps/s2/build"))).toBe(false)
    expect(seen.some((url) => url.includes("/api/admin/funnels/steps/s3/build"))).toBe(true)
  })

  it("keeps going when the request itself throws", async () => {
    // The 500 in "keeps going after one step fails" returns a Response and so
    // never reaches `runJob`'s catch — that whole block was uncovered, and a
    // `throw` planted in it passed every other test in this file. A rejected
    // fetch (offline, DNS, an aborted navigation) is the case that reaches it.
    vi.spyOn(console, "error").mockImplementation(() => {})
    const seen: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      if (seen.length === 1) throw new TypeError("Failed to fetch")
      return streamResponse()
    })

    mount()
    act(() => { screen.getByText("start").click() })

    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("failed"))
    // MUTANT: rethrowing from `runJob`'s catch. The rejection would escape the
    // await-in-loop and strand every page behind the one that lost its
    // connection — with no `failed` badge to say why, because the phase update
    // never happens either.
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    expect(seen).toHaveLength(2)
  })

  it("calls a turn that produced no document failed, not done", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("/steps/s2/") ? streamResponse(null) : streamResponse(),
    )
    mount()
    act(() => { screen.getByText("start").click() })

    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: reporting success from `blocked` alone. A turn that carries no
    // document has left the page exactly as blank as it found it, and a green
    // "done" badge over a blank page is the lying badge this whole feature
    // exists to remove — the owner would never open the one page that still
    // needs them.
    expect(screen.getByTestId("s2")).toHaveTextContent("failed")
  })

  it("calls a blocked turn failed even though it carries a document", async () => {
    // The refusal path emits `doc: draft.doc` — the page as it already stood,
    // NOT the page the model was asked for. So a nullness check alone reads a
    // refusal as a success, which is why the predicate needs `blocked` too.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("/steps/s2/") ? streamResponse(BUILT, true) : streamResponse(),
    )
    mount()
    act(() => { screen.getByText("start").click() })

    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: reporting success from the document alone.
    expect(screen.getByTestId("s2")).toHaveTextContent("failed")
  })

  it("does not adopt the document a refused turn hands back", async () => {
    // Both null-compile paths emit `doc: draft.doc` — the page as it already
    // stood, which for a queued step is the blank the queue was sent to fill.
    // `BuildTurnResponse.compile`'s own doc comment names adopting it as the
    // mistake: it writes the route's fallback over the graph.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("/steps/s2/") ? streamResponse(BUILT, true) : streamResponse(),
    )
    const seenDocs: (SectionDoc | null)[] = []
    function DocProbe() {
      const context = useConnections()
      seenDocs.push(context?.docFor("s2") ?? null)
      return (
        <div>
          <button onClick={() => context?.startAutoDraft()}>start</button>
          <span data-testid="s3">{context?.draftPhase("s3")}</span>
        </div>
      )
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

    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: publishing into the graph before the compile check. The rail
    // would draw s2's arrows from a document the owner does not have.
    expect(seenDocs.every((entry) => entry === null)).toBe(true)
  })

  it("sees a document published after an earlier dispatch on the same provider", async () => {
    // THE EAGER-STATE OPTIMIZATION IS NOT A GUARANTEE. React runs a `useState`
    // updater at dispatch time only while the fiber has no queued work, so
    // assigning `docsRef` INSIDE the `setDocs` updater is synchronous by
    // accident and deferred to the render phase as soon as anything else has
    // already dispatched on this same provider fiber.
    //
    // `registerRepair` is such a dispatch (`setRepair`), and it is ordinary for
    // the builder to register its repair handler in the same commit that
    // publishes its first document. So: dispatch, publish, start — and the skip
    // must still see the document.
    const seen: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      return streamResponse()
    })

    function OrderedProbe() {
      const context = useConnections()
      if (!context) return null
      return (
        <div>
          <button
            onClick={() => {
              context.registerRepair({ stepId: "s1", apply: () => {} })
              context.publishStepConnections("s2", BUILT)
              context.startAutoDraft()
            }}
          >
            go
          </button>
          <span data-testid="s3">{context.draftPhase("s3")}</span>
        </div>
      )
    }

    render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES} initialDocs={PAGES.map((p) => ({ ...p, doc: null }))} draftJobs={JOBS}
      >
        <OrderedProbe />
      </ConnectionsProvider>,
    )
    act(() => { screen.getByText("go").click() })

    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: `docsRef.current = next` back inside the `setDocs` updater. The
    // earlier `setRepair` puts work on the fiber, React skips the eager path,
    // and the queue re-drafts the page it was just told about.
    expect(seen.some((url) => url.includes("/api/admin/funnels/steps/s2/build"))).toBe(false)
    expect(seen.some((url) => url.includes("/api/admin/funnels/steps/s3/build"))).toBe(true)
  })

  // ---------------------------------------------------------------------
  // `draftStep` and `useDraftQueue` — the surface Tasks 5 and 6 consume.
  // ---------------------------------------------------------------------

  /** Renders `draftStep` against one named step. */
  function OneProbe({ target }: { target: string }) {
    const context = useConnections()
    if (!context) return null
    return (
      <div>
        <button onClick={() => context.draftStep(target)}>one</button>
        <span data-testid="s2">{context.draftPhase("s2")}</span>
        <span data-testid="s3">{context.draftPhase("s3")}</span>
      </div>
    )
  }

  function mountOne(target: string) {
    return render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES} initialDocs={PAGES.map((p) => ({ ...p, doc: null }))} draftJobs={JOBS}
      >
        <OneProbe target={target} />
      </ConnectionsProvider>,
    )
  }

  it("drafts the one step it is asked for, and no others", async () => {
    const seen: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      return streamResponse()
    })
    mountOne("s3")
    act(() => { screen.getByText("one").click() })

    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: `draftStep` falling through to the whole queue. This is the
    // publish refusal's "Generate it now" for ONE named page — drafting every
    // other blank page off the back of it spends the owner's model budget on
    // pages they did not ask about.
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain("/api/admin/funnels/steps/s3/build")
    expect(screen.getByTestId("s2")).toHaveTextContent("idle")
  })

  it("declines to redraft a step it is already writing", async () => {
    const seen: string[] = []
    let release: (() => void) | null = null
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      if (seen.length === 1) await new Promise<void>((resolve) => { release = resolve })
      return streamResponse()
    })
    mountOne("s3")
    act(() => { screen.getByText("one").click() })
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("writing"))

    act(() => { screen.getByText("one").click() })
    // MUTANT: dropping the `phasesRef` guard. A second press while the first
    // build is still streaming opens a concurrent turn on the SAME step, and
    // the two race the build route's revision check — one of them 409s and
    // reports a failure for a page that is being written perfectly well.
    expect(seen).toHaveLength(1)

    act(() => { release?.() })
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
  })

  it("declines a second press before any render has committed", async () => {
    // `phasesRef` has to be assigned the moment `setPhase` is called, not
    // mirrored from `phases` by an effect. An effect mirror is a render behind,
    // so two presses inside one handler — or, in the real provider, a
    // `draftStep` in the same tick that `startAutoDraft` marked everything
    // "queued" — both read an empty map and both start a build on the SAME
    // step, which then race the build route's revision check.
    const seen: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      return streamResponse()
    })

    function TwiceProbe() {
      const context = useConnections()
      if (!context) return null
      return (
        <div>
          <button onClick={() => { context.draftStep("s2"); context.draftStep("s2") }}>twice</button>
          <span data-testid="s2">{context.draftPhase("s2")}</span>
        </div>
      )
    }

    render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES} initialDocs={PAGES.map((p) => ({ ...p, doc: null }))} draftJobs={JOBS}
      >
        <TwiceProbe />
      </ConnectionsProvider>,
    )
    act(() => { screen.getByText("twice").click() })

    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("done"))
    // MUTANT: `phasesRef` kept in step by `useEffect(() => { phasesRef.current
    // = phases }, [phases])` instead of being assigned inside `setPhase`.
    expect(seen).toHaveLength(1)
  })

  it("refuses a single-step draft while the queue is still running", async () => {
    // The per-step phase guard cannot cover this on its own: by the time the
    // queue has moved past s2 it has already left it `failed`, which is
    // neither "writing" nor "queued". Without a queue-in-flight guard the
    // owner's "Generate it now" opens a second build alongside the one the
    // queue is running — against this task's one hard constraint.
    vi.spyOn(console, "error").mockImplementation(() => {})
    const seen: string[] = []
    let release: (() => void) | null = null
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      // s2 fails immediately; s3 then holds the queue open.
      if (seen.length === 1) return new Response("{}", { status: 500, headers: { "content-type": "application/json" } })
      if (seen.length === 2) await new Promise<void>((resolve) => { release = resolve })
      return streamResponse()
    })

    function BothProbe() {
      const context = useConnections()
      if (!context) return null
      return (
        <div>
          <button onClick={() => context.startAutoDraft()}>start</button>
          <button onClick={() => context.draftStep("s2")}>one</button>
          <span data-testid="s2">{context.draftPhase("s2")}</span>
          <span data-testid="s3">{context.draftPhase("s3")}</span>
        </div>
      )
    }

    render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES} initialDocs={PAGES.map((p) => ({ ...p, doc: null }))} draftJobs={JOBS}
      >
        <BothProbe />
      </ConnectionsProvider>,
    )
    act(() => { screen.getByText("start").click() })
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("failed"))
    expect(screen.getByTestId("s3")).toHaveTextContent("writing")

    act(() => { screen.getByText("one").click() })
    // MUTANT: dropping the `queueInFlight` guard from `draftStep`.
    expect(seen).toHaveLength(2)

    // ...and once the queue is done, the same press is allowed through, which
    // is why the flag is separate from the never-cleared `started`.
    act(() => { release?.() })
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    act(() => { screen.getByText("one").click() })
    await waitFor(() => expect(seen).toHaveLength(3))
    expect(seen[2]).toContain("/api/admin/funnels/steps/s2/build")
  })

  it("refuses to start the queue while a single-step draft is in flight", async () => {
    // THE MIRROR OF THE TEST ABOVE. `queueInFlight` stops `draftStep` from
    // opening a second build while the queue is running; nothing stopped the
    // reverse before this fix, even though the comment on `draftStep` claimed
    // "this task's one hard constraint is that builds go one at a time" as a
    // settled fact.
    //
    // Currently unreachable from the real app — `startAutoDraft` only fires
    // from `FunnelBuilder`'s auto-draft effect, which requires
    // `initialPrompt` non-null and `doc !== null`, true only while THAT mount
    // is still finishing its OWN first draft, before any 422 exists and so
    // before "Generate it now" (`draftStep`) can even be offered — but this
    // test drives the provider directly, the way Task 5's `draftSiblingStep`
    // or a future caller could.
    const seen: string[] = []
    let release: (() => void) | null = null
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      if (seen.length === 1) await new Promise<void>((resolve) => { release = resolve })
      return streamResponse()
    })

    function BothProbe() {
      const context = useConnections()
      if (!context) return null
      return (
        <div>
          <button onClick={() => context.draftStep("s2")}>one</button>
          <button onClick={() => context.startAutoDraft()}>start</button>
          <span data-testid="s2">{context.draftPhase("s2")}</span>
          <span data-testid="s3">{context.draftPhase("s3")}</span>
        </div>
      )
    }

    render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES} initialDocs={PAGES.map((p) => ({ ...p, doc: null }))} draftJobs={JOBS}
      >
        <BothProbe />
      </ConnectionsProvider>,
    )
    act(() => { screen.getByText("one").click() })
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("writing"))

    act(() => { screen.getByText("start").click() })
    // MUTANT: dropping the "any phase is writing" guard from `startAutoDraft`.
    // Without it the queue's loop would proceed, see s2 has no document yet
    // (the manual draft has not landed), and open a SECOND build on the exact
    // step `draftStep` is already writing.
    expect(seen).toHaveLength(1)
    expect(screen.getByTestId("s3")).toHaveTextContent("idle")

    act(() => { release?.() })
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("done"))

    // ...and once the manual draft has landed, the queue can run normally —
    // the guard defers it rather than disabling it for the session. s2 is
    // skipped (its document is already in the graph) and s3 drafts.
    act(() => { screen.getByText("start").click() })
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    expect(seen).toHaveLength(2)
    expect(seen[1]).toContain("/api/admin/funnels/steps/s3/build")
  })

  it("is inert outside a provider, so the builder still mounts standalone", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    function Standalone() {
      const { draftPhase, startAutoDraft, draftStep } = useDraftQueue()
      return (
        <button onClick={() => { startAutoDraft(); draftStep("s2") }}>
          {draftPhase("s2")}
        </button>
      )
    }
    // MUTANT: a hook that throws (or reads `context!`) outside a provider.
    // `FunnelBuilder` renders bare in its own tests and in the preview
    // harness; throwing here would make it unmountable in both.
    render(<Standalone />)
    expect(screen.getByText("idle")).toBeInTheDocument()
    act(() => { screen.getByText("idle").click() })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

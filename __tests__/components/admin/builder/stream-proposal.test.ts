// __tests__/components/admin/builder/stream-proposal.test.ts
//
// `proposal` is the third terminal event, and the one that carries the whole
// point of the Polish redesign: the reviewer has decided what it WOULD change
// and written nothing. Everything here is about the framing, not the UI — hand
// `readTurnStream` a hand-written body and assert what comes back.
//
// The trap this file exists to pin: `none` and a null proposal are different
// answers. `none` means the stream died and nothing is known; a null proposal
// means the reviewer read the page through and found nothing worth changing.
// Collapsing the second into the first would show the owner a "connection
// dropped" error on a review that completed perfectly.

import { describe, it, expect } from "vitest"
import { readTurnStream } from "@/components/admin/funnels/builder/stream"
import { encodeBuildStreamEvent, type BuildStreamEvent } from "@/lib/funnels/sections/build-stream"
import type { PolishProposal } from "@/components/admin/funnels/builder/types"

const DOC = {
  v: 1 as const,
  engine: "sections" as const,
  theme: { tone: "light" as const, accent: "accent" as const, radius: "soft" as const },
  sections: [{ id: "hero1", kind: "hero", variant: "centered", style: {}, props: { headline: "Polished" } }],
}

function proposal(overrides: Partial<PolishProposal> = {}): PolishProposal {
  return {
    baseRevision: 5,
    ops: [{ op: "update_section", id: "hero1", props: { headline: "Polished" } }],
    doc: DOC as PolishProposal["doc"],
    summary: "Tightened the hero and retoned one seam.",
    receipt: null,
    compile: { ok: true, problems: [], warnings: [] },
    unresolved: [],
    danglingAnchors: [],
    resolutionError: null,
    ...overrides,
  }
}

function sse(events: BuildStreamEvent[]): Response {
  return new Response(events.map(encodeBuildStreamEvent).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  })
}

describe("readTurnStream and the proposal event", () => {
  it("returns the proposal as the terminal outcome", async () => {
    const p = proposal()
    const outcome = await readTurnStream(sse([{ type: "phase", phase: "reviewing" }, { type: "proposal", proposal: p, summary: p.summary }]), () => {})

    expect(outcome.type).toBe("proposal")
    if (outcome.type !== "proposal") throw new Error("expected a proposal outcome")
    expect(outcome.proposal?.summary).toBe("Tightened the hero and retoned one seam.")
    expect(outcome.proposal?.baseRevision).toBe(5)
  })

  it("distinguishes 'nothing worth changing' from a dropped stream", async () => {
    // MUTANT: returning `{type:"none"}` for a null proposal. The owner would be
    // told the connection dropped on a review that finished cleanly, and would
    // press Polish again — paying for four more model calls to be told nothing
    // a second time.
    const outcome = await readTurnStream(
      sse([{ type: "proposal", proposal: null, summary: "I read the page through and found nothing worth changing." }]),
      () => {},
    )

    expect(outcome.type).toBe("proposal")
    if (outcome.type !== "proposal") throw new Error("expected a proposal outcome")
    expect(outcome.proposal).toBeNull()
    expect(outcome.summary).toBe("I read the page through and found nothing worth changing.")
  })

  it("still reports a stream that ended with no terminal event as none", async () => {
    // The negative half of the pair above. Without this, a mutant that returned
    // a null proposal for EVERY stream would pass the test above.
    const outcome = await readTurnStream(sse([{ type: "phase", phase: "reviewing" }]), () => {})
    expect(outcome.type).toBe("none")
  })

  it("does not let a proposal overwrite a result that already landed", async () => {
    // The server never sends both — the propose path has no build turn in front
    // of it. Pinned anyway: a wire contract held together only by the server
    // never doing something is one refactor away from being wrong, and the
    // failure mode is the owner losing a page that was genuinely written.
    const built = {
      revision: 6,
      doc: DOC,
      reply: "Drafted the page.",
      blocked: false,
      receipt: null,
      compile: { ok: true, problems: [], warnings: [] },
      unresolved: [],
      danglingAnchors: [],
      resolutionError: null,
      source: "ai" as const,
    }
    const outcome = await readTurnStream(
      sse([
        { type: "result", turn: built },
        { type: "proposal", proposal: proposal(), summary: "…" },
      ]),
      () => {},
    )

    expect(outcome.type).toBe("result")
    if (outcome.type !== "result") throw new Error("expected the result to win")
    expect(outcome.turn.revision).toBe(6)
  })

  it("does not hand the proposal to onEvent — nothing renders it mid-stream", async () => {
    // MUTANT: calling `onEvent(event)` for a proposal as well. The builder's
    // stream handler applies turns from events it is given; handing it a
    // terminal it is not expecting is how a proposal would get auto-applied,
    // which is the exact behaviour this whole feature removes.
    const seen: BuildStreamEvent["type"][] = []
    await readTurnStream(
      sse([
        { type: "phase", phase: "reviewing" },
        { type: "proposal", proposal: proposal(), summary: "…" },
      ]),
      (event) => seen.push(event.type),
    )

    expect(seen).toEqual(["phase"])
  })
})

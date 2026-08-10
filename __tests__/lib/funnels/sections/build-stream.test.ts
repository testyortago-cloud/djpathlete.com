// __tests__/lib/funnels/sections/build-stream.test.ts
//
// The wire format, round-tripped. The mutants that matter here are all about
// FRAMING: chunk boundaries fall wherever the network puts them, and a decoder
// that assumes one chunk is one frame works perfectly against a fake and drops
// half the events against a real connection.

import { describe, expect, it } from "vitest"
import {
  BUILD_PHASES,
  BUILD_PHASE_LABELS,
  BUILD_STREAM_HEARTBEAT,
  createBuildStreamDecoder,
  encodeBuildStreamEvent,
  type BuildStreamEvent,
} from "@/lib/funnels/sections/build-stream"

const EVENTS: BuildStreamEvent[] = [
  { type: "phase", phase: "reading" },
  { type: "section", section: { key: "0:0", op: "set_page", kind: "hero", id: null, variant: null, headline: null } },
  { type: "usage", outputTokens: 1840, exact: false },
  { type: "restart", attempt: 2 },
  { type: "result", turn: { revision: 6, reply: "Done." } },
]

describe("the build stream wire format", () => {
  it("round-trips every event type", () => {
    const decode = createBuildStreamDecoder()
    const decoded = decode(EVENTS.map(encodeBuildStreamEvent).join(""))
    expect(decoded).toEqual(EVENTS)
  })

  it("reassembles frames split at EVERY byte boundary", () => {
    // MUTANT: a stateless decoder — `chunk.split("\n\n").map(JSON.parse)`.
    // It passes against any fake that delivers whole frames and loses events
    // against a real socket, which is the worst possible place for the bug to
    // live: green suite, broken product.
    const wire = EVENTS.map(encodeBuildStreamEvent).join("")

    for (let cut = 1; cut < wire.length; cut++) {
      const decode = createBuildStreamDecoder()
      const decoded = [...decode(wire.slice(0, cut)), ...decode(wire.slice(cut))]
      expect(decoded).toEqual(EVENTS)
    }
  })

  it("reassembles a frame delivered one character at a time", () => {
    // The pathological case a slow connection produces.
    const wire = EVENTS.map(encodeBuildStreamEvent).join("")
    const decode = createBuildStreamDecoder()
    const decoded: BuildStreamEvent[] = []
    for (const character of wire) decoded.push(...decode(character))
    expect(decoded).toEqual(EVENTS)
  })

  it("ignores heartbeats without losing the frames around them", () => {
    // MUTANT: treating any non-empty line as data. The keep-alive comment would
    // then be parsed as JSON, throw, and — depending on where the throw lands —
    // take out the whole read.
    const decode = createBuildStreamDecoder()
    const wire =
      encodeBuildStreamEvent(EVENTS[0]) + BUILD_STREAM_HEARTBEAT + encodeBuildStreamEvent(EVENTS[4])
    expect(decode(wire)).toEqual([EVENTS[0], EVENTS[4]])
  })

  it("drops an unparseable frame and keeps reading", () => {
    // MUTANT: letting `JSON.parse` throw. A single corrupted progress frame
    // would cost the turn's `result`, which is the one event that matters.
    const decode = createBuildStreamDecoder()
    const decoded = decode(`data: {not json\n\n${encodeBuildStreamEvent(EVENTS[4])}`)
    expect(decoded).toEqual([EVENTS[4]])
  })

  it("holds an incomplete trailing frame instead of emitting half of it", () => {
    // MUTANT: emitting whatever is in the buffer at the end of a chunk. Half a
    // JSON object is not an event.
    const decode = createBuildStreamDecoder()
    expect(decode('data: {"type":"phase","ph')).toEqual([])
    expect(decode('ase":"writing"}\n\n')).toEqual([{ type: "phase", phase: "writing" }])
  })

  it("keeps every phase labelled", () => {
    // MUTANT: adding a phase to the tuple and forgetting the label, which
    // renders as `undefined` in the one line of this UI that is read aloud.
    for (const phase of BUILD_PHASES) {
      expect(BUILD_PHASE_LABELS[phase]).toBeTruthy()
    }
  })

  it("never emits a newline inside a frame's payload", () => {
    // MUTANT: hand-rolled serialisation, or a switch to a format that does not
    // escape newlines. A literal newline in the payload ends the frame early
    // and every subsequent frame is misaligned.
    const encoded = encodeBuildStreamEvent({
      type: "result",
      turn: { reply: "Line one\nline two\n\nline three" },
    })
    expect(encoded.endsWith("\n\n")).toBe(true)
    expect(encoded.slice(0, -2)).not.toContain("\n")
  })
})

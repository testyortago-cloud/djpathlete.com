// components/admin/funnels/builder/stream.ts — reading one build turn off the
// wire.
//
// Split out of `FunnelBuilder` so the framing can be tested without a browser,
// a component, or a real model: hand it a `Response` built over a hand-written
// body and assert what comes back. The component is then left holding only the
// decisions — what to draw, what to roll back — which is the part worth reading
// in a diff.

import { createBuildStreamDecoder, type BuildStreamEvent } from "@/lib/funnels/sections/build-stream"
import type { BuildErrorResponse, BuildTurnResponse, PolishProposal } from "./types"

/**
 * How a turn ended.
 *
 * `fail` deliberately carries an HTTP status and body rather than a message:
 * the caller feeds it to the SAME `handleErrorResponse` that handles pre-flight
 * failures, so a `stale_revision` behaves identically whether it arrived as a
 * 409 before the stream opened or as an event after it did. Flattening it to a
 * string here would quietly cost the revision resync.
 *
 * `none` means the stream ended without a terminal event — a dropped
 * connection, a killed function, a proxy closing an idle body. It is NOT
 * success and must never be treated as one: nothing is known about whether the
 * turn was written.
 */
export type TurnStreamOutcome =
  | { type: "result"; turn: BuildTurnResponse; review: BuildTurnResponse | null }
  /**
   * Polish finished and wrote NOTHING. `proposal: null` is the reviewer saying
   * it found nothing worth changing — a real, successful answer, and NOT the
   * same thing as `none` below. Conflating the two would report a clean review
   * as a dropped connection and invite the owner to pay for it twice.
   */
  | { type: "proposal"; proposal: PolishProposal | null; summary: string }
  | { type: "fail"; status: number; body: BuildErrorResponse | null }
  | { type: "none" }

/**
 * Drains `response.body`, handing progress events to `onEvent` and returning
 * the terminal one.
 *
 * The loop does NOT stop at the first terminal event. The server closes
 * immediately after writing it, so reading on costs nothing and draining the
 * body avoids leaving a half-read stream behind — and if a `result` were ever
 * followed by anything, the last terminal event legitimately wins.
 */
export async function readTurnStream(
  response: Response,
  onEvent: (event: BuildStreamEvent) => void,
): Promise<TurnStreamOutcome> {
  const body = response.body
  if (!body) return { type: "none" }

  const reader = body.getReader()
  const bytes = new TextDecoder()
  const decode = createBuildStreamDecoder()
  let outcome: TurnStreamOutcome = { type: "none" }

  const consume = (events: BuildStreamEvent[]) => {
    for (const event of events) {
      if (event.type === "result") {
        outcome = { type: "result", turn: event.turn as BuildTurnResponse, review: null }
        // Passed on as well as recorded. The review stage keeps this stream
        // open for another 30-40 seconds AFTER the page is written, so a caller
        // that only learned the outcome at the end would leave the owner
        // watching progress for a page that had already been saved.
        onEvent(event)
        continue
      }
      if (event.type === "review") {
        // Attached to the result rather than replacing it. Both turns are real
        // and both are in the transcript: the builder wrote a page, then the
        // reviewer changed it. A `review` arriving without a `result` before it
        // is the Polish path, which has no build turn of its own.
        if (outcome.type === "result") {
          outcome = { ...outcome, review: event.turn as BuildTurnResponse }
        } else {
          outcome = { type: "result", turn: event.turn as BuildTurnResponse, review: null }
        }
        onEvent(event)
        continue
      }
      if (event.type === "proposal") {
        // NOT passed to `onEvent`. The caller's event handler is what adopts
        // turns; handing it a terminal it does not expect is precisely how a
        // proposal would get auto-applied, which is the behaviour this feature
        // exists to remove. The proposal reaches the UI through the outcome,
        // once, after the stream is drained.
        //
        // A `result` already in hand WINS. The server never sends both — the
        // propose path has no build turn in front of it — but a contract held
        // together only by that is one refactor from losing a page that really
        // was written.
        if (outcome.type !== "result") {
          outcome = {
            type: "proposal",
            proposal: (event.proposal ?? null) as PolishProposal | null,
            summary: event.summary,
          }
        }
        continue
      }
      if (event.type === "fail") {
        outcome = { type: "fail", status: event.status, body: event.body as BuildErrorResponse | null }
        continue
      }
      onEvent(event)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // `stream: true` matters: a multi-byte character can be split across
      // chunk boundaries, and decoding each chunk in isolation would corrupt
      // any non-ASCII copy the model wrote — which, for a page builder whose
      // output is prose, is most turns with an em dash in them.
      consume(decode(bytes.decode(value, { stream: true })))
    }
    consume(decode(bytes.decode()))
  } finally {
    reader.releaseLock()
  }

  return outcome
}

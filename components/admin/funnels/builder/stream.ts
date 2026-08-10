// components/admin/funnels/builder/stream.ts — reading one build turn off the
// wire.
//
// Split out of `FunnelBuilder` so the framing can be tested without a browser,
// a component, or a real model: hand it a `Response` built over a hand-written
// body and assert what comes back. The component is then left holding only the
// decisions — what to draw, what to roll back — which is the part worth reading
// in a diff.

import { createBuildStreamDecoder, type BuildStreamEvent } from "@/lib/funnels/sections/build-stream"
import type { BuildErrorResponse, BuildTurnResponse } from "./types"

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
  | { type: "result"; turn: BuildTurnResponse }
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
        outcome = { type: "result", turn: event.turn as BuildTurnResponse }
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

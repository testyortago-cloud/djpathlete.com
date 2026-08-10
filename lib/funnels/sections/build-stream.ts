// lib/funnels/sections/build-stream.ts — the wire format for one streamed
// build turn.
//
// A leaf: types, an encoder and a decoder, and NOTHING else. It is imported by
// the route (server) and by the builder UI (client), so it must not reach for
// the Anthropic SDK, the database, or anything else that would follow it into
// a browser bundle. `builder-config.ts` learned this the expensive way — see
// the note on `FunnelBuilder.maxMessageLength`.

import type { StreamedSection } from "./stream-progress"

export type { StreamedSection }

/**
 * The four phases of a turn, in order. `checking` covers everything after the
 * model stops writing — applying the ops, resolving CTA refs against the real
 * catalogue, and compiling — which really is a distinct chunk of the wait and
 * really can fail on its own.
 */
export const BUILD_PHASES = ["reading", "planning", "writing", "checking"] as const
export type BuildPhase = (typeof BUILD_PHASES)[number]

export const BUILD_PHASE_LABELS: Record<BuildPhase, string> = {
  reading: "Reading your brief",
  planning: "Planning the page",
  writing: "Writing sections",
  checking: "Checking links and layout",
}

/**
 * One event on the wire.
 *
 * `result` and `fail` are TERMINAL and mutually exclusive: exactly one of them
 * ends a stream that opened at all.
 *
 * `fail` carries an HTTP `status` and the JSON `body` that a non-streaming
 * route would have returned. THAT IS THE WHOLE POINT OF IT. The failures that
 * can happen after the first byte is written — `appendTurn` losing the
 * compare-and-swap race on the assistant turn — are the same 409/404 the
 * client already knows how to handle, and a `stale_revision` that arrives as a
 * generic error string would silently lose the revision resync. So the client
 * hands `{status, body}` to the identical `handleErrorResponse` it uses for
 * pre-flight failures, and there is exactly one place that decides what a 409
 * means.
 */
export type BuildStreamEvent =
  | { type: "phase"; phase: BuildPhase }
  | { type: "section"; section: StreamedSection }
  /**
   * The output meter.
   *
   * `exact: false` is a LIVE COUNT OF TEXT-DELTA EVENTS, which is a close
   * proxy for tokens on the Anthropic provider (one delta per
   * `content_block_delta`) but is not the provider's own number. `exact: true`
   * arrives once, at `finish`, carrying `usage.outputTokens` as the provider
   * reports it.
   *
   * The flag exists so the UI can render "~1,840" while the stream is running
   * and "1,912" when it stops, instead of quietly presenting an estimate as a
   * measurement. A progress display whose whole selling point is that it shows
   * the real work has to be honest about the one number it is approximating.
   */
  | { type: "usage"; outputTokens: number; exact: boolean }
  /**
   * The model's first attempt was rejected and a second is starting. The UI
   * must CLEAR what it has drawn: attempt 2 rewrites the same page, so
   * appending its sections to attempt 1's would show a 16-section page that
   * has 8 sections.
   */
  | { type: "restart"; attempt: number }
  | { type: "result"; turn: unknown }
  | { type: "fail"; status: number; body: unknown }

/**
 * One event as an SSE frame.
 *
 * `JSON.stringify` escapes every newline it could produce, so the payload is
 * always a single line and the framing stays a plain `data:` + blank line. No
 * `event:` field — the discriminant lives inside the payload, so there is one
 * place to look rather than two that can disagree.
 */
export function encodeBuildStreamEvent(event: BuildStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * A keep-alive comment. Proxies and CDNs will happily hold a response open with
 * nothing in it for 30 seconds and then drop it; an SSE comment is ignored by
 * every consumer and resets that clock.
 */
export const BUILD_STREAM_HEARTBEAT = ": keep-alive\n\n"

/**
 * A stateful decoder, because chunk boundaries fall wherever the network puts
 * them — routinely mid-JSON, occasionally between the `data:` and its payload.
 * Feed it every chunk in order; it returns the events that completed in that
 * chunk and keeps the remainder for the next call.
 */
export function createBuildStreamDecoder(): (chunk: string) => BuildStreamEvent[] {
  let buffer = ""

  return function decode(chunk: string): BuildStreamEvent[] {
    buffer += chunk
    const events: BuildStreamEvent[] = []

    // Frames are separated by a blank line. Anything after the last separator
    // is an incomplete frame and stays in the buffer.
    let separator = buffer.indexOf("\n\n")
    while (separator !== -1) {
      const frame = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      separator = buffer.indexOf("\n\n")

      for (const line of frame.split("\n")) {
        // A comment — the heartbeat above, or anything a proxy injects.
        if (line.startsWith(":")) continue
        if (!line.startsWith("data:")) continue
        const payload = line.slice(5).trim()
        if (payload.length === 0) continue
        try {
          events.push(JSON.parse(payload) as BuildStreamEvent)
        } catch {
          // A frame we cannot parse is dropped rather than thrown. The turn's
          // outcome rides on the terminal `result`/`fail` event; losing a
          // progress frame costs a wireframe block, and taking the whole turn
          // down over one would be a far worse trade.
        }
      }
    }

    return events
  }
}

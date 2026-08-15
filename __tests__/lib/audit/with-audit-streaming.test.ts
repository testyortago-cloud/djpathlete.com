// __tests__/lib/audit/with-audit-streaming.test.ts
//
// `withAudit` awaited `resp.clone().json()` before returning the response.
// `clone()` TEES a stream rather than snapshotting it, so on a streaming route
// that promise does not settle until the last byte is written — and the
// wrapper held the whole Response until then. The client received nothing for
// the length of the turn and then every frame at once, which is
// indistinguishable from having no stream at all.
//
// THIS TEST IS TIMING-BASED ON PURPOSE, and it is the only shape that can
// catch it. Asserting "metadata was not called" would pass against a version
// that called it and blocked anyway; asserting on the returned body would pass
// too, because the body is eventually correct. The defect is WHEN the response
// is returned, so that is what is measured.
//
// No fake timers: `shouldAdvanceTime` starves `waitFor` in this repo and real
// millisecond gaps are exactly what is under test.

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { withAudit } from "@/lib/audit/with-audit"
import { recordAudit } from "@/lib/audit/record"

/** Milliseconds the fake turn keeps its stream open. */
const TURN_MS = 300

function streamingHandler() {
  return async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const encode = new TextEncoder()
          controller.enqueue(encode.encode("data: {\"type\":\"phase\",\"phase\":\"reading\"}\n\n"))
          setTimeout(() => {
            controller.enqueue(encode.encode("data: {\"type\":\"result\"}\n\n"))
            controller.close()
          }, TURN_MS)
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } },
    )
}

const metadata = vi.fn(async (_request: Request, response: Response) => {
  const body = (await response.json()) as { source?: string }
  return { mode: body.source ?? "unknown" }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("withAudit on a streaming route", () => {
  it("returns the response IMMEDIATELY, not when the stream closes", async () => {
    const wrapped = withAudit(
      { action: "funnel.ai_turn", category: "admin_write", metadata },
      streamingHandler() as never,
    )

    const started = Date.now()
    const response = await wrapped(new Request("http://x/api/thing", { method: "POST" }) as never, {} as never)
    const elapsed = Date.now() - started

    // Generous margin: the claim is "does not wait for the turn", not a
    // precise budget. Under the defect this was >= TURN_MS.
    expect(elapsed).toBeLessThan(TURN_MS / 2)
    expect(response.status).toBe(200)
  })

  it("does not call a metadata callback that would drain the body", async () => {
    const wrapped = withAudit(
      { action: "funnel.ai_turn", category: "admin_write", metadata },
      streamingHandler() as never,
    )

    await wrapped(new Request("http://x/api/thing", { method: "POST" }) as never, {} as never)

    expect(metadata).not.toHaveBeenCalled()
  })

  it("still records an audit row, marked as streamed", async () => {
    // The row must not silently vanish just because the body is unreadable —
    // an AI turn that spends real money has to leave a trace.
    const wrapped = withAudit(
      { action: "funnel.ai_turn", category: "admin_write", metadata },
      streamingHandler() as never,
    )

    await wrapped(new Request("http://x/api/thing", { method: "POST" }) as never, {} as never)

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "funnel.ai_turn", outcome: "success", metadata: { streamed: true } }),
    )
  })

  it("leaves the body intact for the real client to read", async () => {
    // The teed clone is gone, so nothing must have consumed the original.
    const wrapped = withAudit(
      { action: "funnel.ai_turn", category: "admin_write", metadata },
      streamingHandler() as never,
    )

    const response = await wrapped(new Request("http://x/api/thing", { method: "POST" }) as never, {} as never)
    const text = await response.text()

    expect(text).toContain('"phase":"reading"')
    expect(text).toContain('"type":"result"')
  })
})

describe("withAudit on an ordinary JSON route", () => {
  it("still reads metadata off the body", async () => {
    // The guard must be narrow. Skipping metadata on every route would strip
    // detail from every audit row in the app to fix one streaming endpoint.
    const jsonHandler = async () =>
      new Response(JSON.stringify({ source: "ai", revision: 7 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })

    const wrapped = withAudit(
      { action: "funnel.ai_turn", category: "admin_write", metadata },
      jsonHandler as never,
    )

    await wrapped(new Request("http://x/api/thing", { method: "POST" }) as never, {} as never)

    expect(metadata).toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { mode: "ai" } }))
  })

  it("still reads the error body off a JSON failure", async () => {
    const failing = async () =>
      new Response(JSON.stringify({ error: "Nope", code: "stale_revision" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      })

    const wrapped = withAudit({ action: "funnel.ai_turn", category: "admin_write" }, failing as never)

    await wrapped(new Request("http://x/api/thing", { method: "POST" }) as never, {} as never)

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failure", error: { code: "stale_revision", message: "Nope" } }),
    )
  })
})

// __tests__/lib/audit/with-audit-target-response.test.ts
//
// THE DEFECT THIS FILE EXISTS FOR (audit §4 #12): `funnel.updated` /
// `funnel.created` / `funnel.deleted` rows were logged with `target_id null`
// and `metadata {}` because a `TargetResolver` only ever saw `(request,
// context)` — for a route whose id lives in the BODY the handler just wrote
// (a created funnel has no dynamic segment to read an id from at all; an
// updated/deleted funnel's NAME lives only in the row the handler already
// touched), there was nothing to resolve a target from. This is what took
// Athlete Quiz offline on 2026-09-11 19:50 UTC without a row anyone could tie
// it to.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { withAudit } from "@/lib/audit/with-audit"
import { recordAudit } from "@/lib/audit/record"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** Same shape `with-audit-streaming.test.ts` uses for its streaming handler. */
function streamingHandler() {
  return async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"phase"}\n\n'))
          controller.close()
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } },
    )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("withAudit — target resolver receives the response", () => {
  it("resolves target from the handler's JSON body, and leaves the body intact for the caller", async () => {
    const target = vi.fn(async (_request: Request, _context: unknown, response?: Response) => {
      const body = (await response!.json()) as { funnel: { id: string; name: string } }
      return { type: "funnel", id: body.funnel.id, label: body.funnel.name }
    })

    const wrapped = withAudit(
      { action: "funnel.created", category: "admin_write", target },
      async () => jsonResponse({ funnel: { id: "f1", name: "Free Trial Week" } }, 201),
    )

    const response = await wrapped(new Request("http://x/api/thing", { method: "POST" }) as never, {
      params: Promise.resolve({}),
    })

    // MUTANT: passing no response (or an already-consumed one) to `target`.
    // Without a readable response the resolver above throws inside its own
    // try, `withAudit` swallows that into `target: undefined`, and this
    // assertion is the only thing that can tell the two apart.
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ target: { type: "funnel", id: "f1", label: "Free Trial Week" } }),
    )

    // The resolver must have been handed a CLONE: the real response returned
    // to the caller has to still have an intact, once-readable body.
    const body = await response.json()
    expect(body).toEqual({ funnel: { id: "f1", name: "Free Trial Week" } })
  })

  it("passes undefined to the target resolver for a streaming response", async () => {
    const target = vi.fn(async (_request: Request, _context: unknown, response?: Response) => {
      // MUTANT: cloning a streaming response instead of skipping it. Reading
      // `.json()` on a teed event-stream response never resolves the way a
      // JSON response does, so a resolver that tried would hang the whole
      // wrapper the same way the metadata callback used to (see
      // `with-audit-streaming.test.ts`).
      expect(response).toBeUndefined()
      return { type: "funnel", id: "irrelevant" }
    })

    const wrapped = withAudit({ action: "funnel.ai_turn", category: "admin_write", target }, streamingHandler())

    await wrapped(new Request("http://x/api/thing", { method: "POST" }) as never, { params: Promise.resolve({}) })

    expect(target).toHaveBeenCalledTimes(1)
  })

  it("still resolves target from (request, context) alone when the handler throws — response is undefined", async () => {
    const target = vi.fn(
      async (_request: Request, context: { params: Promise<Record<string, string>> }, response?: Response) => {
        // MUTANT: resolving target BEFORE the thrown check, so a throw never
        // reaches this resolver at all and the failure row has no target.
        expect(response).toBeUndefined()
        const { id } = await context.params
        return { type: "funnel", id }
      },
    )

    const wrapped = withAudit(
      { action: "funnel.updated", category: "admin_write", target },
      async () => {
        throw new Error("boom")
      },
    )

    await expect(
      wrapped(new Request("http://x/api/thing", { method: "PATCH" }) as never, {
        params: Promise.resolve({ id: "f1" }),
      }),
    ).rejects.toThrow("boom")

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failure", target: { type: "funnel", id: "f1" } }),
    )
  })

  it("an existing two-argument resolver keeps working unchanged", async () => {
    // PRESENCE CONTROL: every resolver in the app today reads only (request,
    // context). Widening the type must not force them to accept or use a
    // third argument.
    const target = vi.fn(async (_request: Request, context: { params: Promise<Record<string, string>> }) => {
      const { id } = await context.params
      return { type: "user", id }
    })

    const wrapped = withAudit(
      { action: "user.updated", category: "admin_write", target },
      async () => jsonResponse({ ok: true }),
    )

    await wrapped(new Request("http://x/api/thing", { method: "PATCH" }) as never, {
      params: Promise.resolve({ id: "u1" }),
    })

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ target: { type: "user", id: "u1" } }))
  })
})

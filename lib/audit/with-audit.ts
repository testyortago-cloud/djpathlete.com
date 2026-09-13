import { recordAudit } from "@/lib/audit/record"
import type { AuditCategory, AuditOutcome, AuditTarget } from "@/lib/audit/types"

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>

type TargetResolver =
  | AuditTarget
  | ((
      request: Request,
      context: { params: Promise<Record<string, string>> },
      /**
       * The handler's own response, cloned — OPTIONAL, and every existing
       * resolver in the app ignores it unchanged. It exists for a target that
       * only comes into being inside the handler: a CREATED row's id (no
       * dynamic segment names it), or an UPDATED/DELETED row's label, which
       * `ctx.params` can give an id for but never a name. `undefined` when
       * the handler threw (nothing to read) or the response is a stream (see
       * `isStreamingResponse` below — reading it here would hold the whole
       * response the same way the `metadata` callback used to).
       */
      response?: Response,
    ) => Promise<AuditTarget | undefined> | AuditTarget | undefined)

export interface WithAuditOptions {
  action: string
  category: AuditCategory
  /** Static target, or a function that resolves it after the request runs. */
  target?: TargetResolver
  /** Pull extra metadata after the handler finishes — receives request + response clone. */
  metadata?: (request: Request, response: Response) => Promise<Record<string, unknown>> | Record<string, unknown>
}

function classifyOutcome(status: number): AuditOutcome {
  if (status >= 200 && status < 300) return "success"
  if (status === 401 || status === 403) return "denied"
  return "failure"
}

/**
 * A response whose body is still being written when the handler returns.
 *
 * ---------------------------------------------------------------------------
 * READING ONE HERE HOLDS THE WHOLE RESPONSE UNTIL THE STREAM CLOSES.
 * ---------------------------------------------------------------------------
 * `resp.clone()` TEES the body — it does not snapshot it — so `clone.json()`
 * does not settle until the last byte is written, and this wrapper awaits it
 * BEFORE `return resp`. On a 60-second AI turn that means the client receives
 * nothing at all for 60 seconds and then every frame in one lump: the progress
 * UI sits on its first step for the whole turn and the stream might as well not
 * exist. Measured, not reasoned about — a Response over a stream that closes at
 * 1.5s makes `clone().json()` settle at 1517ms, and the caller unblocks at
 * 1518ms.
 *
 * A streaming route also has no JSON body to read, so there was never anything
 * to gain: `maybeReadError` would have thrown, and the metadata callback below
 * would have returned `{}` after paying the full delay for it.
 *
 * The funnel builder hit exactly this. `35944ac8` fixed one cause (a
 * `ReadableStream` whose `start()` returned a promise, so the stream never
 * started) and this was the second one behind it, still holding every frame.
 */
function isStreamingResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/event-stream")
}

/**
 * `x-audit-*` request->wrapper signalling headers (see `WithAuditOptions.metadata`
 * above — `x-audit-target-id`, `x-audit-quiet-hours-confirmed` and any future
 * one a route invents) are an INTERNAL channel from the handler to this
 * wrapper. Nothing about them is secret, but they are not meant for the
 * browser either — they are how a handler hands data to `metadata` without
 * threading a return value through `withAudit`. Strip them from the response
 * that actually leaves this wrapper.
 *
 * Call this ONLY after `metadata` has already read the headers off its own
 * clone: stripping first would delete the very data the callback exists to
 * read, and the audit row would lose it.
 */
const AUDIT_HEADER_PREFIX = "x-audit-"

function stripAuditHeaders(response: Response): void {
  for (const key of [...response.headers.keys()]) {
    if (key.toLowerCase().startsWith(AUDIT_HEADER_PREFIX)) {
      response.headers.delete(key)
    }
  }
}

async function maybeReadError(response: Response): Promise<{ code?: string; message?: string } | undefined> {
  if (response.ok) return undefined
  if (isStreamingResponse(response)) return { code: String(response.status) }
  try {
    const clone = response.clone()
    const body = (await clone.json()) as { error?: string; code?: string }
    return { code: body.code ?? String(response.status), message: body.error }
  } catch {
    return { code: String(response.status) }
  }
}

/**
 * Resolves `options.target`, handing a function resolver the response too —
 * see `TargetResolver`'s own comment for why. `response` is already the
 * caller's clone (or `undefined`); this function never clones anything
 * itself. A throwing or rejecting resolver degrades to `undefined` rather
 * than losing the whole audit row over a broken label lookup.
 */
async function resolveTarget(
  target: WithAuditOptions["target"],
  request: Request,
  context: { params: Promise<Record<string, string>> },
  response?: Response,
): Promise<AuditTarget | undefined> {
  if (typeof target !== "function") return target
  try {
    return (await target(request, context, response)) ?? undefined
  } catch {
    return undefined
  }
}

export function withAudit(options: WithAuditOptions, handler: Handler): Handler {
  return async (request, context) => {
    let response: Response | null = null
    let thrown: unknown = null
    try {
      response = await handler(request, context)
    } catch (err) {
      thrown = err
    }

    if (thrown) {
      // TARGET RESOLUTION HAPPENS HERE, AFTER THE THROW CHECK, ON PURPOSE:
      // there is no response to hand the resolver on this path (the handler
      // never produced one), so it resolves from `(request, context)` alone —
      // e.g. the id out of `ctx.params` — exactly as it did before this
      // function grew a third argument. Resolving target before this check
      // (the previous shape) would have been fine for THIS branch too, but it
      // meant a route whose target depends on the response could never be
      // reached from below without duplicating this call — hence the shared
      // `resolveTarget` helper instead of inlining the function-vs-static
      // check twice.
      const target = await resolveTarget(options.target, request, context)
      void recordAudit({
        action: options.action,
        category: options.category,
        outcome: "failure",
        target,
        request,
        error: { message: (thrown as Error)?.message },
      })
      throw thrown
    }

    const resp = response as Response
    const outcome = classifyOutcome(resp.status)
    const error = await maybeReadError(resp)

    // A CLONE, never `resp` itself — `resp` is what this wrapper eventually
    // returns to the real caller, and a resolver that read the original body
    // would leave nothing for them. Streaming gets `undefined` for the same
    // reason `metadata` below does: `.clone().json()` on an open
    // `text/event-stream` response tees the stream and does not settle until
    // it closes, holding the whole response hostage (see
    // `isStreamingResponse`'s own comment).
    const target = await resolveTarget(
      options.target,
      request,
      context,
      isStreamingResponse(resp) ? undefined : resp.clone(),
    )

    let extra: Record<string, unknown> = {}
    if (options.metadata) {
      if (isStreamingResponse(resp)) {
        // NOT called. See `isStreamingResponse`: a metadata callback that
        // reads the body would hold the entire response until the stream
        // closed, and there is no JSON body for it to find anyway. The row
        // says so rather than pretending the callback returned nothing.
        extra = { streamed: true }
      } else {
        try {
          extra = (await options.metadata(request, resp.clone())) ?? {}
        } catch {
          /* swallow */
        }
      }
    }

    void recordAudit({
      action: options.action,
      category: options.category,
      outcome,
      target,
      request,
      error: outcome === "success" ? undefined : error,
      metadata: extra,
    })
    // Metadata has already read whatever it needed off the headers above —
    // safe to strip them from the response the caller actually receives.
    stripAuditHeaders(resp)
    return resp
  }
}

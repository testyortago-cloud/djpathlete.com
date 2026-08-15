import { recordAudit } from "@/lib/audit/record"
import type {
  AuditCategory,
  AuditOutcome,
  AuditTarget,
} from "@/lib/audit/types"

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>

type TargetResolver =
  | AuditTarget
  | ((request: Request, context: { params: Promise<Record<string, string>> }) => Promise<AuditTarget | undefined> | AuditTarget | undefined)

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

async function maybeReadError(response: Response): Promise<{ code?: string; message?: string } | undefined> {
  if (response.ok) return undefined
  if (isStreamingResponse(response)) return { code: String(response.status) }
  try {
    const clone = response.clone()
    const body = await clone.json() as { error?: string; code?: string }
    return { code: body.code ?? String(response.status), message: body.error }
  } catch {
    return { code: String(response.status) }
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

    let target: AuditTarget | undefined
    if (typeof options.target === "function") {
      try {
        target = (await options.target(request, context)) ?? undefined
      } catch {
        target = undefined
      }
    } else {
      target = options.target
    }

    if (thrown) {
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
        } catch { /* swallow */ }
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
    return resp
  }
}

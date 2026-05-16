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

async function maybeReadError(response: Response): Promise<{ code?: string; message?: string } | undefined> {
  if (response.ok) return undefined
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
      try {
        extra = (await options.metadata(request, resp.clone())) ?? {}
      } catch { /* swallow */ }
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

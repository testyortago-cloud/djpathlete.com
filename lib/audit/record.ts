import { auth } from "@/lib/auth"
import { insertAuditLog } from "@/lib/db/audit-logs"
import { scrubMetadata } from "@/lib/audit/scrub"
import type {
  AuditCategory,
  AuditOutcome,
  AuditTarget,
  AuditActorRole,
} from "@/lib/audit/types"

export interface RecordAuditInput {
  action: string
  category: AuditCategory
  outcome?: AuditOutcome
  target?: AuditTarget
  error?: { code?: string; message?: string }
  metadata?: Record<string, unknown>
  request?: Request
  actor?: { id?: string | null; email?: string | null; role?: AuditActorRole | string }
  requestId?: string
}

function firstIp(forwarded: string | null): string | null {
  if (!forwarded) return null
  const first = forwarded.split(",")[0]?.trim()
  return first && first.length > 0 ? first : null
}

function pathFromRequest(req: Request): string | null {
  try {
    return new URL(req.url).pathname
  } catch {
    return null
  }
}

/**
 * Fire-and-forget audit recorder. Resolves actor from NextAuth unless overridden.
 * Never throws — errors are logged to console.warn so callers can drop it in
 * route handlers without try/catch noise.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    let actorId: string | null = null
    let actorEmail: string | null = null
    let actorRole: string | null = null

    if (input.actor) {
      actorId = input.actor.id ?? null
      actorEmail = input.actor.email ?? null
      actorRole = input.actor.role ?? null
    } else {
      const session = await auth()
      if (session?.user) {
        actorId = (session.user.id as string) ?? null
        actorEmail = session.user.email ?? null
        actorRole = (session.user.role as string) ?? null
      } else {
        actorRole = "anonymous"
      }
    }

    let ip: string | null = null
    let ua: string | null = null
    let method: string | null = null
    let path: string | null = null

    if (input.request) {
      ip = firstIp(input.request.headers.get("x-forwarded-for"))
        ?? input.request.headers.get("x-real-ip")
      ua = input.request.headers.get("user-agent")
      method = input.request.method
      path = pathFromRequest(input.request)
    }

    await insertAuditLog({
      action: input.action,
      category: input.category,
      outcome: input.outcome ?? "success",
      actor_id: actorId,
      actor_email: actorEmail,
      actor_role: actorRole as AuditActorRole | null,
      target_type: input.target?.type ?? null,
      target_id: input.target?.id ?? null,
      target_label: input.target?.label ?? null,
      ip_address: ip,
      user_agent: ua,
      request_id: input.requestId ?? null,
      request_method: method,
      request_path: path,
      error_code: input.error?.code ?? null,
      error_message: input.error?.message ?? null,
      metadata: scrubMetadata(input.metadata ?? {}),
    })
  } catch (err) {
    console.warn(`[audit] recordAudit(${input.action}) failed:`, (err as Error).message)
  }
}

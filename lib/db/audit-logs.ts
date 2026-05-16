import { createServiceRoleClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  AuditCategory,
  AuditLogRow,
  AuditOutcome,
  AuditActorRole,
} from "@/lib/audit/types"

function getClient(): SupabaseClient {
  return createServiceRoleClient()
}

export interface InsertAuditLogInput {
  action: string
  category: AuditCategory
  outcome?: AuditOutcome
  actor_id?: string | null
  actor_email?: string | null
  actor_role?: AuditActorRole | null
  target_type?: string | null
  target_id?: string | null
  target_label?: string | null
  ip_address?: string | null
  user_agent?: string | null
  request_id?: string | null
  request_method?: string | null
  request_path?: string | null
  error_code?: string | null
  error_message?: string | null
  metadata?: Record<string, unknown>
}

export async function insertAuditLog(input: InsertAuditLogInput): Promise<void> {
  const supabase = getClient()
  const row = {
    action: input.action,
    category: input.category,
    outcome: input.outcome ?? "success",
    actor_id: input.actor_id ?? null,
    actor_email: input.actor_email ?? null,
    actor_role: input.actor_role ?? null,
    target_type: input.target_type ?? null,
    target_id: input.target_id ?? null,
    target_label: input.target_label ?? null,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    request_id: input.request_id ?? null,
    request_method: input.request_method ?? null,
    request_path: input.request_path ?? null,
    error_code: input.error_code ?? null,
    error_message: input.error_message ?? null,
    metadata: input.metadata ?? {},
  }
  const { error } = await supabase.from("audit_logs").insert(row)
  if (error) {
    console.warn(`[audit_logs] insert failed: ${error.message}`)
  }
}

export interface ListAuditLogsFilters {
  category?: AuditCategory
  action?: string
  outcome?: AuditOutcome
  actor_id?: string
  target_type?: string
  target_id?: string
  from?: string  // ISO
  to?: string    // ISO
  q?: string     // free text over actor_email / target_label / error_message
  page: number
  perPage: number
}

export interface ListAuditLogsResult {
  rows: AuditLogRow[]
  total: number
}

export async function listAuditLogs(f: ListAuditLogsFilters): Promise<ListAuditLogsResult> {
  const supabase = getClient()
  const fromRow = (f.page - 1) * f.perPage
  const toRow = fromRow + f.perPage - 1

  let q = supabase.from("audit_logs").select("*", { count: "exact" })

  if (f.category) q = q.eq("category", f.category)
  if (f.action) q = q.eq("action", f.action)
  if (f.outcome) q = q.eq("outcome", f.outcome)
  if (f.actor_id) q = q.eq("actor_id", f.actor_id)
  if (f.target_type) q = q.eq("target_type", f.target_type)
  if (f.target_id) q = q.eq("target_id", f.target_id)
  if (f.from) q = q.gte("created_at", f.from)
  if (f.to) q = q.lte("created_at", f.to)
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`
    q = q.or(
      `actor_email.ilike.${like},target_label.ilike.${like},error_message.ilike.${like}`,
    )
  }

  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .range(fromRow, toRow)

  if (error) throw error
  return { rows: (data ?? []) as AuditLogRow[], total: count ?? 0 }
}

export async function pruneAuditLogs(days: number): Promise<number> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("audit_logs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff)
  if (error) throw error
  return count ?? 0
}

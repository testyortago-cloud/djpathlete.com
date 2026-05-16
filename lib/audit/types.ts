export type AuditCategory =
  | "auth"
  | "admin_write"
  | "admin_read_sensitive"
  | "client_action"
  | "support"
  | "commerce"
  | "billing"
  | "marketing"
  | "compliance"
  | "automation"
  | "system"

export type AuditOutcome = "success" | "failure" | "denied"

export type AuditActorRole = "admin" | "client" | "editor" | "system" | "anonymous"

export interface AuditTarget {
  type: string
  id: string
  label?: string
}

export interface AuditLogRow {
  id: string
  created_at: string
  actor_id: string | null
  actor_email: string | null
  actor_role: AuditActorRole | null
  action: string
  category: AuditCategory
  outcome: AuditOutcome
  target_type: string | null
  target_id: string | null
  target_label: string | null
  ip_address: string | null
  user_agent: string | null
  request_id: string | null
  request_method: string | null
  request_path: string | null
  error_code: string | null
  error_message: string | null
  metadata: Record<string, unknown>
}

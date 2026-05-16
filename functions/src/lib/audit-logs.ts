// Twin of lib/db/audit-logs.ts:pruneAuditLogs — kept in sync deliberately
// because functions/ has rootDir: "src" and can't import from lib/.
import type { SupabaseClient } from "@supabase/supabase-js"

export async function pruneAuditLogs(
  supabase: SupabaseClient,
  days: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("audit_logs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff)
  if (error) throw error
  return count ?? 0
}

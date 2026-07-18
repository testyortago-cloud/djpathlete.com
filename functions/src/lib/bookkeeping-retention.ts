// functions/src/lib/bookkeeping-retention.ts (Firebase-side twin)
// Twin of lib/db/bookkeeping.ts:pruneExpiredDocuments — kept in sync deliberately
// because functions/ has rootDir: "src" and can't import from lib/.
//
// Deletes the bucket object first (best-effort — errors are swallowed + warned so a
// missing/already-gone object doesn't block the row prune), then the row.
// bookkeeping_ledger_entries.document_id is ON DELETE SET NULL (migration 00186), so a
// linked ledger entry survives with its document_id nulled out.
import type { SupabaseClient } from "@supabase/supabase-js"

// Minimal shape of the firebase-admin/storage Bucket this needs — kept narrow so tests
// can pass a plain object instead of a real Bucket.
interface Bucket {
  file(path: string): { delete(opts: { ignoreNotFound: boolean }): Promise<unknown> }
}

export async function pruneExpiredDocuments(
  supabase: SupabaseClient,
  bucket: Bucket,
  today: string,
): Promise<{ deleted: number; ids: string[] }> {
  const ids: string[] = []
  // Paginate to dodge PostgREST's ~1000-row cap (see lib/db/paginate.ts's fetchAllRows).
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("bookkeeping_documents")
      .select("id, storage_path")
      .lt("retain_until", today)
      .range(from, from + 999)
    if (error) throw error
    const batch = (data ?? []) as Array<{ id: string; storage_path: string }>
    for (const r of batch) {
      try {
        await bucket.file(r.storage_path).delete({ ignoreNotFound: true })
      } catch (err) {
        console.warn(`[bookkeepingRetentionCron] object delete failed for ${r.storage_path}:`, err)
      }
      const { error: delErr } = await supabase.from("bookkeeping_documents").delete().eq("id", r.id)
      if (delErr) throw delErr
      ids.push(r.id)
    }
    if (batch.length < 1000) break
  }
  return { deleted: ids.length, ids }
}

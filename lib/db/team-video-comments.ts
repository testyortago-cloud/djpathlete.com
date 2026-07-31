import { createServiceRoleClient } from "@/lib/supabase"
import type { CommentAuthor, TeamVideoComment, UserRole } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createComment(input: {
  versionId: string
  authorId: string
  timecodeSeconds: number | null
  commentText: string
  /** When set, this comment is a reply to that parent. */
  parentId?: string | null
}): Promise<TeamVideoComment> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_comments")
    .insert({
      version_id: input.versionId,
      author_id: input.authorId,
      timecode_seconds: input.timecodeSeconds,
      comment_text: input.commentText,
      status: "open",
      parent_id: input.parentId ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoComment
}

export async function listCommentsForVersion(versionId: string): Promise<TeamVideoComment[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_comments")
    .select("*")
    .eq("version_id", versionId)
    .order("timecode_seconds", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as TeamVideoComment[]
}

/**
 * List EVERY comment on a submission, across all of its versions, ordered the
 * same way as the per-version list. Used so the comment thread keeps prior
 * cuts' notes visible after a new version is uploaded — matches the Frame.io /
 * Loom expectation where the conversation is one continuous record.
 *
 * Two queries (versions → comments) instead of a JOIN-by-FK so the call
 * doesn't depend on PostgREST embedding being configured for this relation.
 */
export async function listCommentsForSubmission(submissionId: string): Promise<TeamVideoComment[]> {
  const supabase = getClient()
  const { data: vRows, error: vErr } = await supabase
    .from("team_video_versions")
    .select("id")
    .eq("submission_id", submissionId)
  if (vErr) throw vErr
  const versionIds = (vRows ?? []).map((v) => (v as { id: string }).id)
  if (versionIds.length === 0) return []
  const { data, error } = await supabase
    .from("team_video_comments")
    .select("*")
    .in("version_id", versionIds)
    .order("timecode_seconds", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as TeamVideoComment[]
}

/**
 * Bulk-fetch author info (name + role) for a set of user ids. Returns a Map
 * keyed by user id. Empty input → empty map (no DB call).
 */
export async function listAuthorsForIds(userIds: string[]): Promise<Map<string, CommentAuthor>> {
  if (userIds.length === 0) return new Map()
  const supabase = getClient()
  const unique = Array.from(new Set(userIds))
  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name, role")
    .in("id", unique)
  if (error) throw error
  const map = new Map<string, CommentAuthor>()
  for (const row of (data ?? []) as Array<{
    id: string
    first_name: string
    last_name: string
    role: UserRole
  }>) {
    const name = `${row.first_name} ${row.last_name}`.trim() || "Unknown"
    map.set(row.id, { id: row.id, name, role: row.role })
  }
  return map
}

export async function getCommentById(id: string): Promise<TeamVideoComment | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_comments")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) {
    console.error("[getCommentById]", error)
    return null
  }
  return (data as TeamVideoComment | null) ?? null
}

export async function resolveComment(id: string, adminId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_comments")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: adminId,
    })
    .eq("id", id)
  if (error) throw error
}

export async function deleteComment(id: string): Promise<void> {
  const supabase = getClient()
  // team_video_annotations.comment_id has ON DELETE CASCADE so the
  // associated annotation row is removed automatically.
  const { error } = await supabase
    .from("team_video_comments")
    .delete()
    .eq("id", id)
  if (error) throw error
}

export async function reopenComment(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_comments")
    .update({
      status: "open",
      resolved_at: null,
      resolved_by: null,
    })
    .eq("id", id)
  if (error) throw error
}

/**
 * Open-note counts on each submission's CURRENT version, keyed by submission id.
 *
 * Powers the "notes not sent" flag on the admin list without an N+1. Scoped to
 * the current version deliberately — notes on a superseded cut have already
 * been seen and acted on, so counting them would flag healthy submissions.
 *
 * Two queries, not a JOIN, for the same reason as listCommentsForSubmission:
 * no dependency on PostgREST embedding for this relation.
 */
export async function countOpenNotesOnCurrentVersions(
  submissionIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (submissionIds.length === 0) return counts

  const supabase = getClient()
  const { data: vRows, error: vErr } = await supabase
    .from("team_video_versions")
    .select("id, submission_id, version_number")
    .in("submission_id", submissionIds)
  if (vErr) throw vErr

  // Highest version_number wins — the same "current version" rule as
  // getCurrentVersion(), so the list and the review page can't disagree.
  const currentBySubmission = new Map<string, { id: string; n: number }>()
  for (const row of (vRows ?? []) as Array<{
    id: string
    submission_id: string
    version_number: number
  }>) {
    const prev = currentBySubmission.get(row.submission_id)
    if (!prev || row.version_number > prev.n) {
      currentBySubmission.set(row.submission_id, { id: row.id, n: row.version_number })
    }
  }

  const versionIds = Array.from(currentBySubmission.values()).map((v) => v.id)
  if (versionIds.length === 0) return counts

  const { data: cRows, error: cErr } = await supabase
    .from("team_video_comments")
    .select("version_id")
    .in("version_id", versionIds)
    .eq("status", "open")
  if (cErr) throw cErr

  const perVersion = new Map<string, number>()
  for (const row of (cRows ?? []) as Array<{ version_id: string }>) {
    perVersion.set(row.version_id, (perVersion.get(row.version_id) ?? 0) + 1)
  }
  for (const [submissionId, current] of currentBySubmission) {
    counts.set(submissionId, perVersion.get(current.id) ?? 0)
  }
  return counts
}

export async function countOpenCommentsForVersion(versionId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("team_video_comments")
    .select("*", { count: "exact", head: true })
    .eq("version_id", versionId)
    .eq("status", "open")
  if (error) throw error
  return count ?? 0
}

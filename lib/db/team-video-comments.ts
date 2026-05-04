import { createServiceRoleClient } from "@/lib/supabase"
import type { TeamVideoComment } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createComment(input: {
  versionId: string
  authorId: string
  timecodeSeconds: number | null
  commentText: string
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

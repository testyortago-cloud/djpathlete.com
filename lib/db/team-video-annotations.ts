import { createServiceRoleClient } from "@/lib/supabase"
import type { DrawingJson, TeamVideoAnnotation } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createAnnotationForComment(
  commentId: string,
  drawing: DrawingJson,
): Promise<TeamVideoAnnotation> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_annotations")
    .insert({
      comment_id: commentId,
      drawing_json: drawing,
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoAnnotation
}

/**
 * Fetch annotations for many comments in one query and return them keyed
 * by comment_id. Empty input → empty map (no DB call).
 */
export async function listAnnotationsForCommentIds(
  commentIds: string[],
): Promise<Map<string, DrawingJson>> {
  if (commentIds.length === 0) return new Map()
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_annotations")
    .select("comment_id, drawing_json")
    .in("comment_id", commentIds)
  if (error) throw error
  const map = new Map<string, DrawingJson>()
  for (const row of (data ?? []) as Array<{ comment_id: string; drawing_json: DrawingJson }>) {
    map.set(row.comment_id, row.drawing_json)
  }
  return map
}

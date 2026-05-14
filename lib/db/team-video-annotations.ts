import { createServiceRoleClient } from "@/lib/supabase"
import type {
  DrawingJson,
  ImageIndexAnnotation,
  StoredAnnotation,
  TeamVideoAnnotation,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/**
 * Persist an annotation payload for a comment.
 *
 * The `drawing_json` column is a flexible jsonb that holds two shapes:
 *   - DrawingJson: `{ paths: [...] }` (no `kind` discriminator — legacy shape)
 *   - ImageIndexAnnotation: `{ kind: "image_index", index: number }`
 *
 * Readers distinguish the two via the presence of the `kind` field.
 */
export async function createAnnotationForComment(
  commentId: string,
  annotation: DrawingJson | ImageIndexAnnotation,
): Promise<TeamVideoAnnotation> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_annotations")
    .insert({
      comment_id: commentId,
      drawing_json: annotation,
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
): Promise<Map<string, StoredAnnotation>> {
  if (commentIds.length === 0) return new Map()
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_annotations")
    .select("comment_id, drawing_json")
    .in("comment_id", commentIds)
  if (error) throw error
  const map = new Map<string, StoredAnnotation>()
  for (const row of (data ?? []) as Array<{ comment_id: string; drawing_json: StoredAnnotation }>) {
    map.set(row.comment_id, row.drawing_json)
  }
  return map
}

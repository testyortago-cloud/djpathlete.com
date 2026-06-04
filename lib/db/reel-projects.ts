// lib/db/reel-projects.ts
// Data access for the in-app reel editor's per-(video, mode) snapshot. Service-
// role client (bypasses RLS; API routes gate on admin + feature flag). One row
// per (video_upload_id, mode), enforced by the unique index.
import { createServiceRoleClient } from "@/lib/supabase"
import type { ReelProject, ReelMode } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getReelProjectForVideo(
  videoUploadId: string,
  mode: ReelMode,
): Promise<ReelProject | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("reel_projects")
    .select("*")
    .eq("video_upload_id", videoUploadId)
    .eq("mode", mode)
    .maybeSingle()
  if (error) throw error
  return (data as ReelProject | null) ?? null
}

export interface UpsertReelProjectInput {
  videoUploadId: string
  mode: ReelMode
  props: Record<string, unknown>
  editedFields: string[]
}

export async function upsertReelProject(input: UpsertReelProjectInput): Promise<ReelProject> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("reel_projects")
    .upsert(
      {
        video_upload_id: input.videoUploadId,
        mode: input.mode,
        props: input.props,
        edited_fields: input.editedFields,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "video_upload_id,mode" },
    )
    .select()
    .single()
  if (error) throw error
  return data as ReelProject
}

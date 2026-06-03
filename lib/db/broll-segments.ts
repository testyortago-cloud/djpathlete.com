// lib/db/broll-segments.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { BrollSegment } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export type NewBrollSegment = Omit<BrollSegment, "id" | "created_at" | "updated_at">

export async function insertBrollSegments(rows: NewBrollSegment[]): Promise<BrollSegment[]> {
  if (rows.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase.from("broll_segments").insert(rows).select()
  if (error) throw error
  return data as BrollSegment[]
}

export async function getBrollSegmentsForVideo(videoUploadId: string): Promise<BrollSegment[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("broll_segments")
    .select("*")
    .eq("video_upload_id", videoUploadId)
    .order("segment_index", { ascending: true })
  if (error) throw error
  return (data ?? []) as BrollSegment[]
}

export async function getBrollSegmentsForJob(generationJobId: string): Promise<BrollSegment[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("broll_segments")
    .select("*")
    .eq("generation_job_id", generationJobId)
    .order("segment_index", { ascending: true })
  if (error) throw error
  return (data ?? []) as BrollSegment[]
}

export async function getBrollSegmentById(id: string): Promise<BrollSegment | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("broll_segments").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BrollSegment) ?? null
}

export async function updateBrollSegment(
  id: string,
  patch: Partial<Pick<BrollSegment, "status" | "media_asset_id" | "fal_request_id">>,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("broll_segments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

// Phase 3 per-window regenerate: re-prompt (recomputed cache_key), clear the old
// clip, and flip back to 'generating' so the fal webhook re-fills it.
export async function regenerateBrollSegment(
  id: string,
  patch: { prompt: string; cache_key: string; fal_request_id: string },
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("broll_segments")
    .update({
      prompt: patch.prompt,
      cache_key: patch.cache_key,
      fal_request_id: patch.fal_request_id,
      media_asset_id: null,
      status: "generating",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) throw error
}

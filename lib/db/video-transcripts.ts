// lib/db/video-transcripts.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { VideoTranscript } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function saveTranscript(
  transcript: Omit<VideoTranscript, "id" | "created_at">,
): Promise<VideoTranscript> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_transcripts")
    .insert(transcript)
    .select()
    .single()
  if (error) throw error
  return data as VideoTranscript
}

export async function getTranscriptForVideo(
  videoUploadId: string,
): Promise<VideoTranscript | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_transcripts")
    .select("*")
    .eq("video_upload_id", videoUploadId)
    .maybeSingle()
  if (error) throw error
  return (data as VideoTranscript | null) ?? null
}

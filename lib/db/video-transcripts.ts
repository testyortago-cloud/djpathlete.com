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

/**
 * Thin read helper that returns just the transcript text for a video upload.
 * Used by the quote-card generator, which only cares about the text payload.
 * Kept separate from `getTranscriptForVideo` so future callers don't over-read
 * the whole row when they only need the content column.
 */
export async function getTranscriptByVideoId(
  videoUploadId: string,
): Promise<{ transcript_text: string } | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_transcripts")
    .select("transcript_text")
    .eq("video_upload_id", videoUploadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { transcript_text: string } | null) ?? null
}

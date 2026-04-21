// lib/db/video-uploads.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { VideoUpload, VideoUploadStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createVideoUpload(
  upload: Omit<VideoUpload, "id" | "created_at" | "updated_at">,
): Promise<VideoUpload> {
  const supabase = getClient()
  const { data, error } = await supabase.from("video_uploads").insert(upload).select().single()
  if (error) throw error
  return data as VideoUpload
}

export async function getVideoUploadById(id: string): Promise<VideoUpload | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_uploads")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as VideoUpload | null) ?? null
}

export async function listVideoUploads(
  options: { limit?: number } = {},
): Promise<VideoUpload[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_uploads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50)
  if (error) throw error
  return (data ?? []) as VideoUpload[]
}

export async function deleteVideoUpload(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("video_uploads").delete().eq("id", id)
  if (error) throw error
}

export async function updateVideoUploadStatus(
  id: string,
  status: VideoUploadStatus,
): Promise<VideoUpload> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_uploads")
    .update({ status })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as VideoUpload
}

export async function updateVideoUpload(
  id: string,
  patch: Partial<Omit<VideoUpload, "id" | "created_at" | "updated_at">>,
): Promise<VideoUpload> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_uploads")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as VideoUpload
}

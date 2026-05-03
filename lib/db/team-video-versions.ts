import { createServiceRoleClient } from "@/lib/supabase"
import type { TeamVideoVersion } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createVersion(input: {
  submissionId: string
  versionNumber: number
  storagePath: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
}): Promise<TeamVideoVersion> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .insert({
      submission_id: input.submissionId,
      version_number: input.versionNumber,
      storage_path: input.storagePath,
      original_filename: input.originalFilename,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      status: "pending",
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoVersion
}

export async function getVersionById(id: string): Promise<TeamVideoVersion | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) {
    console.error("[getVersionById]", error)
    return null
  }
  return (data as TeamVideoVersion | null) ?? null
}

export async function getCurrentVersion(submissionId: string): Promise<TeamVideoVersion | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .select("*")
    .eq("submission_id", submissionId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error("[getCurrentVersion]", error)
    return null
  }
  return (data as TeamVideoVersion | null) ?? null
}

export async function listVersionsForSubmission(submissionId: string): Promise<TeamVideoVersion[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .select("*")
    .eq("submission_id", submissionId)
    .order("version_number", { ascending: true })
  if (error) throw error
  return (data ?? []) as TeamVideoVersion[]
}

export async function finalizeVersion(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_versions")
    .update({
      status: "uploaded",
      uploaded_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) throw error
}

export async function nextVersionNumber(submissionId: string): Promise<number> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .select("version_number")
    .eq("submission_id", submissionId)
    .order("version_number", { ascending: false })
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) return 1
  return (data[0] as { version_number: number }).version_number + 1
}

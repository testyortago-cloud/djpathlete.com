import { createServiceRoleClient } from "@/lib/supabase"
import type { TeamSubmissionImage } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface CreateImageInput {
  position: number
  storagePath: string
  originalFilename: string
  mimeType: "image/jpeg" | "image/png" | "image/webp"
  sizeBytes: number
  width?: number | null
  height?: number | null
}

export async function createImagesForVersion(
  versionId: string,
  images: CreateImageInput[],
): Promise<TeamSubmissionImage[]> {
  const supabase = getClient()
  const rows = images.map((img) => ({
    version_id: versionId,
    position: img.position,
    storage_path: img.storagePath,
    original_filename: img.originalFilename,
    mime_type: img.mimeType,
    size_bytes: img.sizeBytes,
    width: img.width ?? null,
    height: img.height ?? null,
  }))
  const { data, error } = await supabase
    .from("team_submission_images")
    .insert(rows)
    .select()
  if (error) throw error
  return (data ?? []) as TeamSubmissionImage[]
}

export async function listImagesForVersion(
  versionId: string,
): Promise<TeamSubmissionImage[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_submission_images")
    .select("*")
    .eq("version_id", versionId)
    .order("position", { ascending: true })
  if (error) throw error
  return (data ?? []) as TeamSubmissionImage[]
}

export async function deleteImagesForVersion(versionId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_submission_images")
    .delete()
    .eq("version_id", versionId)
  if (error) throw error
}

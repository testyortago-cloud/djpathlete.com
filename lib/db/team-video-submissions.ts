import { createServiceRoleClient } from "@/lib/supabase"
import type {
  TeamVideoSubmission,
  TeamVideoSubmissionKind,
  TeamVideoSubmissionStatus,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createSubmission(input: {
  title: string
  description?: string | null
  submittedBy: string
  kind?: TeamVideoSubmissionKind
}): Promise<TeamVideoSubmission> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .insert({
      title: input.title,
      description: input.description ?? null,
      submitted_by: input.submittedBy,
      kind: input.kind ?? "video",
      status: "draft" as TeamVideoSubmissionStatus,
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoSubmission
}

export async function getSubmissionById(id: string): Promise<TeamVideoSubmission | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) {
    console.error("[getSubmissionById]", error)
    return null
  }
  return (data as TeamVideoSubmission | null) ?? null
}

export async function listSubmissionsForEditor(editorId: string): Promise<TeamVideoSubmission[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .select("*")
    .eq("submitted_by", editorId)
    .order("updated_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as TeamVideoSubmission[]
}

export async function listAllSubmissions(): Promise<TeamVideoSubmission[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .select("*")
    .order("updated_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as TeamVideoSubmission[]
}

export async function setSubmissionStatus(
  id: string,
  status: TeamVideoSubmissionStatus,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({ status })
    .eq("id", id)
  if (error) throw error
}

export async function setCurrentVersion(
  submissionId: string,
  versionId: string,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({ current_version_id: versionId })
    .eq("id", submissionId)
  if (error) throw error
}

export async function approveSubmission(
  submissionId: string,
  adminId: string,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({
      status: "approved" as TeamVideoSubmissionStatus,
      approved_at: new Date().toISOString(),
      approved_by: adminId,
    })
    .eq("id", submissionId)
  if (error) throw error
}

export async function lockSubmission(submissionId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({
      status: "locked" as TeamVideoSubmissionStatus,
      locked_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
  if (error) throw error
}

export async function reopenSubmission(submissionId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({
      status: "revision_requested" as TeamVideoSubmissionStatus,
      approved_at: null,
      approved_by: null,
    })
    .eq("id", submissionId)
  if (error) throw error
}

export async function countSubmissionsByStatus(
  status: TeamVideoSubmissionStatus,
): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("team_video_submissions")
    .select("*", { count: "exact", head: true })
    .eq("status", status)
  if (error) throw error
  return count ?? 0
}

export interface CurrentVersionThumb {
  id: string
  thumbnail_path: string | null
  kind: string | null
}

/**
 * submissionId → its current version's id/thumbnail/kind.
 *
 * Two plain queries, deliberately no PostgREST embed. There are two FKs
 * between these tables in opposite directions (`fk_current_version`:
 * submissions.current_version_id → versions.id, and
 * `team_video_versions_submission_id_fkey`: versions.submission_id →
 * submissions.id) — an embed across that ambiguous pair needs a
 * disambiguation hint, and a wrong one fails at RUNTIME with a PGRST error,
 * not at compile time, so tsc and a mocked unit test both stay green while
 * the page 500s.
 */
export async function listCurrentVersionsForSubmissions(
  submissionIds: string[],
): Promise<Map<string, CurrentVersionThumb>> {
  const out = new Map<string, CurrentVersionThumb>()
  if (submissionIds.length === 0) return out

  const supabase = getClient()
  const { data: subRows, error: subError } = await supabase
    .from("team_video_submissions")
    .select("id, kind, current_version_id")
    .in("id", submissionIds)
  if (subError) throw subError

  const submissions = (subRows ?? []) as Array<{
    id: string
    kind: string | null
    current_version_id: string | null
  }>

  const versionIds = Array.from(
    new Set(
      submissions
        .map((row) => row.current_version_id)
        .filter((id): id is string => id !== null),
    ),
  )
  if (versionIds.length === 0) return out

  const { data: versionRows, error: versionError } = await supabase
    .from("team_video_versions")
    .select("id, thumbnail_path")
    .in("id", versionIds)
  if (versionError) throw versionError

  const versionById = new Map(
    ((versionRows ?? []) as Array<{ id: string; thumbnail_path: string | null }>).map(
      (v) => [v.id, v] as const,
    ),
  )

  for (const row of submissions) {
    if (!row.current_version_id) continue
    const version = versionById.get(row.current_version_id)
    if (!version) continue
    out.set(row.id, {
      id: version.id,
      thumbnail_path: version.thumbnail_path,
      kind: row.kind,
    })
  }
  return out
}

/**
 * submissionId → storage_path of the position-0 image on its current version.
 *
 * Same two-query shape as `listCurrentVersionsForSubmissions`, for the same
 * ambiguous-embed reason: resolve each submission's current version id first,
 * then look up its first image.
 */
export async function listFirstImageForSubmissions(
  submissionIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (submissionIds.length === 0) return out

  const supabase = getClient()
  const { data: subRows, error: subError } = await supabase
    .from("team_video_submissions")
    .select("id, current_version_id")
    .in("id", submissionIds)
  if (subError) throw subError

  const submissions = (subRows ?? []) as Array<{
    id: string
    current_version_id: string | null
  }>

  const versionIds = Array.from(
    new Set(
      submissions
        .map((row) => row.current_version_id)
        .filter((id): id is string => id !== null),
    ),
  )
  if (versionIds.length === 0) return out

  const { data: imageRows, error: imageError } = await supabase
    .from("team_submission_images")
    .select("version_id, storage_path")
    .in("version_id", versionIds)
    .eq("position", 0)
  if (imageError) throw imageError

  const pathByVersion = new Map(
    ((imageRows ?? []) as Array<{ version_id: string; storage_path: string }>).map(
      (r) => [r.version_id, r.storage_path] as const,
    ),
  )

  for (const row of submissions) {
    if (!row.current_version_id) continue
    const path = pathByVersion.get(row.current_version_id)
    if (path) out.set(row.id, path)
  }
  return out
}

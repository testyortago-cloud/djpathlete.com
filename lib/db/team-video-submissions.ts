import { createServiceRoleClient } from "@/lib/supabase"
import type {
  TeamVideoSubmission,
  TeamVideoSubmissionStatus,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createSubmission(input: {
  title: string
  description?: string | null
  submittedBy: string
}): Promise<TeamVideoSubmission> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .insert({
      title: input.title,
      description: input.description ?? null,
      submitted_by: input.submittedBy,
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

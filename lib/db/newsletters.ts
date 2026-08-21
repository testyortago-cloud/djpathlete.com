import { createServiceRoleClient } from "@/lib/supabase"
import type { Newsletter } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getNewsletters(): Promise<Newsletter[]> {
  const supabase = getClient()
  const { data, error } = await supabase.from("newsletters").select("*").order("created_at", { ascending: false })
  if (error) throw error
  return data as Newsletter[]
}

export async function getNewsletterById(id: string): Promise<Newsletter> {
  const supabase = getClient()
  const { data, error } = await supabase.from("newsletters").select("*").eq("id", id).single()
  if (error) throw error
  return data as Newsletter
}

export async function createNewsletter(
  newsletter: Omit<
    Newsletter,
    | "id" | "created_at" | "updated_at" | "sent_at" | "sent_count" | "failed_count"
    | "scheduled_at" | "schedule_failed_reason"
  >,
): Promise<Newsletter> {
  const supabase = getClient()
  const { data, error } = await supabase.from("newsletters").insert(newsletter).select().single()
  if (error) throw error
  return data as Newsletter
}

export async function updateNewsletter(
  id: string,
  updates: Partial<Omit<Newsletter, "id" | "created_at">>,
): Promise<Newsletter> {
  const supabase = getClient()
  const { data, error } = await supabase.from("newsletters").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as Newsletter
}

export async function deleteNewsletter(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("newsletters").delete().eq("id", id)
  if (error) throw error
}

/** Rows the scheduled-content checker considers. Ordered oldest-first. */
export async function listScheduledNewsletters(): Promise<Newsletter[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("newsletters")
    .select("*")
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true })
  if (error) throw error
  return data as Newsletter[]
}

export async function createDraftFromBlog(params: {
  subject: string
  previewText: string
  content: string
  sourceBlogPostId: string
  authorId: string
}): Promise<Newsletter> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("newsletters")
    .insert({
      subject: params.subject,
      preview_text: params.previewText,
      content: params.content,
      source_blog_post_id: params.sourceBlogPostId,
      author_id: params.authorId,
      status: "draft",
    })
    .select()
    .single()
  if (error) throw error
  return data as Newsletter
}

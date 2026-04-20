// lib/db/social-captions.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialCaption } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function addCaptionToPost(
  caption: Omit<SocialCaption, "id" | "created_at">,
): Promise<SocialCaption> {
  const supabase = getClient()
  const { data, error } = await supabase.from("social_captions").insert(caption).select().single()
  if (error) throw error
  return data as SocialCaption
}

export async function listCaptionsForPost(socialPostId: string): Promise<SocialCaption[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_captions")
    .select("*")
    .eq("social_post_id", socialPostId)
    .order("version", { ascending: true })
  if (error) throw error
  return (data ?? []) as SocialCaption[]
}

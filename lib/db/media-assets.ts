// lib/db/media-assets.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { MediaAsset } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export type CreateMediaAssetInput = Omit<MediaAsset, "id" | "created_at" | "updated_at">

export async function createMediaAsset(input: CreateMediaAssetInput): Promise<MediaAsset> {
  const supabase = getClient()
  const { data, error } = await supabase.from("media_assets").insert(input).select().single()
  if (error) throw error
  return data as MediaAsset
}

export async function getMediaAssetById(id: string): Promise<MediaAsset | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("media_assets")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as MediaAsset | null) ?? null
}

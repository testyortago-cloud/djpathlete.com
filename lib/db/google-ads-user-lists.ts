// lib/db/google-ads-user-lists.ts
// DAL for Customer Match user lists. Two tables: the admin-configured
// list-to-Google-Ads-resource map, and the local mirror of which email
// hashes we believe are currently in each list (so the sync engine can
// compute precise add/remove deltas).

import { createServiceRoleClient } from "@/lib/supabase"
import type {
  GoogleAdsAudienceType,
  GoogleAdsUserList,
  GoogleAdsUserListMember,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listUserLists(): Promise<GoogleAdsUserList[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_user_lists")
    .select("*")
    .order("audience_type")
  if (error) throw error
  return (data ?? []) as GoogleAdsUserList[]
}

export async function listActiveUserLists(): Promise<GoogleAdsUserList[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_user_lists")
    .select("*")
    .eq("is_active", true)
    .order("audience_type")
  if (error) throw error
  return (data ?? []) as GoogleAdsUserList[]
}

export interface UpsertUserListInput {
  customer_id: string
  user_list_id: string
  name: string
  audience_type: GoogleAdsAudienceType
  is_active?: boolean
}

export async function upsertUserList(input: UpsertUserListInput): Promise<GoogleAdsUserList> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_user_lists")
    .upsert(
      {
        customer_id: input.customer_id,
        user_list_id: input.user_list_id,
        name: input.name,
        audience_type: input.audience_type,
        is_active: input.is_active ?? true,
      },
      { onConflict: "customer_id,audience_type" },
    )
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsUserList
}

export async function deleteUserList(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("google_ads_user_lists").delete().eq("id", id)
  if (error) throw error
}

export async function setUserListSyncResult(
  id: string,
  result: { last_error?: string | null; member_count?: number },
): Promise<void> {
  const supabase = getClient()
  const update: Record<string, unknown> = {
    last_synced_at: new Date().toISOString(),
    last_error: result.last_error ?? null,
  }
  if (result.member_count !== undefined) update.member_count = result.member_count
  const { error } = await supabase
    .from("google_ads_user_lists")
    .update(update)
    .eq("id", id)
  if (error) throw error
}

export async function listUserListMemberHashes(userListId: string): Promise<Set<string>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_user_list_members")
    .select("email_hash")
    .eq("user_list_id", userListId)
  if (error) throw error
  return new Set(((data ?? []) as Array<{ email_hash: string }>).map((r) => r.email_hash))
}

export interface UserListMemberDelta {
  /** SHA-256 hex hashes the engine intends to push as additions or removals. */
  email_hash: string
  email_normalized: string
}

export async function insertUserListMembers(
  userListId: string,
  members: UserListMemberDelta[],
): Promise<number> {
  if (members.length === 0) return 0
  const supabase = getClient()
  const payload = members.map((m) => ({
    user_list_id: userListId,
    email_hash: m.email_hash,
    email_normalized: m.email_normalized,
  }))
  let inserted = 0
  for (let i = 0; i < payload.length; i += 500) {
    const batch = payload.slice(i, i + 500)
    const { error, count } = await supabase
      .from("google_ads_user_list_members")
      .insert(batch, { count: "exact" })
    if (error) {
      // 23505 = unique violation; happens if the same hash exists already
      // (delta computation should prevent this but guard anyway).
      if (error.code !== "23505") throw error
    } else {
      inserted += count ?? batch.length
    }
  }
  return inserted
}

export async function deleteUserListMembers(
  userListId: string,
  emailHashes: string[],
): Promise<number> {
  if (emailHashes.length === 0) return 0
  const supabase = getClient()
  let deleted = 0
  // Chunk the IN clause to avoid ridiculously large queries.
  for (let i = 0; i < emailHashes.length; i += 500) {
    const batch = emailHashes.slice(i, i + 500)
    const { error, count } = await supabase
      .from("google_ads_user_list_members")
      .delete({ count: "exact" })
      .eq("user_list_id", userListId)
      .in("email_hash", batch)
    if (error) throw error
    deleted += count ?? 0
  }
  return deleted
}

export async function listUserListMembers(
  userListId: string,
  limit: number = 100,
): Promise<GoogleAdsUserListMember[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_user_list_members")
    .select("*")
    .eq("user_list_id", userListId)
    .order("added_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as GoogleAdsUserListMember[]
}

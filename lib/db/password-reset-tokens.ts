import { createServiceRoleClient } from "@/lib/supabase"
import { randomBytes } from "crypto"

function getClient() {
  return createServiceRoleClient()
}

export async function createPasswordResetToken(userId: string, expiresInHours = 24) {
  const supabase = getClient()
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()

  // Asking again must not kill the link already in the inbox: people tap
  // "send" twice and open the first email. Re-send the live link instead,
  // pushing its expiry out but never cutting a longer one (a 7-day invite) short.
  const { data: live, error: liveError } = await supabase
    .from("password_reset_tokens")
    .select("id, token, expires_at")
    .eq("user_id", userId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (liveError) throw liveError
  if (live) {
    if (Date.parse(live.expires_at) < Date.parse(expiresAt)) {
      const { error } = await supabase.from("password_reset_tokens").update({ expires_at: expiresAt }).eq("id", live.id)
      if (error) throw error
    }
    return live.token as string
  }

  // Only dead links are left at this point; clear them.
  await supabase.from("password_reset_tokens").delete().eq("user_id", userId).is("used_at", null)

  const token = randomBytes(32).toString("hex")

  const { data, error } = await supabase
    .from("password_reset_tokens")
    .insert({ user_id: userId, token, expires_at: expiresAt })
    .select()
    .single()

  if (error) throw error
  return data.token as string
}

export async function validatePasswordResetToken(token: string) {
  const supabase = getClient()

  const { data, error } = await supabase
    .from("password_reset_tokens")
    .select("*, users(id, email, first_name)")
    .eq("token", token)
    .is("used_at", null)
    .single()

  if (error || !data) return null

  // Check expiration
  if (new Date(data.expires_at) < new Date()) return null

  return data
}

export async function markTokenUsed(token: string) {
  const supabase = getClient()

  const { error } = await supabase
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token)

  if (error) throw error
}

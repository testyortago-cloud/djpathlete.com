import { createServiceRoleClient } from "@/lib/supabase"
import { randomBytes } from "crypto"

function getClient() {
  return createServiceRoleClient()
}

export async function createEmailVerificationToken(userId: string) {
  const supabase = getClient()
  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours

  // Invalidate any existing unused tokens for this user
  await supabase
    .from("email_verification_tokens")
    .delete()
    .eq("user_id", userId)
    .is("used_at", null)

  const { data, error } = await supabase
    .from("email_verification_tokens")
    .insert({ user_id: userId, token, expires_at: expiresAt })
    .select()
    .single()

  if (error) throw error
  return data.token as string
}

export async function validateEmailVerificationToken(token: string) {
  const supabase = getClient()

  const { data, error } = await supabase
    .from("email_verification_tokens")
    .select("*, users(id, email, first_name)")
    .eq("token", token)
    .is("used_at", null)
    .single()

  if (error || !data) return null

  // Check expiration
  if (new Date(data.expires_at) < new Date()) return null

  return data
}

export async function markVerificationTokenUsed(token: string) {
  const supabase = getClient()

  const { error } = await supabase
    .from("email_verification_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token)

  if (error) throw error
}

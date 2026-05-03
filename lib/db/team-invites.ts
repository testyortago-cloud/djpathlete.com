import { randomBytes } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import type { TeamInvite, TeamInviteRole, TeamInviteStatus } from "@/types/database"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getClient() {
  return createServiceRoleClient()
}

export function generateInviteToken(): string {
  // 24 random bytes -> 32 base64url chars (no padding)
  return randomBytes(24).toString("base64url")
}

export async function createInvite(input: {
  email: string
  role: TeamInviteRole
  invitedBy: string
}): Promise<TeamInvite> {
  const supabase = getClient()
  const token = generateInviteToken()
  const expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from("team_invites")
    .insert({
      email: input.email.toLowerCase().trim(),
      role: input.role,
      token,
      invited_by: input.invitedBy,
      expires_at,
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamInvite
}

export async function getInviteByToken(token: string): Promise<TeamInvite | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_invites")
    .select("*")
    .eq("token", token)
    .single()
  if (error) return null
  return data as TeamInvite
}

export async function getInviteById(id: string): Promise<TeamInvite | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_invites")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data as TeamInvite
}

export async function listInvites(): Promise<TeamInvite[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_invites")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as TeamInvite[]
}

export async function markInviteUsed(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

/** Revoke = expire immediately. Keeps the row for audit. */
export async function revokeInvite(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_invites")
    .update({ expires_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

/** Resend = rotate token + extend expiry. Returns the new token for emailing. */
export async function rotateInviteToken(id: string): Promise<{ token: string; expiresAt: string }> {
  const supabase = getClient()
  const token = generateInviteToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  const { error } = await supabase
    .from("team_invites")
    .update({ token, expires_at: expiresAt, used_at: null })
    .eq("id", id)
  if (error) throw error
  return { token, expiresAt }
}

export function inviteStatus(invite: TeamInvite): TeamInviteStatus {
  if (invite.used_at) return "accepted"
  const now = Date.now()
  const expires = new Date(invite.expires_at).getTime()
  if (expires <= now) return "expired"
  return "pending"
}

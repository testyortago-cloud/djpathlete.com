import { randomBytes } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import type { PermissionMap } from "@/lib/permissions/registry"
import { roleForPermissions, sanitizePermissionMap } from "@/lib/permissions/registry"
import type { TeamInvite } from "@/types/database"
import type { BusinessMemberRole } from "@/lib/db/business-members"

export { inviteStatus } from "@/lib/team-invites/status"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getClient() {
  return createServiceRoleClient()
}

export function generateInviteToken(): string {
  // 24 random bytes -> 32 base64url chars (no padding)
  return randomBytes(24).toString("base64url")
}

/**
 * The invited role is derived from the permissions, not taken from the caller,
 * so an invite and a later permissions edit can never disagree about what
 * "video editor" means. An invite that grants nothing is an editor-portal
 * invite; ticking anything makes it a staff invite.
 *
 * This also closes the case where a "Custom" invite was sent with nothing
 * ticked: it used to create a staff user whose first sight of the app was
 * `/admin/no-access`.
 */
export async function createInvite(input: {
  email: string
  invitedBy: string
  /** Already sanitized by the validator; re-sanitized here so the DAL is safe on its own. */
  permissions?: PermissionMap
  staffRole?: string | null
  /** Names the business a coach/staff invite grants membership to. Null is a plain platform-staff invite. */
  businessId?: string | null
  /** business_members.role the accept path will grant. Ignored when businessId is null. */
  businessRole?: BusinessMemberRole | null
}): Promise<TeamInvite> {
  const supabase = getClient()
  const token = generateInviteToken()
  const expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  const permissions = sanitizePermissionMap(input.permissions ?? {})
  const role = roleForPermissions(permissions)

  const { data, error } = await supabase
    .from("team_invites")
    .insert({
      email: input.email.toLowerCase().trim(),
      role,
      token,
      invited_by: input.invitedBy,
      expires_at,
      permissions,
      // A preset label on an editor invite would describe access they don't have.
      staff_role: role === "staff" ? (input.staffRole ?? null) : null,
      business_id: input.businessId ?? null,
      business_role: input.businessId ? (input.businessRole ?? null) : null,
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


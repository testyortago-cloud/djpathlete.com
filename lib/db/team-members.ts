import { createServiceRoleClient } from "@/lib/supabase"
import { sanitizePermissionMap, type PermissionMap } from "@/lib/permissions/registry"
import type { User } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface TeamMember {
  id: string
  email: string
  first_name: string
  last_name: string
  /** `staff` reaches the admin panel; `editor` only reaches the /editor portal. */
  role: "staff" | "editor"
  status: string
  staff_role: string | null
  permissions: PermissionMap
  created_at: string
  /** How many clients this member has been assigned. */
  assigned_client_count: number
}

const MEMBER_COLUMNS = "id, email, first_name, last_name, role, status, staff_role, permissions, created_at"

/** Roles that represent a person on the team, as opposed to a client or the owner. */
const TEAM_ROLES = ["staff", "editor"] as const

/**
 * Everyone who works for Darren: admin-panel staff AND video editors.
 *
 * Editors are included deliberately — they have real access (the /editor
 * portal), so leaving them out made accepted editor invites vanish from
 * Members while sitting uselessly in the Invites table.
 */
export async function listTeamMembers(): Promise<TeamMember[]> {
  const supabase = getClient()

  const { data, error } = await supabase
    .from("users")
    .select(MEMBER_COLUMNS)
    .in("role", TEAM_ROLES)
    .order("created_at", { ascending: false })
  if (error) throw error

  const members = (data ?? []) as unknown as Omit<TeamMember, "assigned_client_count">[]
  if (members.length === 0) return []

  const { data: assignments, error: assignError } = await supabase
    .from("team_member_clients")
    .select("staff_user_id")
    .in(
      "staff_user_id",
      members.map((m) => m.id),
    )
  if (assignError) throw assignError

  const counts = new Map<string, number>()
  for (const row of (assignments ?? []) as { staff_user_id: string }[]) {
    counts.set(row.staff_user_id, (counts.get(row.staff_user_id) ?? 0) + 1)
  }

  return members.map((m) => ({
    ...m,
    permissions: sanitizePermissionMap(m.permissions),
    assigned_client_count: counts.get(m.id) ?? 0,
  }))
}

export async function getTeamMember(id: string): Promise<TeamMember | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("users")
    .select(MEMBER_COLUMNS)
    .eq("id", id)
    .in("role", TEAM_ROLES)
    .single()
  if (error || !data) return null

  const member = data as unknown as Omit<TeamMember, "assigned_client_count">
  const { count } = await supabase
    .from("team_member_clients")
    .select("client_id", { count: "exact", head: true })
    .eq("staff_user_id", id)

  return {
    ...member,
    permissions: sanitizePermissionMap(member.permissions),
    assigned_client_count: count ?? 0,
  }
}

export async function updateMemberPermissions(
  id: string,
  permissions: PermissionMap,
  staffRole: string | null,
): Promise<User> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("users")
    .update({ permissions, staff_role: staffRole })
    .eq("id", id)
    .eq("role", "staff") // never let this widen a client's or the owner's access
    .select()
    .single()
  if (error) throw error
  return data as User
}

/** Applies to editors too — suspending a video editor should lock them out as well. */
export async function setMemberStatus(id: string, status: "active" | "suspended"): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("users").update({ status }).eq("id", id).in("role", TEAM_ROLES)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Client assignment
// ---------------------------------------------------------------------------

export async function listAssignedClientIds(staffUserId: string): Promise<string[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_member_clients")
    .select("client_id")
    .eq("staff_user_id", staffUserId)
  if (error) throw error
  return ((data ?? []) as { client_id: string }[]).map((r) => r.client_id)
}

/**
 * Replace a member's assignment set. Deleting first and inserting the new set
 * keeps "what they can see" exactly what the caller passed, rather than a
 * union with whatever was there before.
 */
export async function setAssignedClients(
  staffUserId: string,
  clientIds: string[],
  assignedBy: string,
): Promise<void> {
  const supabase = getClient()

  const { error: deleteError } = await supabase
    .from("team_member_clients")
    .delete()
    .eq("staff_user_id", staffUserId)
  if (deleteError) throw deleteError

  if (clientIds.length === 0) return

  const rows = clientIds.map((client_id) => ({
    staff_user_id: staffUserId,
    client_id,
    assigned_by: assignedBy,
  }))
  const { error: insertError } = await supabase.from("team_member_clients").insert(rows)
  if (insertError) throw insertError
}

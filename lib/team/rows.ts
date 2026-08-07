/**
 * One list for everyone on the team.
 *
 * Members and invites used to be two tables, which meant the same person was
 * rendered by two different components depending on whether they had clicked
 * their link yet, and video editors were a third thing again with no controls
 * at all. This module flattens all of it into a single row shape so the table
 * renders one kind of thing and the "what can this person reach" answer is
 * computed in exactly one place.
 *
 * Pure — no DB, no network — so the shaping can be unit-tested on its own.
 */

import { inviteStatus } from "@/lib/team-invites/status"
import { describePermissions, getPreset } from "@/lib/permissions/registry"
import type { TeamMember } from "@/lib/db/team-members"
import type { TeamInvite } from "@/types/database"

export type TeamRowStatus = "active" | "suspended" | "pending" | "expired"

export interface TeamRow {
  /** Unique across both sources — an invite and the member it became must not collide. */
  key: string
  id: string
  kind: "member" | "invite"
  /** Null until they accept and tell us their name. */
  name: string | null
  email: string
  /** What they are, in one word: a preset label, or "Video Editor". */
  roleLabel: string
  /** Plain-language summary of the permission map. */
  accessSummary: string
  /** `false` means the /editor portal only — there is no admin access to edit. */
  reachesAdminPanel: boolean
  status: TeamRowStatus
  date: string
  /** Present only on `kind: "member"` — the row's editable subject. */
  member: TeamMember | null
  /** Present only on `kind: "invite"`. */
  invite: TeamInvite | null
}

const EDITOR_LABEL = "Video Editor"
const EDITOR_SUMMARY = "Editor portal only — uploads videos and reads your feedback. No admin panel access."

/**
 * The label is read off the permissions, not off the stored preset key, so
 * someone whose access was later cleared stops being badged "Coach" when a
 * coach is no longer what they are.
 */
function roleLabel(reachesAdminPanel: boolean, staffRole: string | null): string {
  if (!reachesAdminPanel) return EDITOR_LABEL
  const preset = staffRole ? getPreset(staffRole) : null
  // The editor preset can't describe someone who reaches the admin panel.
  if (!preset || preset.invitedRole === "editor") return "Custom"
  return preset.label
}

function memberRow(member: TeamMember): TeamRow {
  const reachesAdminPanel = member.role === "staff"
  const name = `${member.first_name} ${member.last_name}`.trim()

  return {
    key: `member:${member.id}`,
    id: member.id,
    kind: "member",
    name: name || null,
    email: member.email,
    roleLabel: roleLabel(reachesAdminPanel, member.staff_role),
    accessSummary: reachesAdminPanel ? describePermissions(member.permissions) : EDITOR_SUMMARY,
    reachesAdminPanel,
    status: member.status === "suspended" ? "suspended" : "active",
    date: member.created_at,
    member,
    invite: null,
  }
}

function inviteRow(invite: TeamInvite, status: "pending" | "expired"): TeamRow {
  const reachesAdminPanel = invite.role === "staff"

  return {
    key: `invite:${invite.id}`,
    id: invite.id,
    kind: "invite",
    name: null,
    email: invite.email,
    roleLabel: roleLabel(reachesAdminPanel, invite.staff_role),
    accessSummary: reachesAdminPanel ? describePermissions(invite.permissions) : EDITOR_SUMMARY,
    reachesAdminPanel,
    status,
    date: invite.created_at,
    member: null,
    invite,
  }
}

/**
 * Members first, then invites still waiting on someone.
 *
 * Accepted invites are dropped: that person is already in `members`, so
 * listing the invite too would show them twice — once as themselves and once
 * as a row whose only actions (resend, revoke) no longer mean anything.
 */
export function buildTeamRows(members: TeamMember[], invites: TeamInvite[]): TeamRow[] {
  const rows = members.map(memberRow)

  for (const invite of invites) {
    const status = inviteStatus(invite)
    if (status === "accepted") continue
    rows.push(inviteRow(invite, status))
  }

  return rows
}

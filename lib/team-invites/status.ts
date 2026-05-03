import type { TeamInvite, TeamInviteStatus } from "@/types/database"

export function inviteStatus(invite: TeamInvite): TeamInviteStatus {
  if (invite.used_at) return "accepted"
  if (new Date(invite.expires_at).getTime() <= Date.now()) return "expired"
  return "pending"
}

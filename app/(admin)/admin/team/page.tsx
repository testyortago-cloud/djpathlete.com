import { requireAdmin } from "@/lib/auth-helpers"
import { listInvites } from "@/lib/db/team-invites"
import { listTeamMembers } from "@/lib/db/team-members"
import { getClients } from "@/lib/db/users"
import { TeamTable } from "@/components/admin/team/TeamTable"

export const metadata = { title: "Team" }

/**
 * Owner-only. `/admin/team` is in OWNER_ONLY_PREFIXES, so the middleware turns
 * staff away before this renders; requireAdmin() is the second layer.
 */
export default async function TeamPage() {
  await requireAdmin()

  const [invites, members, clients] = await Promise.all([listInvites(), listTeamMembers(), getClients()])

  const clientOptions = clients.map((c) => ({
    id: c.id,
    name: `${c.first_name} ${c.last_name}`.trim() || c.email,
    email: c.email,
  }))

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-heading text-2xl text-primary">Team</h1>
        <p className="font-body text-sm text-muted-foreground">
          Everyone who works with you, in one list. Tick exactly which areas each person can reach —
          changes apply on their next page load. Invite links expire after 7 days.
        </p>
      </header>

      <TeamTable initialMembers={members} initialInvites={invites} clients={clientOptions} />
    </div>
  )
}

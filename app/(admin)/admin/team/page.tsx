import { requireAdmin } from "@/lib/auth-helpers"
import { listInvites } from "@/lib/db/team-invites"
import { listTeamMembers } from "@/lib/db/team-members"
import { getClients } from "@/lib/db/users"
import { InviteList } from "@/components/admin/team/InviteList"
import { TeamMemberList } from "@/components/admin/team/TeamMemberList"

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
    <div className="space-y-10 p-6">
      <header>
        <h1 className="font-heading text-2xl text-primary">Team</h1>
        <p className="font-body text-sm text-muted-foreground">
          Invite people into the admin panel and choose exactly which areas they can reach.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="font-heading text-lg text-primary">Members</h2>
          <p className="text-sm text-muted-foreground">
            People who have accepted an invite. Changes to their access apply on their next page load.
          </p>
        </div>
        <TeamMemberList initialMembers={members} clients={clientOptions} />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-heading text-lg text-primary">Invites</h2>
          <p className="text-sm text-muted-foreground">
            Sent but not yet accepted. Links expire after 7 days.
          </p>
        </div>
        <InviteList initialInvites={invites} />
      </section>
    </div>
  )
}

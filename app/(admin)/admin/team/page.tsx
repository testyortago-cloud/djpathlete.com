import { requireAdmin } from "@/lib/auth-helpers"
import { listInvites } from "@/lib/db/team-invites"
import { InviteList } from "@/components/admin/team/InviteList"

export const metadata = { title: "Team" }

export default async function TeamPage() {
  await requireAdmin()
  const invites = await listInvites()
  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-primary">Team</h1>
          <p className="font-body text-sm text-muted-foreground">
            Invite editors and manage team access.
          </p>
        </div>
      </header>
      <InviteList initialInvites={invites} />
    </div>
  )
}

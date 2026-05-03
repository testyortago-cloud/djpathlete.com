import { requireAdmin } from "@/lib/auth-helpers"
import { listAllSubmissions } from "@/lib/db/team-video-submissions"
import { TeamVideoTable } from "@/components/admin/team-videos/TeamVideoTable"

export const metadata = { title: "Team Videos" }

export default async function TeamVideosPage() {
  await requireAdmin()
  const submissions = await listAllSubmissions()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-heading text-2xl text-primary">Team Videos</h1>
        <p className="font-body text-sm text-muted-foreground">
          Review videos submitted by your editor team.
        </p>
      </header>
      <TeamVideoTable submissions={submissions} />
    </div>
  )
}

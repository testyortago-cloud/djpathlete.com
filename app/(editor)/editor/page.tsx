import Link from "next/link"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listSubmissionsForEditor } from "@/lib/db/team-video-submissions"
import { SubmissionList } from "@/components/editor/SubmissionList"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Editor Dashboard" }

export default async function EditorDashboard() {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor")

  const submissions = await listSubmissionsForEditor(session.user.id)

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl text-primary">Your videos</h2>
          <p className="font-body text-sm text-muted-foreground">
            Upload, track review status, and revise based on feedback.
          </p>
        </div>
        <Button asChild>
          <Link href="/editor/upload">Upload video</Link>
        </Button>
      </header>

      <SubmissionList submissions={submissions} />
    </div>
  )
}

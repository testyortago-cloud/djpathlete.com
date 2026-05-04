import Link from "next/link"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listSubmissionsForEditor } from "@/lib/db/team-video-submissions"
import { SubmissionList } from "@/components/editor/SubmissionList"
import { Button } from "@/components/ui/button"
import { Upload } from "lucide-react"

export const metadata = { title: "Submissions" }

export default async function EditorSubmissionsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor/submissions")

  const submissions = await listSubmissionsForEditor(session.user.id)

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-4">
        <div className="space-y-1">
          <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
            Workshop · Submissions
          </p>
          <h1 className="font-heading text-2xl text-primary">Your videos</h1>
          <p className="font-body text-sm text-muted-foreground">
            Upload, track review status, and revise based on feedback.
          </p>
        </div>
        <Button asChild>
          <Link href="/editor/upload">
            <Upload className="mr-1.5 size-4" />
            Upload video
          </Link>
        </Button>
      </header>

      <SubmissionList submissions={submissions} />
    </div>
  )
}

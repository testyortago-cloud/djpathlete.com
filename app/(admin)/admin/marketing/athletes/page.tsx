import { Users } from "lucide-react"
import { getAthletesPageContent } from "@/lib/db/athletes-page"
import { AthletesEditor } from "./AthletesEditor"

export const metadata = { title: "Athletes page — DJP Athlete" }
export const dynamic = "force-dynamic"

export default async function AthletesAdminPage() {
  const content = await getAthletesPageContent()

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="size-12 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Users className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-heading text-primary">Athletes page</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Edit the copy shown on the public{" "}
            <span className="font-mono">/athletes</span> page — hero, the
            &quot;Four stages&quot; section heading, and each stage card
            (Professional / Collegiate / Youth / Return-to-Sport). Changes go live as
            soon as you save.
          </p>
        </div>
      </div>

      <AthletesEditor initialContent={content} />
    </div>
  )
}

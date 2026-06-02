import { UserSquare } from "lucide-react"
import { getAboutPageContent } from "@/lib/db/about-page"
import { AboutEditor } from "./AboutEditor"

export const metadata = { title: "About page — DJP Athlete" }
export const dynamic = "force-dynamic"

export default async function AboutAdminPage() {
  const content = await getAboutPageContent()

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="size-12 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <UserSquare className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-heading text-primary">About page</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Edit the copy shown on the public{" "}
            <span className="font-mono">/about</span> page — hero, the &quot;In short&quot; answer
            block, the journey story, and the bottom call-to-action. Changes go live as soon
            as you save.
          </p>
        </div>
      </div>

      <AboutEditor initialContent={content} />
    </div>
  )
}

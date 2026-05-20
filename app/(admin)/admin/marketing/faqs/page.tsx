import { HelpCircle } from "lucide-react"
import { getStaticAndTemplatedFaqPages, type FaqPage } from "@/lib/faq/pages"
import { getPublishedEvents } from "@/lib/db/events"
import { FaqManager } from "./FaqManager"

export const metadata = { title: "FAQs — DJP Athlete" }
export const dynamic = "force-dynamic"

async function eventFaqPages(): Promise<FaqPage[]> {
  try {
    const events = await getPublishedEvents()
    return events.map((e) => ({
      key: `event/${e.id}`,
      label: `${e.title} (event)`,
      routePath: e.type === "camp" ? `/camps/${e.slug}` : `/clinics/${e.slug}`,
      group: "Events" as const,
      supportsCategories: false,
      contextSummary: e.summary,
    }))
  } catch {
    // If events listing fails, ship without Events rather than blocking the page.
    return []
  }
}

export default async function FaqsAdminPage() {
  const [staticPages, eventPages] = await Promise.all([
    Promise.resolve(getStaticAndTemplatedFaqPages()),
    eventFaqPages(),
  ])
  const allPages = [...staticPages, ...eventPages]

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <HelpCircle className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-heading text-primary">FAQs</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Manage the question-and-answer blocks rendered on public pages. Pick a
            page, then add, edit, or remove its FAQs. Only FAQs with status
            &quot;published&quot; appear on the live site.
          </p>
        </div>
      </div>

      <FaqManager pages={allPages} />
    </div>
  )
}

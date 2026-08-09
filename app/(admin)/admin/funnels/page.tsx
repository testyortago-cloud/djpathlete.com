import { LayoutTemplate } from "lucide-react"
import { listFunnels, listSteps, getSubmissionCountsByFunnel } from "@/lib/db/funnels"
import { FunnelList } from "@/components/admin/funnels/FunnelList"

export const metadata = { title: "Funnels" }

export default async function FunnelsPage() {
  const funnels = await listFunnels()

  // A card can only show a preview once its entry page has been published at
  // least once, so resolve that here rather than letting every card load an
  // iframe that 404s.
  const [leadCounts, stepsPerFunnel] = await Promise.all([
    getSubmissionCountsByFunnel().catch(() => ({}) as Record<string, number>),
    Promise.all(funnels.map((funnel) => listSteps(funnel.id).catch(() => []))),
  ])

  const previewable: Record<string, boolean> = {}
  funnels.forEach((funnel, index) => {
    const entry = stepsPerFunnel[index].find((step) => step.is_entry)
    previewable[funnel.id] = Boolean(entry?.published_version_id)
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Funnels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Campaign landing pages built on a drag-and-drop canvas. Published pages live at
            /go/&lt;slug&gt;.
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <LayoutTemplate className="size-5 text-accent" />
        </div>
      </div>

      <FunnelList initialFunnels={funnels} leadCounts={leadCounts} previewable={previewable} />
    </div>
  )
}

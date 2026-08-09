import { LayoutTemplate } from "lucide-react"
import { listFunnels, listSteps, getSubmissionCountsByFunnel } from "@/lib/db/funnels"
import { FunnelBoard, type BoardPage } from "@/components/admin/funnels/FunnelBoard"

export const metadata = { title: "Landing pages" }

export default async function FunnelsPage() {
  const funnels = await listFunnels()

  const [leadCounts, stepsPerFunnel] = await Promise.all([
    getSubmissionCountsByFunnel().catch(() => ({}) as Record<string, number>),
    Promise.all(funnels.map((funnel) => listSteps(funnel.id).catch(() => []))),
  ])

  // Flattened: one card per PAGE. A funnel almost always holds exactly one, so
  // listing funnels and then their pages meant two near-identical screens.
  const pages: BoardPage[] = funnels.flatMap((funnel, index) =>
    stepsPerFunnel[index].map((step) => ({ step, funnel })),
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Landing pages</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Campaign pages published at /go/&lt;slug&gt;.
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <LayoutTemplate className="size-5 text-accent" />
        </div>
      </div>

      <FunnelBoard pages={pages} funnels={funnels} leadCounts={leadCounts} />
    </div>
  )
}

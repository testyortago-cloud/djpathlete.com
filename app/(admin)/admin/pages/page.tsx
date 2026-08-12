// The landing pages screen. Its twin at /admin/funnels renders the same board
// with kind="funnel"; the only differences are the filter, the title and the
// vocabulary the board picks up from `kind`.
//
// NOTE: this path is new, so it needed an entry in lib/permissions/registry.ts.
// Unmapped admin paths are denied by default — a screen added without its
// prefix bounces staff who legitimately hold the permission.

import Link from "next/link"
import { LayoutTemplate } from "lucide-react"
import { listFunnels, listSteps, getSubmissionCountsByFunnel } from "@/lib/db/funnels"
import { FunnelBoard, type BoardPage } from "@/components/admin/funnels/FunnelBoard"

export const metadata = { title: "Landing pages" }

export default async function LandingPagesScreen() {
  const funnels = await listFunnels({ kind: "page" })

  const [leadCounts, stepsPerFunnel] = await Promise.all([
    getSubmissionCountsByFunnel().catch(() => ({}) as Record<string, number>),
    Promise.all(funnels.map((funnel) => listSteps(funnel.id).catch(() => []))),
  ])

  const pages: BoardPage[] = funnels.flatMap((funnel, index) =>
    stepsPerFunnel[index].map((step) => ({ step, funnel })),
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Landing pages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One focused page each, published at /go/&lt;slug&gt;.{" "}
            <Link href="/admin/funnels/guide" className="underline underline-offset-2 hover:text-primary">
              How landing pages work
            </Link>
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <LayoutTemplate className="size-5 text-accent" />
        </div>
      </div>

      <FunnelBoard kind="page" pages={pages} funnels={funnels} leadCounts={leadCounts} />
    </div>
  )
}

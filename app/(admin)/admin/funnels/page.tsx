// The funnels screen. Multi-step sequences only — single landing pages live at
// /admin/pages and render the same board with kind="page".

import Link from "next/link"
import { Workflow } from "lucide-react"
import { listFunnels, listSteps, getSubmissionCountsByFunnel } from "@/lib/db/funnels"
import { FunnelList, type FunnelWithSteps } from "@/components/admin/funnels/FunnelList"

export const metadata = { title: "Funnels" }

export default async function FunnelsScreen() {
  const funnels = await listFunnels({ kind: "funnel" })

  const [leadCounts, stepsPerFunnel] = await Promise.all([
    getSubmissionCountsByFunnel().catch(() => ({}) as Record<string, number>),
    Promise.all(funnels.map((funnel) => listSteps(funnel.id).catch(() => []))),
  ])

  // ONE CARD PER FUNNEL, and its steps are a list inside that card.
  //
  // This used to flatten to one card per PAGE, with the funnel demoted to a
  // filter chip above them. The owner's report: "why connected funnels is not
  // compiled, and also the category filter is wrong its filtering the name."
  // Both halves were that one decision — a three-step funnel was three loose
  // cards, the funnel had no card of its own, and the chips were funnel NAMES
  // doing duty as categories.
  //
  // It also left this screen contradicting the model underneath it: publishing
  // and background drafting are both funnel-level operations now.
  const withSteps: FunnelWithSteps[] = funnels.map((funnel, index) => ({
    funnel,
    steps: stepsPerFunnel[index],
  }))

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Funnels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-step sequences sharing one address.{" "}
            <Link href="/admin/funnels/guide" className="underline underline-offset-2 hover:text-primary">
              How funnels work
            </Link>
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <Workflow className="size-5 text-accent" />
        </div>
      </div>

      <FunnelList funnels={withSteps} leadCounts={leadCounts} />
    </div>
  )
}

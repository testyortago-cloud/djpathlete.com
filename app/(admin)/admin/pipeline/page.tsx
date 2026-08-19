// app/(admin)/admin/pipeline/page.tsx — the Lead Engine board. Server
// component: reads the board and the business's own name, hands both to the
// client-side drag surface.
//
// `readBoard()` and `getBusinessSettings()` are intentionally NOT wrapped in
// try/catch here. A failed read must not render as an empty board — the two
// need to look different to whoever is looking at this page, or a broken
// query reads as "no leads in the pipeline right now" instead of "something
// is wrong." Letting the error propagate sends it to
// app/(admin)/admin/error.tsx, the existing admin error boundary, which is
// visibly different from a board with zero cards.

import { requireAdmin } from "@/lib/auth-helpers"
import { readBoard } from "@/lib/db/pipeline"
import { getBusinessSettings } from "@/lib/db/businesses"
import { possessiveName } from "@/lib/lead-engine/business-copy"
import { PipelineBoard } from "@/components/admin/pipeline-board"

export const metadata = { title: "Pipeline" }
export const dynamic = "force-dynamic"

export default async function PipelinePage() {
  await requireAdmin()

  const [columns, business] = await Promise.all([readBoard(), getBusinessSettings()])
  const name = possessiveName(business.display_name)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {name.leading} coaching pipeline. Drag a card to move it between stages — dropping it on Won or Lost closes
          the deal; dropping a closed card back on an open stage reopens it.
        </p>
      </div>
      <PipelineBoard columns={columns} />
    </div>
  )
}

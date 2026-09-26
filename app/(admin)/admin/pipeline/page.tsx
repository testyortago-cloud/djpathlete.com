// app/(admin)/admin/pipeline/page.tsx — the Lead Engine board. Server
// component: reads the board and the business's own name, hands both to the
// client-side drag surface.
//
// `readBoard()`, `listPipelines()` and `getBusinessSettings()` are
// intentionally NOT wrapped in try/catch here. A failed read must not render
// as an empty board — the two need to look different to whoever is looking at
// this page, or a broken query reads as "no leads in the pipeline right now"
// instead of "something is wrong." Letting the error propagate sends it to
// app/(admin)/admin/error.tsx, the existing admin error boundary, which is
// visibly different from a board with zero cards.

import { requirePermission } from "@/lib/permissions/guard"
import { readBoard, listGrantablePrograms, listPipelines } from "@/lib/db/pipeline"
// From its definition site, not lib/db/pipeline's re-export: that module is a
// DAL, and a page pulling a bare string constant through it means every test
// that mocks the DAL must also restate the constant. pipeline-move.ts has no
// imports of its own, so this costs nothing.
import { DEFAULT_PIPELINE_KEY } from "@/lib/lead-engine/pipeline-move"
import { getBusinessSettings } from "@/lib/db/businesses"
import { possessiveName } from "@/lib/lead-engine/business-copy"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import Link from "next/link"
import { Settings } from "lucide-react"
import { PipelineBoard } from "@/components/admin/pipeline-board"
import { BoardSwitcher } from "@/components/admin/pipeline/BoardSwitcher"
import { NewCardDialog } from "@/components/admin/new-card-dialog"

export const metadata = { title: "Pipeline" }
export const dynamic = "force-dynamic"

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()

  // Which board to show. Until Task 8 this page read the DEFAULT board and
  // nothing else, so on production — where migration 00257 seeded
  // `camps_clinics` and `assessment` next to `coaching` — every card
  // `routeToPipeline` filed on either of those had no surface at all. They
  // were not lost, they were invisible, which is worse: nobody goes looking.
  //
  // The requested key is validated against THIS TENANT'S OWN boards, not
  // against a list of known keys, and for two separate reasons:
  //
  //  1. `?board` is user input. Passing it straight through means a hand-typed
  //     key reaches `resolvePipeline`, which throws PipelineNotConfiguredError
  //     — the whole page becomes the admin error boundary, reachable by
  //     editing the URL.
  //  2. A key can be perfectly real and still not exist HERE.
  //     `create_business()` seeds every tenant with all three boards
  //     (`seed_business_starter_set()`, 00279), but a coach can archive one
  //     by hand, so `?board=assessment` can still name a board that tenant no
  //     longer has active. A validator built from a constant list of keys
  //     would wave that through and fail the same way as (1).
  //
  // Anything that does not survive that check falls back to the default board
  // rather than erroring — the same rule `resolvePipelineWithFallback` applies
  // on the write side, for the same reason: a board this tenant lacks is
  // exactly as unroutable as a key nothing recognises.
  const requestedBoard = (await searchParams).board
  const boards = await listPipelines(businessId)
  //
  // `?? boards[0]` before the literal key, because an ACTIVE board this tenant
  // HAS beats a key it may not. `resolvePipeline` does not filter on status, so
  // for a tenant whose active boards are, say, Camps & Clinics and Assessment,
  // the literal `coaching` either resolves an ARCHIVED Coaching board — which
  // appears in no pill, leaving nothing on screen marked active — or, with no
  // coaching row at all, throws PipelineNotConfiguredError and replaces a
  // perfectly usable board with the error boundary. The literal survives only
  // as the last resort for a tenant with NO boards, where there is nothing
  // better to name and `resolvePipeline` should indeed fail loudly.
  const activeBoard =
    boards.find((b) => b.key === requestedBoard) ?? boards.find((b) => b.key === DEFAULT_PIPELINE_KEY) ?? boards[0]
  const activeKey = activeBoard?.key ?? DEFAULT_PIPELINE_KEY
  // The bare word only when the tenant's boards could not be named at all —
  // `listPipelines` returns [] for a tenant with none, and the sentence still
  // has to read correctly.
  const activeBoardName = activeBoard?.name ?? "coaching"

  // MIXED SCOPE, and a gap rather than a design. The board and the settings
  // are this tenant's own, but `listGrantablePrograms()` takes no businessId
  // because `programs` has no `business_id` column: the grant picker offers
  // EVERY business's priced programmes, most of them plans named after one
  // athlete, and a grant hands one out. There is no predicate to add without
  // the column. Ledger row G37 owns the decision; the read is on the
  // UNTENANTED BY SCHEMA shelf in lib/tenancy/platform.ts.
  const [columns, business, grantablePrograms] = await Promise.all([
    readBoard(activeKey, businessId),
    getBusinessSettings(businessId),
    listGrantablePrograms(),
  ])
  const name = possessiveName(business.display_name)

  // G29 Task 8. The stage a hand-made card actually lands on:
  // `createOpportunityManually` files onto the stage at POSITION 1, so the
  // dialog can name it rather than saying "the first step" and hoping. Sorted
  // rather than trusting `readBoard`'s order, exactly as PipelineBoard does
  // below — a board with no stages has nothing to name and passes null.
  const firstStageName = [...columns].sort((a, b) => a.stage.position - b.stage.position)[0]?.stage.name ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Capped, so the settings link keeps its place on the same line
            instead of wrapping under a full-width paragraph. */}
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold text-primary">Pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {name.leading} {activeBoardName} pipeline. Drag a card to move it between stages — dropping it on Won or
            Lost closes the deal; dropping a closed card back on an open stage reopens it.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* G29 Task 8. Only when there IS a board — `activeBoard` is
              undefined for a tenant with none, and a dialog with no
              `pipelineId` to post could only ever 404. */}
          {activeBoard && (
            <NewCardDialog pipelineId={activeBoard.id} boardName={activeBoardName} firstStageName={firstStageName} />
          )}
          {/* G29 Task 7. Carries the board being looked at, so the editor opens
              on the same one rather than on whichever the fallback picks. */}
          <Link
            href={`/admin/pipeline/settings?board=${encodeURIComponent(activeKey)}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface/50 hover:text-foreground"
          >
            <Settings className="size-4" />
            Edit stages
          </Link>
        </div>
      </div>
      {/* A single board is not a choice. Every tenant starts with all three
          boards (`create_business()`, 00279); this list can still be one if
          a coach has archived the other two by hand, and a lone pill would
          be chrome that does nothing. */}
      {boards.length > 1 && <BoardSwitcher boards={boards} activeKey={activeKey} />}
      <PipelineBoard columns={columns} grantablePrograms={grantablePrograms} />
    </div>
  )
}

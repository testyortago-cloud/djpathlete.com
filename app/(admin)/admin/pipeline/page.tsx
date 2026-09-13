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
import { PipelineBoard } from "@/components/admin/pipeline-board"
import { BoardSwitcher } from "@/components/admin/pipeline/BoardSwitcher"

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
  //     `create_business()` (00249) seeds `coaching` only, so
  //     `?board=assessment` names a board most tenants have never had. A
  //     validator built from a constant list of keys would wave that through
  //     and fail the same way as (1).
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

  // `listGrantablePrograms()` takes no businessId: `programs` has no
  // business_id column at all (it is the shared program catalog, not a
  // per-tenant table) -- this is not a scoping gap, there is nothing to scope.
  const [columns, business, grantablePrograms] = await Promise.all([
    readBoard(activeKey, businessId),
    getBusinessSettings(businessId),
    listGrantablePrograms(),
  ])
  const name = possessiveName(business.display_name)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {name.leading} {activeBoardName} pipeline. Drag a card to move it between stages — dropping it on Won or Lost
          closes the deal; dropping a closed card back on an open stage reopens it.
        </p>
      </div>
      {/* One board is not a choice. Every tenant create_business() has made has
          exactly one, and a lone pill would be chrome that does nothing. */}
      {boards.length > 1 && <BoardSwitcher boards={boards} activeKey={activeKey} />}
      <PipelineBoard columns={columns} grantablePrograms={grantablePrograms} />
    </div>
  )
}

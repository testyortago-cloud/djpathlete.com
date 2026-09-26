// app/(admin)/admin/pipeline/settings/page.tsx — G29 Task 7. The screen a
// coach uses to reshape a board: rename it, add or remove stages, reorder
// them, change how long a card sits before the board flags it.
//
// Server component. Reads the tenant's boards and the chosen board's stages
// plus its per-stage card counts, and hands all three to the client editor.
// Same two gates as app/(admin)/admin/pipeline/page.tsx — `requirePermission
// ("contacts")` and `resolveAdminTenant()` — because a coach who can move a
// card is already trusted with the board it sits on (spec §2.3: not a new
// permission key).
//
// The reads are NOT wrapped in try/catch, for the same reason the board page
// says: a failed read must not render as an empty board. Letting it propagate
// reaches app/(admin)/admin/error.tsx, which is visibly different from a
// board with no stages.

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { requirePermission } from "@/lib/permissions/guard"
import { listPipelines, readStagesForEdit } from "@/lib/db/pipeline"
import { DEFAULT_PIPELINE_KEY } from "@/lib/lead-engine/pipeline-move"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { BoardSwitcher } from "@/components/admin/pipeline/BoardSwitcher"
import { PipelineSettings } from "@/components/admin/pipeline-settings"

export const metadata = { title: "Pipeline settings" }
export const dynamic = "force-dynamic"

export default async function PipelineSettingsPage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()

  const requestedBoard = (await searchParams).board
  const boards = await listPipelines(businessId)
  // The same three-step fallback /admin/pipeline uses, and for the same
  // reasons — see that file's long comment: `?board` is user input, and a key
  // can be perfectly real without existing for THIS tenant, so it is checked
  // against the tenant's own boards rather than against a list of known keys.
  // An active board this tenant HAS beats a literal key it may not.
  const activeBoard =
    boards.find((b) => b.key === requestedBoard) ?? boards.find((b) => b.key === DEFAULT_PIPELINE_KEY) ?? boards[0]

  if (!activeBoard) {
    // `create_business()` seeds all three boards (`seed_business_starter_set()`,
    // 00279), so this needs a coach to have archived all of them to reach —
    // but rendering an editor with no board to edit would be a crash, and
    // "there is nothing here" is a sentence, not an exception.
    return (
      <div className="space-y-6">
        <Header activeKey={null} />
        <p className="rounded-xl border border-border bg-white p-4 text-sm text-muted-foreground shadow-sm">
          This business has no pipeline boards yet. Ask your developer to set one up.
        </p>
      </div>
    )
  }

  const { stages, cardCountByStageId, closedCardCountByStageId } = await readStagesForEdit(
    activeBoard.id,
    businessId,
  )

  return (
    <div className="space-y-6">
      <Header activeKey={activeBoard.key} />
      {/* One board is not a choice — same rule the board page applies. */}
      {boards.length > 1 && (
        <BoardSwitcher boards={boards} activeKey={activeBoard.key} basePath="/admin/pipeline/settings" />
      )}
      <PipelineSettings
        board={activeBoard}
        stages={stages}
        // A Map is not something to hand across the server/client boundary;
        // the editor takes a plain object and a stage with no cards is simply
        // absent from it.
        cardCounts={Object.fromEntries(cardCountByStageId)}
        // The closed ones, separately — the editor needs both numbers to warn
        // that turning a Won stage into an open one would hide settled deals.
        closedCardCounts={Object.fromEntries(closedCardCountByStageId)}
        isDefaultBoard={activeBoard.key === DEFAULT_PIPELINE_KEY}
      />
    </div>
  )
}

function Header({ activeKey }: { activeKey: string | null }) {
  return (
    <div>
      <Link
        href={activeKey ? `/admin/pipeline?board=${encodeURIComponent(activeKey)}` : "/admin/pipeline"}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        Back to the pipeline
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-primary">Pipeline settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set up the steps a lead moves through on this board, and how long a card can sit in one before it is flagged.
        Changes here apply to every card already on the board.
      </p>
    </div>
  )
}

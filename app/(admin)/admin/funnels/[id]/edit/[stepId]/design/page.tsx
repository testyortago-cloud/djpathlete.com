// The visual builder's route.
//
// Which editor a step opens in is decided by the COLUMNS, not by a mode flag:
// `page_tree` present means the designer, `project_data` means the chat builder.
// A flag would be a third thing that can disagree with the two columns.
//
// A step with neither opens here on an empty tree, because arriving at this URL
// is itself the decision to build this page visually.
//
// ---------------------------------------------------------------------------
// IT MUST READ BOTH COLUMNS, AND FOR A WHOLE STAGE IT READ ONE.
// ---------------------------------------------------------------------------
// `page_tree` is null on every page the AI builder has ever made, so "no tree"
// was indistinguishable from "no page" and every AI page opened here on
// `emptyPageTree()` — a blank canvas over a finished page. That is not just a
// confusing screen:
//
//   BOTH EDITORS BUMP `funnel_steps.doc_revision`. That is deliberate — one
//   lock, two writers, so neither can silently overwrite the other. It also
//   means the first Save on that blank canvas would write an empty `page_tree`
//   AND advance the revision, after which the chat builder 409s against a page
//   it can still see in full.
//
// So the branch below is on the PAIR. Refusing rather than converting is the
// deliberate choice: a SectionDoc -> PageTree conversion is one-way and lossy
// (the tree engine has seven element types and no stylesheet), so it is a
// decision for the owner to make explicitly, not a side effect of clicking a
// pencil icon.

import { notFound } from "next/navigation"
import { getFunnelById, getStep } from "@/lib/db/funnels"
import { getPageTree } from "@/lib/db/funnel-page-tree"
import { getDraft } from "@/lib/db/funnel-builder"
import { emptyPageTree } from "@/lib/funnels/tree/schema"
import { DESIGNER_PARKED } from "@/lib/funnels/tree/parked"
import { DesignEditor } from "@/components/admin/funnels/design/DesignEditor"

export const metadata = { title: "Design" }

interface PageProps {
  params: Promise<{ id: string; stepId: string }>
}

export default async function DesignPage({ params }: PageProps) {
  const { id, stepId } = await params

  const [funnel, step] = await Promise.all([getFunnelById(id), getStep(stepId)])
  if (!funnel || !step || step.funnel_id !== funnel.id) notFound()

  const draftTree = await getPageTree(stepId)
  if (!draftTree) notFound()

  // A tree that parses is editable whether or not the OTHER column can be read
  // at all, so this read is never allowed to take the designer down. It only
  // decides what to say about a step that has no tree.
  const draft = await getDraft(stepId).catch((error) => {
    console.error("[funnels/design] draft read failed — deciding on the tree alone:", error)
    return null
  })

  const publicUrl = `/go/${funnel.slug}${step.is_entry ? "" : `/${step.slug}`}`

  // PARKED TAKES PRECEDENCE OVER EVERYTHING BELOW. See `parked.ts` for why and
  // for what would justify unparking. The decision table is deliberately left
  // intact underneath rather than deleted: it is the fix for a real data-loss
  // bug (a blank canvas over an AI page, whose first Save also advanced the
  // shared revision), and whoever unparks this must get it back working, not
  // rediscover it. `design-route-guard.test.tsx` still exercises it with the
  // constant mocked off, so it cannot rot while parked.
  //
  // Order matters. An unreadable TREE is reported as unreadable even on a step
  // that also holds a document — this editor's own document is the broken one.
  const blockedReason = DESIGNER_PARKED
    ? ("parked" as const)
    : draftTree.treeInvalid || (draftTree.tree === null && draft?.docInvalid)
      ? ("unreadable" as const)
      : draftTree.tree === null && draft?.doc
        ? ("section_doc" as const)
        : undefined

  return (
    <DesignEditor
      stepId={step.id}
      stepName={step.name}
      funnelId={funnel.id}
      publicUrl={publicUrl}
      initialTree={draftTree.tree ?? emptyPageTree()}
      initialRevision={draftTree.revision}
      blockedReason={blockedReason}
    />
  )
}

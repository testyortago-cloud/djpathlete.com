// The visual builder's route.
//
// Which editor a step opens in is decided by the COLUMNS, not by a mode flag:
// `page_tree` present means the designer, `project_data` means the chat builder.
// A flag would be a third thing that can disagree with the two columns.
//
// A step with neither opens here on an empty tree, because arriving at this URL
// is itself the decision to build this page visually.

import { notFound } from "next/navigation"
import { getFunnelById, getStep } from "@/lib/db/funnels"
import { getPageTree } from "@/lib/db/funnel-page-tree"
import { emptyPageTree } from "@/lib/funnels/tree/schema"
import { DesignEditor } from "@/components/admin/funnels/design/DesignEditor"

export const metadata = { title: "Design" }

interface PageProps {
  params: Promise<{ id: string; stepId: string }>
}

export default async function DesignPage({ params }: PageProps) {
  const { id, stepId } = await params

  const [funnel, step] = await Promise.all([getFunnelById(id), getStep(stepId)])
  if (!funnel || !step || step.funnel_id !== funnel.id) notFound()

  const draft = await getPageTree(stepId)
  if (!draft) notFound()

  const publicUrl = `/go/${funnel.slug}${step.is_entry ? "" : `/${step.slug}`}`

  return (
    <DesignEditor
      stepId={step.id}
      stepName={step.name}
      funnelId={funnel.id}
      publicUrl={publicUrl}
      initialTree={draft.tree ?? emptyPageTree()}
      initialRevision={draft.revision}
      treeInvalid={draft.treeInvalid}
    />
  )
}

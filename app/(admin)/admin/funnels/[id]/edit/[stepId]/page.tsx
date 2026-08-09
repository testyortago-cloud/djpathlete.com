import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { getFunnelById, getStep } from "@/lib/db/funnels"
import { FunnelEditorLoader } from "@/components/admin/funnels/FunnelEditorLoader"

export const metadata = { title: "Edit page" }

interface PageProps {
  params: Promise<{ id: string; stepId: string }>
}

export default async function FunnelEditPage({ params }: PageProps) {
  const { id, stepId } = await params

  const [funnel, step] = await Promise.all([getFunnelById(id), getStep(stepId)])
  if (!funnel || !step || step.funnel_id !== funnel.id) notFound()

  const publicUrl = `/go/${funnel.slug}${step.is_entry ? "" : `/${step.slug}`}`

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/admin/funnels/${funnel.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          {funnel.name}
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-sm font-medium text-primary">{step.name}</h1>
      </div>

      <FunnelEditorLoader
        stepId={step.id}
        publicUrl={publicUrl}
        initialProjectData={step.project_data ?? null}
      />
    </div>
  )
}

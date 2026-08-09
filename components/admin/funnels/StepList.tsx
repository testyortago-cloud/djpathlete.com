"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PreviewCard } from "./PreviewCard"
import type { Funnel, FunnelStep } from "@/types/database"

interface StepListProps {
  funnel: Funnel
  initialSteps: FunnelStep[]
}

export function StepList({ funnel, initialSteps }: StepListProps) {
  const router = useRouter()
  const [steps, setSteps] = useState<FunnelStep[]>(initialSteps)

  async function handleDelete(step: FunnelStep) {
    if (step.is_entry) {
      toast.error("The entry page can't be deleted. Delete the funnel instead.")
      return
    }
    if (!window.confirm(`Delete the "${step.name}" page? This cannot be undone.`)) return

    try {
      const response = await fetch(`/api/admin/funnels/steps/${step.id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? "Could not delete the page.")
        return
      }
      setSteps((current) => current.filter((s) => s.id !== step.id))
      toast.success("Page deleted.")
      router.refresh()
    } catch {
      toast.error("Could not delete the page.")
    }
  }

  if (steps.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-16 text-center text-muted-foreground">
        This funnel has no pages.
      </div>
    )
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {steps.map((step) => {
        const path = `/go/${funnel.slug}${step.is_entry ? "" : `/${step.slug}`}`
        const published = Boolean(step.published_version_id)
        return (
          <PreviewCard
            key={step.id}
            title={step.name}
            subtitle={path}
            previewUrl={published ? `${path}?preview=1` : null}
            href={`/admin/funnels/${funnel.id}/edit/${step.id}`}
            primaryLabel="Edit"
            publicUrl={published && funnel.status === "published" ? path : null}
            badgeLabel={published ? "published" : "never published"}
            badgeTone={published ? "success" : "neutral"}
            onDelete={step.is_entry ? undefined : () => handleDelete(step)}
            deleteLabel={`Delete ${step.name}`}
          />
        )
      })}
    </div>
  )
}

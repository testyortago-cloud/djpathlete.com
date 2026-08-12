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
    // Deleting the entry page has no meaning on its own — it IS the funnel, so
    // it deletes the funnel, exactly as the funnels list does. This used to
    // refuse with "delete the funnel instead" and point at a control that did
    // not exist anywhere on this page; worse, the card never rendered a delete
    // button for an entry step, so that message was unreachable and a
    // single-page funnel had no delete affordance at all.
    const deletingFunnel = step.is_entry
    const message = deletingFunnel
      ? `Delete "${funnel.name}" and all of its pages? This cannot be undone.`
      : `Delete the "${step.name}" page? This cannot be undone.`
    if (!window.confirm(message)) return

    const url = deletingFunnel
      ? `/api/admin/funnels/${funnel.id}`
      : `/api/admin/funnels/steps/${step.id}`

    try {
      const response = await fetch(url, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? "Could not delete the page.")
        return
      }
      if (deletingFunnel) {
        toast.success(funnel.kind === "page" ? "Landing page deleted." : "Funnel deleted.")
        // Back to the screen it came FROM. Both kinds reach this page, so a
        // hard-coded /admin/funnels would strand someone who deleted a landing
        // page on a list that will never contain it.
        router.push(funnel.kind === "page" ? "/admin/pages" : "/admin/funnels")
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
        // SAME VOCABULARY AS THE LIST. This badge used to read "published" the
        // moment a version row existed — while the page could still be
        // completely unreachable, because the FUNNEL was a draft. It said the
        // true thing about the database and the false thing about the world,
        // and it sat directly under the funnel's own "published" badge, so one
        // screen showed the word twice meaning two different things. The
        // reachability calculation was already right here on the next line for
        // `publicUrl`; the badge just ignored it.
        const live = published && funnel.status === "published"
        const badge = live
          ? { label: "live", tone: "success" as const }
          : published
            ? { label: "draft", tone: "neutral" as const }
            : { label: "never published", tone: "neutral" as const }
        return (
          <PreviewCard
            key={step.id}
            title={step.name}
            subtitle={path}
            previewUrl={published ? `${path}?preview=1` : null}
            href={`/admin/funnels/${funnel.id}/edit/${step.id}`}
            primaryLabel="Edit"
            publicUrl={live ? path : null}
            badgeLabel={badge.label}
            badgeTone={badge.tone}
            // The entry page IS the funnel, so deleting it means deleting the
            // funnel — which is what the list does. Previously this passed
            // `undefined`, so no button rendered at all and `handleDelete`'s
            // explanation ("delete the funnel instead") was unreachable code.
            onDelete={() => handleDelete(step)}
            deleteLabel={step.is_entry ? `Delete ${funnel.name}` : `Delete ${step.name}`}
          />
        )
      })}
    </div>
  )
}

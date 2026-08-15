import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { getFunnelById, listSteps } from "@/lib/db/funnels"
import { FunnelStatusControl } from "@/components/admin/funnels/FunnelStatusControl"
import { StepList } from "@/components/admin/funnels/StepList"
import { AddStepDialog } from "@/components/admin/funnels/AddStepDialog"

interface PageProps {
  params: Promise<{ id: string }>
}

// Both kinds reach this page — it is the ⚙ settings destination for a landing
// page as well as the step list for a funnel — so a static "Funnel" title would
// be wrong half the time, in the one place the owner cannot see it is wrong:
// the browser tab.
export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  const funnel = await getFunnelById(id)
  if (!funnel) return { title: "Not found" }
  return { title: funnel.kind === "page" ? `${funnel.name} · Landing page` : `${funnel.name} · Funnel` }
}

export default async function FunnelDetailPage({ params }: PageProps) {
  const { id } = await params
  const funnel = await getFunnelById(id)
  if (!funnel) notFound()

  const steps = await listSteps(id)

  return (
    <div>
      {/* Back to the screen this funnel actually lives on. Both kinds reach
          this page, so one hard-coded destination is wrong half the time. */}
      <Link
        href={funnel.kind === "page" ? "/admin/pages" : "/admin/funnels"}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {funnel.kind === "page" ? "All landing pages" : "All funnels"}
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{funnel.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Public URL:{" "}
            <a
              href={`/go/${funnel.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              /go/{funnel.slug}
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Funnels only. A landing page is single-page by definition — the
              way to give it a second step is Convert to funnel, which says so
              explicitly rather than letting the page drift into being one. */}
          {funnel.kind === "funnel" ? (
            <AddStepDialog
              funnelId={funnel.id}
              funnelSlug={funnel.slug}
              takenSlugs={steps.map((step) => step.slug)}
            />
          ) : null}
          <FunnelStatusControl funnelId={funnel.id} status={funnel.status} kind={funnel.kind} />
        </div>
      </div>

      <StepList funnel={funnel} initialSteps={steps} />
    </div>
  )
}

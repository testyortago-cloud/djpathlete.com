import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { getById } from "@/lib/db/injuries"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"
import { StatusPill } from "@/components/shared/status-pill"
import { InjuryRehabMilestoneList } from "@/components/admin/performance/injury-rehab-milestone-list"

export default async function InjuryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const { id } = await params
  const injury = await getById(id)
  if (!injury) notFound()
  if (session.user.role !== "admin" && injury.client_user_id !== session.user.id) notFound()

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">
            {BODY_REGION_LABELS[injury.body_region]} — {injury.injury_type}
          </h1>
          <p className="text-muted-foreground">
            Reported {injury.date_occurred} · {injury.days_lost} days · {injury.severity}
          </p>
        </div>
        <StatusPill status={injury.status} />
      </div>

      {injury.mechanism && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Mechanism</h2>
          <p>{injury.mechanism}</p>
        </section>
      )}

      {injury.description && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Description</h2>
          <p>{injury.description}</p>
        </section>
      )}

      <section>
        <h2 className="mb-4 font-semibold">Rehab milestones</h2>
        <InjuryRehabMilestoneList injury={injury} />
      </section>
    </div>
  )
}

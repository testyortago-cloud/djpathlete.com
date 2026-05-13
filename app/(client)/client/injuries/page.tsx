import Link from "next/link"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser } from "@/lib/db/injuries"
import { ReportInjuryForm } from "@/components/client/performance/report-injury-form"
import { StatusPill } from "@/components/shared/status-pill"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"

export default async function ClientInjuriesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/injuries")
  const injuries = await listByUser(session.user.id)

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="font-heading mb-8 text-3xl font-bold">Injuries</h1>

      <section className="mb-12">
        <h2 className="font-heading mb-4 text-xl font-semibold">Active & past</h2>
        {injuries.length === 0 ? (
          <p className="text-muted-foreground">No injuries logged.</p>
        ) : (
          <ul className="space-y-2">
            {injuries.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div>
                  <Link
                    href={`/client/injuries/${i.id}`}
                    className="font-medium hover:underline"
                  >
                    {BODY_REGION_LABELS[i.body_region]} — {i.injury_type}
                  </Link>
                  <p className="text-muted-foreground text-sm">
                    {i.date_occurred} · {i.days_lost} days
                  </p>
                </div>
                <StatusPill status={i.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-heading mb-4 text-xl font-semibold">Report a new injury</h2>
        <ReportInjuryForm />
      </section>
    </div>
  )
}

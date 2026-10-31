import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Activity, ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getConnection, linkedAthletes } from "@/lib/db/output-sports"
import { OutputConnectionCard } from "@/components/admin/performance/output-connection-card"

export const metadata: Metadata = { title: "Output Sports — DJP Athlete Admin" }

/**
 * Connects the coach's Output Sports account, so each client's jump, sprint and lift
 * results can be pulled into their performance tests.
 */
export default async function OutputSportsSettingsPage() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { businessId } = await resolveAdminTenant()
  const [connection, links] = await Promise.all([getConnection(businessId), linkedAthletes(businessId)])

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/settings"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Activity className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-primary">Output Sports</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Bring your clients&apos; Output results into their Performance tests: jumps, sprints, agility tests, and
              the 1RM Output estimates for back squat, bench press and deadlift.
            </p>
          </div>
        </div>
      </div>
      <OutputConnectionCard connection={connection} linkedCount={links.size} />
    </div>
  )
}

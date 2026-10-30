import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft, Gauge } from "lucide-react"
import { auth } from "@/lib/auth"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { listStandards } from "@/lib/db/performance-standards"
import { PerformanceStandardsEditor } from "@/components/admin/PerformanceStandardsEditor"

export const metadata: Metadata = { title: "Trained & Elite Standards — DJP Athlete Admin" }

/**
 * The coach's own Trained and Elite numbers per performance test, optionally per age
 * group. They colour results on each client's Arena card and on the shared test report.
 */
export default async function PerformanceStandardsPage() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { businessId } = await resolveAdminTenant()
  const standards = await listStandards(businessId)

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
            <Gauge className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-primary">Trained &amp; Elite Standards</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              The numbers each test result is compared with on a client&apos;s Arena card and test report. A result at
              or above <strong>Trained</strong> shows green. Below the <strong>starting point</strong> it shows red. Add
              an age group to compare a client with people their own age; a client with no matching age group is
              compared with &quot;All ages&quot;.
            </p>
          </div>
        </div>
      </div>
      <PerformanceStandardsEditor initial={standards} />
    </div>
  )
}

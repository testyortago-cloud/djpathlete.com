import Link from "next/link"
import { redirect, notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { getTestHistory } from "@/lib/db/performance-tests"
import { TEST_TYPES, TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { PerformanceTestHistoryChart } from "@/components/admin/performance/performance-test-history-chart"

/** One test's full history for a client: where each card on Performance > Tests links. */
export default async function AdminPerformanceTestTypePage({
  params,
}: {
  params: Promise<{ id: string; testType: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id, testType } = await params
  if (!(TEST_TYPES as readonly string[]).includes(testType)) notFound()
  const type = testType as (typeof TEST_TYPES)[number]
  const history = await getTestHistory(id, type)

  return (
    <div className="container max-w-4xl py-8">
      <Link
        href={`/admin/clients/${id}/performance?tab=tests`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        Back to tests
      </Link>
      <h1 className="font-heading mb-8 text-3xl font-bold">{TEST_TYPE_LABELS[type]}</h1>
      <PerformanceTestHistoryChart tests={history} />
    </div>
  )
}

import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { getTestHistory } from "@/lib/db/performance-tests"
import { TEST_TYPES, TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { PerformanceTestHistoryChart } from "@/components/admin/performance/performance-test-history-chart"

export default async function ClientPerformanceTestTypePage({
  params,
}: {
  params: Promise<{ testType: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const { testType } = await params
  if (!(TEST_TYPES as readonly string[]).includes(testType)) notFound()
  const history = await getTestHistory(
    session.user.id,
    testType as (typeof TEST_TYPES)[number],
  )

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="font-heading mb-8 text-3xl font-bold">
        {TEST_TYPE_LABELS[testType as (typeof TEST_TYPES)[number]]}
      </h1>
      <PerformanceTestHistoryChart tests={history} />
    </div>
  )
}

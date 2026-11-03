import Link from "next/link"
import { redirect, notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { getTestHistory } from "@/lib/db/performance-tests"
import { TEST_TYPES, TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { PerformanceTestHistoryChart } from "@/components/admin/performance/performance-test-history-chart"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"

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
      {/* Notes hold what the chart cannot: an Output import's load-velocity sets, ball weight or RSI. */}
      {history.length > 0 && (
        <DataTableCard className="mt-6">
          <DataTable>
            <DataTableHeader>
              <DataTableHead className="w-32">Date</DataTableHead>
              <DataTableHead className="w-36">Result</DataTableHead>
              <DataTableHead>Attempts</DataTableHead>
              <DataTableHead>Notes</DataTableHead>
            </DataTableHeader>
            <tbody>
              {[...history].reverse().map((t) => (
                <DataTableRow key={t.id}>
                  <DataTableCell className="font-mono text-xs">{t.test_date}</DataTableCell>
                  <DataTableCell>
                    <span className="font-semibold">
                      {t.result_value} {t.result_unit}
                    </span>
                    {t.is_pr && (
                      <DataTableBadge tone="success" className="ml-2">
                        PR
                      </DataTableBadge>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">{t.trial_values?.join(", ") ?? "-"}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">{t.notes ?? "-"}</DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableCard>
      )}
    </div>
  )
}

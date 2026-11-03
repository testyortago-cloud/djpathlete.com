import Link from "next/link"
import { redirect, notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { getTestHistory } from "@/lib/db/performance-tests"
import { TEST_TYPES, TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { otherSide, sidesLabel } from "@/lib/coach-intel/test-cards"
import { formatDate, num } from "@/lib/test-report/format"
import {
  PerformanceTestHistoryChart,
  SidesHistoryChart,
} from "@/components/admin/performance/performance-test-history-chart"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"
import type { PerformanceTest } from "@/types/database"

/**
 * One test's full history for a client: where each card on Performance > Tests links.
 * A left/right test shows both sides, whichever side the link named.
 */
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
  const partner = otherSide(type)
  const [history, partnerHistory] = await Promise.all([
    getTestHistory(id, type),
    partner ? getTestHistory(id, partner) : Promise.resolve([] as PerformanceTest[]),
  ])
  const [left, right] = type.endsWith("_left") ? [history, partnerHistory] : [partnerHistory, history]
  const sideOf = (t: PerformanceTest) => (t.test_type.endsWith("_left") ? "Left" : "Right")
  // Newest first; on one day, left before right.
  const rows = [...history, ...partnerHistory].sort(
    (a, b) => b.test_date.localeCompare(a.test_date) || sideOf(a).localeCompare(sideOf(b)),
  )

  return (
    <div className="container max-w-4xl py-8">
      <Link
        href={`/admin/clients/${id}/performance?tab=tests`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        Back to tests
      </Link>
      <h1 className="font-heading mb-8 text-3xl font-bold">{partner ? sidesLabel(type) : TEST_TYPE_LABELS[type]}</h1>
      {partner ? (
        <SidesHistoryChart label={sidesLabel(type)} left={left} right={right} />
      ) : (
        <PerformanceTestHistoryChart tests={history} />
      )}
      {/* Notes hold what the chart cannot: an Output import's load-velocity sets, ball weight or RSI. */}
      {rows.length > 0 && (
        <DataTableCard className="mt-6">
          <DataTable>
            <DataTableHeader>
              <DataTableHead className="w-32">Date</DataTableHead>
              {partner && <DataTableHead className="w-20">Side</DataTableHead>}
              <DataTableHead className="w-36">Result</DataTableHead>
              <DataTableHead>Attempts</DataTableHead>
              <DataTableHead>Notes</DataTableHead>
            </DataTableHeader>
            <tbody>
              {rows.map((t) => (
                <DataTableRow key={t.id}>
                  <DataTableCell className="whitespace-nowrap text-xs">{formatDate(t.test_date)}</DataTableCell>
                  {partner && <DataTableCell className="text-xs">{sideOf(t)}</DataTableCell>}
                  <DataTableCell className="whitespace-nowrap">
                    <span className="font-semibold">
                      {num(t.result_value)} {t.result_unit}
                    </span>
                    {t.is_pr && (
                      <DataTableBadge tone="success" className="ml-2">
                        PR
                      </DataTableBadge>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {t.trial_values?.map((v) => num(v)).join(", ") || "-"}
                  </DataTableCell>
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

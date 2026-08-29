import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Building2 } from "lucide-react"
import {
  listActiveArrangements,
  listArrangementsByIds,
  type ArrangementWithUser,
} from "@/lib/db/attendance-arrangements"
import { listAttendanceCheckinsBetween } from "@/lib/db/session-checkins"
import { monthBounds, monthOf, rollUpAttendance } from "@/lib/services/attendance-view"
import {
  DataTableCard,
  DataTable,
  DataTableHeader,
  DataTableHead,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
  DataTableFooter,
} from "@/components/ui/data-table"
import { MonthPicker } from "@/components/admin/attendance/MonthPicker"

export const metadata = { title: "Attendance" }

function labelForMonth(month: string) {
  const { from } = monthBounds(month)
  return new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const session = await auth()
  if (session?.user?.role !== "admin") redirect("/login")

  const params = await searchParams
  // An unparseable ?month= falls back to this month rather than throwing — a
  // hand-edited URL should not 500 the page.
  let month = params.month ?? monthOf(new Date())
  try {
    monthBounds(month)
  } catch {
    month = monthOf(new Date())
  }
  const { from, to } = monthBounds(month)

  const checkins = await listAttendanceCheckinsBetween(from, to)

  // Active arrangements give every current client a row even at zero sessions.
  // Then add any arrangement this month's check-ins point at that is no longer
  // active: one ended mid-month still owns the sessions it recorded, and those
  // still have to be billed.
  const active = await listActiveArrangements()
  const activeIds = new Set(active.map((a) => a.id))
  const missingIds = [...new Set(checkins.map((c) => c.arrangement_id).filter((x): x is string => !!x))].filter(
    (id) => !activeIds.has(id),
  )
  const ended: ArrangementWithUser[] = missingIds.length > 0 ? await listArrangementsByIds(missingIds) : []

  const { rows, total } = rollUpAttendance([...active, ...ended], checkins)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Attendance</h1>
          <p className="text-sm text-muted-foreground">
            Clients you coach who are billed somewhere else. This is your own count of sessions — check it against
            the facility&apos;s invoice before you approve it.
          </p>
        </div>
        <MonthPicker month={month} />
      </div>

      <DataTableCard>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Client</DataTableHead>
            <DataTableHead>Billed by</DataTableHead>
            <DataTableHead align="right">Sessions in {labelForMonth(month)}</DataTableHead>
          </DataTableHeader>
          <tbody>
            {rows.length === 0 ? (
              <DataTableEmpty colSpan={3}>
                No attendance arrangements yet. Open a client and start one under Sessions &amp; Billing.
              </DataTableEmpty>
            ) : (
              rows.map((r) => (
                <DataTableRow key={r.arrangementId}>
                  <DataTableCell>
                    <Link href={`/admin/clients/${r.clientUserId}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                    {r.status === "ended" && (
                      <span className="ml-2 text-xs text-muted-foreground">(arrangement ended)</span>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="size-3.5" strokeWidth={1.5} />
                      {r.label || "Not recorded"}
                    </span>
                  </DataTableCell>
                  <DataTableCell align="right" className="font-medium tabular-nums">
                    {r.sessions}
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </tbody>
        </DataTable>
        {rows.length > 0 && (
          <DataTableFooter>
            <p className="text-sm text-muted-foreground">
              {rows.length} client{rows.length === 1 ? "" : "s"} on an attendance arrangement
            </p>
            <p className="text-sm font-semibold text-primary tabular-nums">
              {total} session{total === 1 ? "" : "s"} total
            </p>
          </DataTableFooter>
        )}
      </DataTableCard>
    </div>
  )
}

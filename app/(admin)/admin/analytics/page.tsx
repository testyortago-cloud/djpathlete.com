import {
  DollarSign,
  TrendingUp,
  Hash,
  BarChart3,
  Users,
} from "lucide-react"
import { getUsers } from "@/lib/db/users"
import { getPrograms } from "@/lib/db/programs"
import { getPayments } from "@/lib/db/payments"
import { getAssignments } from "@/lib/db/assignments"
import { TimeRangeSelector } from "@/components/admin/TimeRangeSelector"
import type { Payment, Program, ProgramAssignment, User } from "@/types/database"

export const metadata = { title: "Analytics" }

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function getMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function getLastNMonths(n: number, earliest?: Date): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = []
  const now = new Date()
  if (n === 0 && earliest) {
    const start = new Date(earliest.getFullYear(), earliest.getMonth(), 1)
    const d = new Date(start)
    while (d <= now) {
      months.push({ key: getMonthKey(d), label: getMonthLabel(d) })
      d.setMonth(d.getMonth() + 1)
    }
    return months
  }
  for (let i = (n || 6) - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ key: getMonthKey(d), label: getMonthLabel(d) })
  }
  return months
}

const VALID_MONTHS = [0, 1, 3, 6, 12] as const

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>
}) {
  const params = await searchParams
  const rawMonths = Number(params.months)
  const months = VALID_MONTHS.includes(rawMonths as (typeof VALID_MONTHS)[number]) ? rawMonths : 6
  const [users, programs, payments, assignments] = await Promise.all([
    getUsers(),
    getPrograms(),
    getPayments(),
    getAssignments(),
  ])

  const now = new Date()

  const allDates = [
    ...(payments as Payment[]).map((p) => new Date(p.created_at)),
    ...(users as User[]).map((u) => new Date(u.created_at)),
  ]
  const earliest = allDates.length > 0
    ? new Date(Math.min(...allDates.map((d) => d.getTime())))
    : now

  const rangeStart =
    months === 0
      ? earliest
      : new Date(now.getFullYear(), now.getMonth() - months, 1)

  // ---- Revenue calculations (filtered by range) ----
  const succeededPayments = (payments as Payment[]).filter(
    (p) => p.status === "succeeded" && new Date(p.created_at) >= rangeStart
  )
  const totalRevenue = succeededPayments.reduce(
    (sum, p) => sum + p.amount_cents,
    0
  )

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thisMonthRevenue = succeededPayments
    .filter((p) => new Date(p.created_at) >= monthStart)
    .reduce((sum, p) => sum + p.amount_cents, 0)

  const avgTransaction =
    succeededPayments.length > 0
      ? Math.round(totalRevenue / succeededPayments.length)
      : 0

  // ---- Monthly Revenue ----
  const lastN = getLastNMonths(months, earliest)
  const revenueByMonth = new Map<string, { count: number; total: number }>()
  for (const m of lastN) {
    revenueByMonth.set(m.key, { count: 0, total: 0 })
  }
  for (const p of succeededPayments) {
    const key = getMonthKey(new Date(p.created_at))
    const entry = revenueByMonth.get(key)
    if (entry) {
      entry.count += 1
      entry.total += p.amount_cents
    }
  }

  // ---- Program Popularity ----
  const programMap = new Map<string, string>()
  for (const prog of programs as Program[]) {
    programMap.set(prog.id, prog.name)
  }

  const filteredAssignments = (assignments as ProgramAssignment[]).filter(
    (a) => new Date(a.created_at) >= rangeStart
  )
  const assignmentCountByProgram = new Map<string, number>()
  for (const a of filteredAssignments) {
    const current = assignmentCountByProgram.get(a.program_id) ?? 0
    assignmentCountByProgram.set(a.program_id, current + 1)
  }

  const programPopularity = Array.from(assignmentCountByProgram.entries())
    .map(([programId, count]) => ({
      name: programMap.get(programId) ?? "Unknown Program",
      count,
    }))
    .sort((a, b) => b.count - a.count)

  const maxAssignments = programPopularity[0]?.count ?? 1

  // ---- Client Growth ----
  const clientsByMonth = new Map<string, number>()
  for (const m of lastN) {
    clientsByMonth.set(m.key, 0)
  }
  const clients = (users as User[]).filter((u) => u.role === "client")
  for (const u of clients) {
    const key = getMonthKey(new Date(u.created_at))
    const current = clientsByMonth.get(key)
    if (current !== undefined) {
      clientsByMonth.set(key, current + 1)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-primary">Analytics</h1>
        <TimeRangeSelector currentMonths={months} />
      </div>

      {/* Revenue Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-success/10">
              <DollarSign className="size-4 text-success" />
            </div>
            <p className="text-sm text-muted-foreground">
              {months === 0 ? "All-Time Revenue" : `Revenue (${months}mo)`}
            </p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {formatCents(totalRevenue)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <TrendingUp className="size-4 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">This Month</p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {formatCents(thisMonthRevenue)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Hash className="size-4 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Avg Transaction</p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {formatCents(avgTransaction)}
          </p>
        </div>
      </div>

      {/* Monthly Revenue Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm mb-8">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <BarChart3 className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Monthly Revenue
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Month
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Transactions
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {lastN.map((month) => {
                const data = revenueByMonth.get(month.key)
                return (
                  <tr
                    key={month.key}
                    className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {month.label}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {data?.count ?? 0}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {formatCents(data?.total ?? 0)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Program Popularity */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <BarChart3 className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">
              Program Popularity
            </h2>
          </div>

          {programPopularity.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No program assignments yet.
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {programPopularity.map((prog) => {
                const pct = Math.round((prog.count / maxAssignments) * 100)
                return (
                  <div key={prog.name}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-foreground truncate mr-3">
                        {prog.name}
                      </p>
                      <p className="text-sm text-muted-foreground whitespace-nowrap">
                        {prog.count} {prog.count === 1 ? "assignment" : "assignments"}
                      </p>
                    </div>
                    <div className="h-2 rounded-full bg-surface overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Client Growth */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <Users className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">
              Client Growth
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Month
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    New Clients
                  </th>
                </tr>
              </thead>
              <tbody>
                {lastN.map((month) => {
                  const count = clientsByMonth.get(month.key) ?? 0
                  return (
                    <tr
                      key={month.key}
                      className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {month.label}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {count}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

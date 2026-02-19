import Link from "next/link"
import {
  Users,
  Dumbbell,
  DollarSign,
  ClipboardCheck,
  ArrowRight,
} from "lucide-react"
import { getUsers } from "@/lib/db/users"
import { getPrograms } from "@/lib/db/programs"
import { getPaymentsWithDetails } from "@/lib/db/payments"
import { getAssignments } from "@/lib/db/assignments"
import type { Payment } from "@/types/database"

export const metadata = { title: "Dashboard" }

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  refunded: "bg-muted text-muted-foreground",
}

export default async function DashboardPage() {
  const [users, programs, payments, assignments] = await Promise.all([
    getUsers(),
    getPrograms(),
    getPaymentsWithDetails(),
    getAssignments(),
  ])

  // Stats
  const totalClients = users.filter((u) => u.role === "client").length
  const activePrograms = programs.length
  const succeededPayments = payments.filter(
    (p: Payment) => p.status === "succeeded"
  )
  const totalRevenue = succeededPayments.reduce(
    (sum: number, p: Payment) => sum + p.amount_cents,
    0
  )
  const activeAssignments = (assignments as { status: string }[]).filter(
    (a) => a.status === "active"
  ).length

  // Recent data
  const recentPayments = payments.slice(0, 5)
  const recentClients = users
    .filter((u) => u.role === "client")
    .slice(0, 5)

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Users className="size-4 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Total Clients</p>
          </div>
          <p className="text-2xl font-semibold text-primary">{totalClients}</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Dumbbell className="size-4 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Active Programs</p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {activePrograms}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-success/10">
              <DollarSign className="size-4 text-success" />
            </div>
            <p className="text-sm text-muted-foreground">Total Revenue</p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {formatCents(totalRevenue)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <ClipboardCheck className="size-4 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              Active Assignments
            </p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {activeAssignments}
          </p>
        </div>
      </div>

      {/* Recent Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Payments */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="text-lg font-semibold text-primary">
              Recent Payments
            </h2>
            <Link
              href="/admin/payments"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              View All
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          {recentPayments.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No payments recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Client
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Amount
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((payment) => (
                    <tr
                      key={payment.id}
                      className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(payment.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {payment.users ? (
                          <div>
                            <p className="font-medium text-foreground">
                              {payment.users.first_name}{" "}
                              {payment.users.last_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {payment.users.email}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            {payment.user_id.slice(0, 8)}...
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {formatCents(payment.amount_cents)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${PAYMENT_STATUS_COLORS[payment.status] ?? "bg-muted text-muted-foreground"}`}
                        >
                          {payment.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Clients */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="text-lg font-semibold text-primary">
              Recent Clients
            </h2>
            <Link
              href="/admin/clients"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              View All
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          {recentClients.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No clients have signed up yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentClients.map((client) => (
                <div
                  key={client.id}
                  className="flex items-center justify-between px-4 py-3 hover:bg-surface/30 transition-colors"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {client.first_name} {client.last_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {client.email}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    Joined {formatDate(client.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getPayments } from "@/lib/db/payments"
import { EmptyState } from "@/components/ui/empty-state"
import { CreditCard, DollarSign, Hash } from "lucide-react"
import type { PaymentStatus } from "@/types/database"

export const metadata = { title: "Payment History | DJP Athlete" }

const STATUS_STYLES: Record<PaymentStatus, string> = {
  succeeded: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  refunded: "bg-muted text-muted-foreground",
}

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

export default async function ClientPaymentsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  let payments: Awaited<ReturnType<typeof getPayments>> = []

  try {
    payments = await getPayments(userId)
  } catch {
    // DB tables may not exist yet -- render gracefully with empty data
  }

  const succeededPayments = payments.filter((p) => p.status === "succeeded")
  const totalSpent = succeededPayments.reduce(
    (sum, p) => sum + p.amount_cents,
    0
  )
  const purchaseCount = succeededPayments.length

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">
        Payment History
      </h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center justify-center size-9 sm:size-10 rounded-full bg-success/10 shrink-0">
            <DollarSign className="size-4 sm:size-5 text-success" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-semibold text-foreground leading-none">
              {formatCents(totalSpent)}
            </p>
            <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight mt-0.5">Total Spent</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center justify-center size-9 sm:size-10 rounded-full bg-primary/10 shrink-0">
            <Hash className="size-4 sm:size-5 text-primary" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-semibold text-foreground leading-none">
              {purchaseCount}
            </p>
            <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight mt-0.5">Purchases</p>
          </div>
        </div>
      </div>

      {/* Payments List */}
      {payments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          heading="No purchases yet"
          description="Your payment history will appear here once you purchase a program. Browse our programs to get started!"
          ctaLabel="Browse Programs"
          ctaHref="/programs"
        />
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Description
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
                {payments.map((payment) => (
                  <tr
                    key={payment.id}
                    className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(payment.created_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {payment.description ?? "Program Purchase"}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {formatCents(payment.amount_cents)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[payment.status] ?? "bg-muted text-muted-foreground"}`}
                      >
                        {payment.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-border">
            {payments.map((payment) => (
              <div key={payment.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <p className="font-medium text-foreground text-sm">
                    {payment.description ?? "Program Purchase"}
                  </p>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize shrink-0 ${STATUS_STYLES[payment.status] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {payment.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(payment.created_at)}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {formatCents(payment.amount_cents)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

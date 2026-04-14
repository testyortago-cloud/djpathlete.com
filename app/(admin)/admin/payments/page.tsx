import { DollarSign, TrendingUp, Hash, CreditCard } from "lucide-react"
import { getPaymentsWithDetails } from "@/lib/db/payments"
import { PaymentList } from "@/components/admin/PaymentList"
import type { Payment } from "@/types/database"

export const metadata = { title: "Payments" }

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default async function PaymentsPage() {
  const payments = await getPaymentsWithDetails()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const succeeded = (payments as (Payment & { users: unknown })[]).filter((p) => p.status === "succeeded")
  const totalRevenue = succeeded.reduce((s, p) => s + p.amount_cents, 0)

  const thisMonthRevenue = succeeded
    .filter((p) => new Date(p.created_at) >= monthStart)
    .reduce((s, p) => s + p.amount_cents, 0)

  const lastMonthRevenue = succeeded
    .filter((p) => {
      const d = new Date(p.created_at)
      return d >= lastMonthStart && d < monthStart
    })
    .reduce((s, p) => s + p.amount_cents, 0)

  const avgTransaction = succeeded.length > 0 ? Math.round(totalRevenue / succeeded.length) : 0

  const transactionCount = succeeded.length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Payments</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-success/10">
              <DollarSign className="size-3.5 sm:size-4 text-success" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">Total Revenue</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{formatCents(totalRevenue)}</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
              <TrendingUp className="size-3.5 sm:size-4 text-primary" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">This Month</p>
          </div>
          <div className="flex items-baseline gap-1.5">
            <p className="text-xl sm:text-2xl font-semibold text-primary">{formatCents(thisMonthRevenue)}</p>
            {lastMonthRevenue > 0 &&
              (() => {
                const pct = Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
                if (pct === 0) return null
                return (
                  <span className={`text-xs font-medium ${pct > 0 ? "text-success" : "text-destructive"}`}>
                    {pct > 0 ? "+" : ""}
                    {pct}%
                  </span>
                )
              })()}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
              <CreditCard className="size-3.5 sm:size-4 text-primary" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">Transactions</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{transactionCount}</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
              <Hash className="size-3.5 sm:size-4 text-primary" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">Avg Transaction</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{formatCents(avgTransaction)}</p>
        </div>
      </div>

      <PaymentList payments={payments} />
    </div>
  )
}

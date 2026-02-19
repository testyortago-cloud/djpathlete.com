"use client"

import { useState } from "react"
import {
  Search,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  TrendingUp,
  Hash,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/ui/empty-state"
import type { Payment } from "@/types/database"

interface PaymentWithUser extends Payment {
  users: { first_name: string; last_name: string; email: string } | null
}

interface PaymentListProps {
  payments: PaymentWithUser[]
}

const STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  refunded: "bg-muted text-muted-foreground",
}

const PAGE_SIZE_OPTIONS = [10, 25, 50]

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

export function PaymentList({ payments }: PaymentListProps) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Revenue calculations
  const successfulPayments = payments.filter((p) => p.status === "succeeded")
  const totalRevenue = successfulPayments.reduce(
    (sum, p) => sum + p.amount_cents,
    0
  )
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thisMonthRevenue = successfulPayments
    .filter((p) => new Date(p.created_at) >= monthStart)
    .reduce((sum, p) => sum + p.amount_cents, 0)

  const filtered = payments.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    const userName = p.users
      ? `${p.users.first_name} ${p.users.last_name}`.toLowerCase()
      : ""
    const email = p.users?.email.toLowerCase() ?? ""
    return (
      userName.includes(q) ||
      email.includes(q) ||
      (p.description?.toLowerCase().includes(q) ?? false) ||
      (p.stripe_payment_id?.toLowerCase().includes(q) ?? false)
    )
  })

  const totalPages = Math.ceil(filtered.length / perPage)
  const paginated = filtered.slice((page - 1) * perPage, page * perPage)

  if (payments.length === 0) {
    return (
      <EmptyState
        icon={CreditCard}
        heading="No payments yet"
        description="Payment records will appear here once clients purchase programs through the store."
      />
    )
  }

  return (
    <div>
      {/* Revenue Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
            <div className="flex size-9 items-center justify-center rounded-lg bg-accent/10">
              <TrendingUp className="size-4 text-accent" />
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
            <p className="text-sm text-muted-foreground">Transactions</p>
          </div>
          <p className="text-2xl font-semibold text-primary">
            {payments.length}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm">
        {/* Search */}
        <div className="p-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or Stripe ID..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="pl-9 h-9"
            />
          </div>
        </div>

        {/* Table */}
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
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
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
              {paginated.map((payment) => (
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
                          {payment.users.first_name} {payment.users.last_name}
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
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {payment.description ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {formatCents(payment.amount_cents)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[payment.status] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {payment.status}
                    </span>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    No payments found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-border flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value))
                setPage(1)
              }}
              className="h-8 rounded border border-border bg-white px-2 text-sm"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="ml-2">
              {filtered.length === 0
                ? "0"
                : `${(page - 1) * perPage + 1}-${Math.min(page * perPage, filtered.length)}`}{" "}
              of {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

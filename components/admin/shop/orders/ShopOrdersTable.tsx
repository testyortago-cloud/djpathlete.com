"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import type { ShopOrder, ShopOrderStatus } from "@/types/database"

interface ShopOrdersTableProps {
  orders: ShopOrder[]
}

type Tab = "all" | "needs_action" | "in_production" | "shipped" | "issues"

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_action", label: "Needs Action" },
  { id: "in_production", label: "In Production" },
  { id: "shipped", label: "Shipped" },
  { id: "issues", label: "Issues" },
]

const STATUS_FILTER: Record<Tab, ShopOrderStatus[] | null> = {
  all: null,
  needs_action: ["paid"],
  in_production: ["confirmed", "in_production"],
  shipped: ["shipped"],
  issues: ["canceled", "refunded"],
}

// paid status sorts first, then newest by created_at
const STATUS_SORT_PRIORITY: Record<ShopOrderStatus, number> = {
  paid: 0,
  pending: 1,
  draft: 2,
  confirmed: 3,
  in_production: 4,
  shipped: 5,
  canceled: 6,
  refunded: 7,
  fulfilled_digital: 5,
}

function statusBadge(status: ShopOrderStatus): { label: string; className: string } {
  switch (status) {
    case "paid":
      return { label: "Needs Action", className: "bg-yellow-100 text-yellow-800" }
    case "confirmed":
    case "in_production":
      return {
        label: status === "confirmed" ? "Confirmed" : "In Production",
        className: "bg-blue-100 text-blue-800",
      }
    case "shipped":
      return { label: "Shipped", className: "bg-green-100 text-green-800" }
    case "canceled":
      return { label: "Canceled", className: "bg-gray-100 text-gray-700" }
    case "refunded":
      return { label: "Refunded", className: "bg-red-100 text-red-700" }
    case "pending":
      return { label: "Pending", className: "bg-muted text-muted-foreground" }
    case "draft":
      return { label: "Draft", className: "bg-muted text-muted-foreground" }
    default:
      return { label: status, className: "bg-muted text-muted-foreground" }
  }
}

function itemsSummary(items: ShopOrder["items"]): string {
  if (items.length === 0) return "—"
  const total = items.reduce((sum, i) => sum + i.quantity, 0)
  const first = items[0]
  const firstName = first.name.length > 20 ? first.name.slice(0, 20) + "…" : first.name
  const firstPart = `${first.quantity} × ${firstName}`
  const remaining = items.length - 1
  if (remaining === 0) return firstPart
  return `${firstPart} + ${remaining} more`
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

export function ShopOrdersTable({ orders }: ShopOrdersTableProps) {
  const [activeTab, setActiveTab] = useState<Tab>("all")

  const filtered = useMemo(() => {
    const statusFilter = STATUS_FILTER[activeTab]
    const base = statusFilter
      ? orders.filter((o) => statusFilter.includes(o.status))
      : orders

    return [...base].sort((a, b) => {
      const priorityDiff = STATUS_SORT_PRIORITY[a.status] - STATUS_SORT_PRIORITY[b.status]
      if (priorityDiff !== 0) return priorityDiff
      // Newest first within same priority
      return b.created_at.localeCompare(a.created_at)
    })
  }, [orders, activeTab])

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      {/* Tabs */}
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              "px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors",
              activeTab === tab.id
                ? "text-primary border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-muted-foreground text-sm">No orders in this category yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Order
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Customer
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Items
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Total
                </th>
                <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Status
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Age
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((order) => {
                const badge = statusBadge(order.status)
                const age = formatDistanceToNow(new Date(order.created_at), { addSuffix: true })
                return (
                  <tr key={order.id} className="hover:bg-muted/20 transition-colors">
                    {/* Order number */}
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/shop/orders/${order.id}`}
                        className="font-mono text-xs font-medium text-primary hover:underline"
                      >
                        {order.order_number}
                      </Link>
                    </td>

                    {/* Customer */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground truncate max-w-[160px]">
                        {order.customer_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                        {order.customer_email}
                      </p>
                    </td>

                    {/* Items summary */}
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                      {itemsSummary(order.items)}
                    </td>

                    {/* Total */}
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatCents(order.total_cents)}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>

                    {/* Age */}
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {age}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

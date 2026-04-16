"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { ShopOrder, ShopOrderStatus } from "@/types/database"

interface OrderActionsProps {
  order: ShopOrder
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

const CANCELABLE_STATUSES: ShopOrderStatus[] = ["paid", "draft"]
const REFUNDABLE_STATUSES: ShopOrderStatus[] = ["confirmed", "in_production", "shipped"]

export function OrderActions({ order }: OrderActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showRefundModal, setShowRefundModal] = useState(false)
  const [refundType, setRefundType] = useState<"full" | "partial">("full")
  const [partialAmount, setPartialAmount] = useState("")

  const canConfirm = order.status === "paid" || order.status === "draft"
  const canCancel = CANCELABLE_STATUSES.includes(order.status)
  const canRefund = REFUNDABLE_STATUSES.includes(order.status)

  async function postAction(path: string, body?: unknown) {
    setError(null)
    const res = await fetch(`/api/admin/shop/orders/${order.id}/${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.error ?? "Request failed")
    }
    return data
  }

  function handleConfirm() {
    startTransition(async () => {
      try {
        await postAction("confirm")
        router.refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  function handleCancel() {
    if (!confirm("Cancel this order and issue a full Stripe refund?")) return
    startTransition(async () => {
      try {
        await postAction("cancel")
        router.refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  function handleRefund() {
    startTransition(async () => {
      try {
        const amountCents =
          refundType === "full"
            ? order.total_cents
            : Math.round(parseFloat(partialAmount) * 100)

        if (!amountCents || amountCents <= 0) {
          setError("Invalid refund amount")
          return
        }
        await postAction("refund", { amount_cents: amountCents })
        setShowRefundModal(false)
        router.refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  if (!canConfirm && !canCancel && !canRefund) {
    return null
  }

  return (
    <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
        Actions
      </h2>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {canConfirm && (
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isPending
              ? "Confirming…"
              : order.status === "draft"
                ? "Retry Confirm to Printful"
                : "Confirm to Printful"}
          </button>
        )}

        {canCancel && (
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Canceling…" : "Cancel Order"}
          </button>
        )}

        {canRefund && (
          <button
            onClick={() => { setError(null); setShowRefundModal(true) }}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50 transition-colors"
          >
            Refund
          </button>
        )}
      </div>

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-foreground mb-4">Issue Refund</h3>

            <div className="space-y-4">
              {/* Refund type */}
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="refund-type"
                    value="full"
                    checked={refundType === "full"}
                    onChange={() => setRefundType("full")}
                    className="accent-primary"
                  />
                  <span className="text-sm">Full refund ({formatCents(order.total_cents)})</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="refund-type"
                    value="partial"
                    checked={refundType === "partial"}
                    onChange={() => setRefundType("partial")}
                    className="accent-primary"
                  />
                  <span className="text-sm">Partial refund</span>
                </label>
              </div>

              {refundType === "partial" && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Amount (USD)
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    max={(order.total_cents / 100).toFixed(2)}
                    step="0.01"
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleRefund}
                  disabled={isPending}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {isPending ? "Processing…" : "Confirm Refund"}
                </button>
                <button
                  onClick={() => { setShowRefundModal(false); setError(null) }}
                  disabled={isPending}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

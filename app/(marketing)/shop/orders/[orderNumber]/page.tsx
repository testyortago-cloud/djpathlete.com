"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { Loader2, Package, Truck } from "lucide-react"
import type { ShopOrderStatus } from "@/types/database"

interface OrderLookupResponse {
  order_number: string
  status: ShopOrderStatus
  items: Array<{
    variant_id: string
    name: string
    variant_name: string
    quantity: number
    unit_price_cents: number
  }>
  shipping_address: {
    name: string
    line1: string
    line2: string | null
    city: string
    state: string
    country: string
    postal_code: string
  }
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  tracking_number: string | null
  tracking_url: string | null
  carrier: string | null
  created_at: string
  shipped_at: string | null
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function StatusBadge({ status }: { status: ShopOrderStatus }) {
  const map: Record<ShopOrderStatus, { label: string; className: string }> = {
    pending: { label: "Pending", className: "bg-yellow-100 text-yellow-800" },
    paid: { label: "Paid", className: "bg-blue-50 text-blue-700" },
    draft: { label: "Draft", className: "bg-gray-100 text-gray-600" },
    confirmed: { label: "Confirmed", className: "bg-blue-100 text-blue-800" },
    in_production: { label: "In Production", className: "bg-purple-100 text-purple-800" },
    shipped: { label: "Shipped", className: "bg-green-100 text-green-800" },
    canceled: { label: "Canceled", className: "bg-red-100 text-red-800" },
    refunded: { label: "Refunded", className: "bg-gray-100 text-gray-700" },
  }
  const { label, className } = map[status] ?? { label: status, className: "bg-gray-100 text-gray-700" }
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${className}`}>
      {label}
    </span>
  )
}

export default function OrderLookupPage() {
  const params = useParams()
  const orderNumber = params.orderNumber as string

  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<OrderLookupResponse | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/shop/orders/${encodeURIComponent(orderNumber)}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (res.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.")
        return
      }
      if (res.status === 404) {
        setError("Order not found. Please check your order number and email address.")
        return
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.")
        return
      }
      const data: OrderLookupResponse = await res.json()
      setOrder(data)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <h1 className="font-heading text-3xl text-primary mb-2">Order Status</h1>
      <p className="text-muted-foreground mb-8">
        Order <span className="font-medium text-foreground">{orderNumber}</span>
      </p>

      {!order && (
        <div className="bg-white rounded-xl border p-6">
          <p className="text-sm text-muted-foreground mb-4">
            Enter the email address used at checkout to view your order.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Look up order
            </button>
          </form>
        </div>
      )}

      {order && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Order {order.order_number}</h2>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-sm text-muted-foreground">Placed {formatDate(order.created_at)}</p>
            {order.shipped_at && (
              <p className="text-sm text-muted-foreground">Shipped {formatDate(order.shipped_at)}</p>
            )}
          </div>

          <div className="bg-white rounded-xl border p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Items
            </h2>
            <ul className="space-y-3">
              {order.items.map((item) => (
                <li key={item.variant_id} className="flex justify-between text-sm">
                  <span>
                    {item.quantity} &times; {item.name} &mdash; {item.variant_name}
                  </span>
                  <span className="font-medium">
                    {formatPrice(item.unit_price_cents * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 pt-4 border-t space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatPrice(order.subtotal_cents)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Shipping</span>
                <span>{formatPrice(order.shipping_cents)}</span>
              </div>
              <div className="flex justify-between font-semibold text-base mt-2">
                <span>Total</span>
                <span>{formatPrice(order.total_cents)}</span>
              </div>
            </div>
          </div>

          {(order.tracking_number || order.tracking_url) && (
            <div className="bg-white rounded-xl border p-6">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Tracking
              </h2>
              <div className="text-sm space-y-1">
                {order.carrier && (
                  <p>
                    <span className="text-muted-foreground">Carrier:</span> {order.carrier}
                  </p>
                )}
                {order.tracking_number && (
                  <p>
                    <span className="text-muted-foreground">Tracking number:</span>{" "}
                    {order.tracking_url ? (
                      <a
                        href={order.tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-primary"
                      >
                        {order.tracking_number}
                      </a>
                    ) : (
                      order.tracking_number
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border p-6">
            <h2 className="font-semibold mb-3">Ship to</h2>
            <div className="text-sm text-muted-foreground space-y-0.5">
              <p>{order.shipping_address.name}</p>
              <p>{order.shipping_address.line1}</p>
              {order.shipping_address.line2 && <p>{order.shipping_address.line2}</p>}
              <p>
                {order.shipping_address.city}, {order.shipping_address.state}{" "}
                {order.shipping_address.postal_code}
              </p>
              <p>{order.shipping_address.country}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

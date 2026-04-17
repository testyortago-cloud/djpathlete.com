import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Package, Truck, User, MapPin } from "lucide-react"
import { getOrderById } from "@/lib/db/shop-orders"
import { OrderActions } from "@/components/admin/shop/orders/OrderActions"
import { NotesField } from "@/components/admin/shop/orders/NotesField"
import type { ShopOrder, ShopOrderStatus } from "@/types/database"

export const metadata = { title: "Order Detail · Admin" }

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function StatusBadge({ status }: { status: ShopOrderStatus }) {
  const MAP: Record<ShopOrderStatus, { label: string; className: string }> = {
    pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
    paid: { label: "Needs Action", className: "bg-yellow-100 text-yellow-800" },
    draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
    confirmed: { label: "Confirmed", className: "bg-blue-100 text-blue-800" },
    in_production: { label: "In Production", className: "bg-blue-100 text-blue-800" },
    shipped: { label: "Shipped", className: "bg-green-100 text-green-800" },
    canceled: { label: "Canceled", className: "bg-gray-100 text-gray-700" },
    refunded: { label: "Refunded", className: "bg-red-100 text-red-700" },
    fulfilled_digital: { label: "Fulfilled (Digital)", className: "bg-green-100 text-green-800" },
  }
  const { label, className } = MAP[status] ?? { label: status, className: "bg-muted" }
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  )
}

function Timeline({ order }: { order: ShopOrder }) {
  const steps: { label: string; done: boolean; date?: string }[] = [
    {
      label: "Order Placed",
      done: true,
      date: order.created_at,
    },
    {
      label: "Payment Received",
      done: ["paid", "draft", "confirmed", "in_production", "shipped", "refunded"].includes(
        order.status,
      ),
    },
    {
      label: "Sent to Printful",
      done: ["confirmed", "in_production", "shipped"].includes(order.status),
    },
    {
      label: "In Production",
      done: ["in_production", "shipped"].includes(order.status),
    },
    {
      label: "Shipped",
      done: order.status === "shipped",
      date: order.shipped_at ?? undefined,
    },
  ]

  if (["canceled", "refunded"].includes(order.status)) {
    return (
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Timeline
        </h2>
        <p className="text-sm text-muted-foreground">
          Order {order.status} on {formatDate(order.updated_at)}
          {order.refund_amount_cents != null && (
            <> — Refunded {formatCents(order.refund_amount_cents)}</>
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
        Timeline
      </h2>
      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-3">
            <span
              className={[
                "mt-0.5 size-4 shrink-0 rounded-full border-2",
                step.done
                  ? "bg-primary border-primary"
                  : "bg-white border-border",
              ].join(" ")}
            />
            <div>
              <p
                className={`text-sm ${step.done ? "font-medium text-foreground" : "text-muted-foreground"}`}
              >
                {step.label}
              </p>
              {step.date && (
                <p className="text-xs text-muted-foreground">{formatDate(step.date)}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const order = await getOrderById(id)
  if (!order) notFound()

  const addr = order.shipping_address

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/shop/orders"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to Orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-heading text-primary font-mono">
            {order.order_number}
          </h1>
          <StatusBadge status={order.status} />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Placed {formatDate(order.created_at)}
          {order.printful_order_id && (
            <> · Printful #{order.printful_order_id}</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Actions */}
          <OrderActions order={order} />

          {/* Items */}
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-border flex items-center gap-2">
              <Package className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Items</h2>
            </div>
            <ul className="divide-y divide-border">
              {order.items.map((item, idx) => (
                <li key={idx} className="px-4 sm:px-6 py-4 flex items-center gap-4">
                  {item.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail_url}
                      alt={item.name}
                      className="size-14 rounded-lg object-cover border border-border shrink-0"
                    />
                  ) : (
                    <div className="size-14 rounded-lg bg-muted shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.variant_name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium">{formatCents(item.unit_price_cents)}</p>
                    <p className="text-xs text-muted-foreground">× {item.quantity}</p>
                  </div>
                </li>
              ))}
            </ul>
            {/* Totals */}
            <div className="px-4 sm:px-6 py-4 border-t border-border bg-muted/20 space-y-1.5">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatCents(order.subtotal_cents)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Shipping</span>
                <span>{formatCents(order.shipping_cents)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold text-foreground pt-1 border-t border-border">
                <span>Total</span>
                <span>{formatCents(order.total_cents)}</span>
              </div>
              {order.refund_amount_cents != null && (
                <div className="flex justify-between text-sm text-red-600">
                  <span>Refunded</span>
                  <span>−{formatCents(order.refund_amount_cents)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <Timeline order={order} />

          {/* Tracking */}
          {order.tracking_number && (
            <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-3">
                <Truck className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Tracking</h2>
              </div>
              <dl className="space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-20 shrink-0">Carrier</dt>
                  <dd className="font-medium">{order.carrier ?? "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-20 shrink-0">Tracking #</dt>
                  <dd className="font-mono text-xs">
                    {order.tracking_url ? (
                      <a
                        href={order.tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {order.tracking_number}
                      </a>
                    ) : (
                      order.tracking_number
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Customer */}
          <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <User className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Customer</h2>
            </div>
            <p className="font-medium text-foreground">{order.customer_name}</p>
            <a
              href={`mailto:${order.customer_email}`}
              className="text-sm text-primary hover:underline"
            >
              {order.customer_email}
            </a>
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Shipping Address</h2>
            </div>
            <address className="not-italic text-sm text-foreground space-y-0.5">
              <p>{addr.name}</p>
              <p>{addr.line1}</p>
              {addr.line2 && <p>{addr.line2}</p>}
              <p>
                {addr.city}, {addr.state} {addr.postal_code}
              </p>
              <p>{addr.country}</p>
              {addr.phone && <p className="text-muted-foreground">{addr.phone}</p>}
            </address>
          </div>

          {/* Payment */}
          <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Payment
            </h2>
            <dl className="space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">Intent</dt>
                <dd className="font-mono text-xs truncate">
                  {order.stripe_payment_intent_id ?? "—"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">Session</dt>
                <dd className="font-mono text-xs truncate">
                  {order.stripe_session_id ?? "—"}
                </dd>
              </div>
            </dl>
          </div>

          {/* Admin Notes */}
          <NotesField orderId={order.id} initialNotes={order.notes ?? ""} />
        </div>
      </div>
    </div>
  )
}

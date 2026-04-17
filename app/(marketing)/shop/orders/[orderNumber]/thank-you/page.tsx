import { notFound } from "next/navigation"
import Link from "next/link"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import { stripe } from "@/lib/stripe"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { ClearCartOnMount } from "@/components/public/shop/ClearCartOnMount"

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>
  searchParams: Promise<{ session_id?: string }>
}) {
  if (!isShopEnabled()) notFound()
  const { orderNumber } = await params
  const { session_id } = await searchParams
  const order = await getOrderByNumber(orderNumber)
  if (!order) notFound()

  if (session_id) {
    const s = await stripe.checkout.sessions.retrieve(session_id)
    if (s.metadata?.order_number !== orderNumber) notFound()
  }

  const hasDigital = order.items.some((i) => i.product_type === "digital")
  const hasPod = order.items.some((i) => i.product_type === "pod")

  return (
    <>
      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <h1 className="font-heading text-4xl text-primary">Thank you for your order!</h1>
        <p className="text-muted-foreground mt-2">We've emailed a receipt to {order.customer_email}.</p>
        <div className="mt-8 p-6 bg-white rounded-xl border">
          <p>
            Order number: <strong>{order.order_number}</strong>
          </p>
          <ul className="mt-4 space-y-2">
            {order.items.map((i) => (
              <li key={i.variant_id} className="flex justify-between">
                <span>
                  {i.quantity} × {i.name} — {i.variant_name}
                </span>
                <span>${((i.unit_price_cents * i.quantity) / 100).toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-4 border-t flex justify-between font-semibold">
            <span>Total</span>
            <span>${(order.total_cents / 100).toFixed(2)}</span>
          </div>
        </div>

        {hasDigital && (
          <section className="mt-8 rounded-2xl border border-border p-6">
            <h2 className="font-heading text-lg">Your downloads</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasPod
                ? "Your digital files are ready now. Your physical items will ship separately."
                : "Your files are ready now."}
            </p>
            <a
              href={`/shop/orders/${order.order_number}/downloads`}
              className="mt-4 inline-flex rounded-full bg-primary px-5 py-2.5 font-mono text-xs uppercase tracking-widest text-primary-foreground"
            >
              Go to downloads
            </a>
          </section>
        )}

        {hasPod && (
          <section className="mt-6 rounded-2xl border border-border p-6">
            <h2 className="font-heading text-lg">Shipping to you</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your physical order is being prepared. We'll email tracking info when it ships.
            </p>
          </section>
        )}

        <p className="mt-8">
          <Link className="underline text-primary" href={`/shop/orders/${order.order_number}`}>
            View order status
          </Link>
        </p>
      </div>
      <ClearCartOnMount />
    </>
  )
}

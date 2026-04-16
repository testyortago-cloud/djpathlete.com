import { notFound } from "next/navigation"
import Link from "next/link"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import { stripe } from "@/lib/stripe"
import { ClearCartOnMount } from "@/components/public/shop/ClearCartOnMount"

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>
  searchParams: Promise<{ session_id?: string }>
}) {
  const { orderNumber } = await params
  const { session_id } = await searchParams
  const order = await getOrderByNumber(orderNumber)
  if (!order) notFound()

  if (session_id) {
    const s = await stripe.checkout.sessions.retrieve(session_id)
    if (s.metadata?.order_number !== orderNumber) notFound()
  }

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

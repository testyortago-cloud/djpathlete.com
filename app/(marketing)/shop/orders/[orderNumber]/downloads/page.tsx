import { notFound } from "next/navigation"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import { listDownloadsForOrder } from "@/lib/db/shop-order-downloads"
import { getProductFile } from "@/lib/db/shop-product-files"
import { stripe } from "@/lib/stripe"
import { handleShopOrderCheckout } from "@/lib/shop/webhooks"
import { DownloadsClient } from "./DownloadsClient"

export const dynamic = "force-dynamic"

export default async function Page({
  params,
}: {
  params: Promise<{ orderNumber: string }>
}) {
  const { orderNumber } = await params
  let order = await getOrderByNumber(orderNumber)
  if (!order) notFound()

  // Fallback reconciliation: if the webhook never arrived (local dev without
  // `stripe listen`, or a transient webhook failure), pull the session from
  // Stripe and finalize the order here. Idempotent.
  if (order.status === "pending" && order.stripe_session_id) {
    try {
      const s = await stripe.checkout.sessions.retrieve(order.stripe_session_id)
      if (s.payment_status === "paid") {
        await handleShopOrderCheckout(s)
        order = (await getOrderByNumber(orderNumber)) ?? order
      }
    } catch (err) {
      console.error("[downloads] reconcile failed", err)
    }
  }

  const downloads = await listDownloadsForOrder(order.id)
  const rows = await Promise.all(
    downloads.map(async (d) => {
      const file = await getProductFile(d.file_id)
      return { download: d, file }
    }),
  )
  return (
    <DownloadsClient
      orderNumber={order.order_number}
      rows={rows.filter((r) => r.file != null)}
    />
  )
}

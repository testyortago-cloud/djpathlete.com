import { notFound } from "next/navigation"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import { listDownloadsForOrder } from "@/lib/db/shop-order-downloads"
import { getProductFile } from "@/lib/db/shop-product-files"
import { DownloadsClient } from "./DownloadsClient"

export const dynamic = "force-dynamic"

export default async function Page({
  params,
}: {
  params: Promise<{ orderNumber: string }>
}) {
  const { orderNumber } = await params
  const order = await getOrderByNumber(orderNumber)
  if (!order) notFound()
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

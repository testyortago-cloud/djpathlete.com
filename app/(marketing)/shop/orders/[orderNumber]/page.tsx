import { notFound } from "next/navigation"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { OrderLookupPageClient } from "./OrderLookupPageClient"

export default function Page() {
  if (!isShopEnabled()) notFound()
  return <OrderLookupPageClient />
}

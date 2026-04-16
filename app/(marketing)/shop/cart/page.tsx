import { notFound } from "next/navigation"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { CartPageClient } from "./CartPageClient"

export default function Page() {
  if (!isShopEnabled()) notFound()
  return <CartPageClient />
}

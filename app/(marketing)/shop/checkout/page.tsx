import { notFound } from "next/navigation"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { CheckoutPageClient } from "./CheckoutPageClient"

export default function Page() {
  if (!isShopEnabled()) notFound()
  return <CheckoutPageClient />
}

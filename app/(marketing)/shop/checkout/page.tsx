import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { CheckoutPageClient } from "./CheckoutPageClient"

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: true },
}

export default function Page() {
  if (!isShopEnabled()) notFound()
  return <CheckoutPageClient />
}

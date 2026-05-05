import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { CartPageClient } from "./CartPageClient"

export const metadata: Metadata = {
  title: "Cart",
  robots: { index: false, follow: true },
}

export default function Page() {
  if (!isShopEnabled()) notFound()
  return <CartPageClient />
}

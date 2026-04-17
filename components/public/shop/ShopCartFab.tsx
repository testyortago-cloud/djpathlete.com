"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ShoppingBag } from "lucide-react"
import { useCart } from "@/lib/shop/cart"

export function ShopCartFab() {
  const pathname = usePathname()
  const { totalItems } = useCart()
  const [pulse, setPulse] = useState(false)

  // Hide the FAB on the cart and checkout pages themselves — the user is already there.
  const hideOnPath =
    pathname === "/shop/cart" ||
    pathname === "/shop/checkout" ||
    pathname.startsWith("/shop/orders/")

  // Brief pulse when the item count increases
  useEffect(() => {
    if (totalItems === 0) return
    setPulse(true)
    const t = setTimeout(() => setPulse(false), 600)
    return () => clearTimeout(t)
  }, [totalItems])

  if (hideOnPath) return null

  const hasItems = totalItems > 0

  return (
    <Link
      href="/shop/cart"
      aria-label={`Cart, ${totalItems} item${totalItems === 1 ? "" : "s"}`}
      className={`group fixed bottom-6 right-6 z-40 inline-flex items-center gap-2.5 rounded-full shadow-lg shadow-primary/20 transition-all duration-300 hover:shadow-xl hover:shadow-primary/30 sm:bottom-8 sm:right-8 ${
        hasItems
          ? "bg-primary pl-4 pr-5 py-3 text-primary-foreground"
          : "bg-background border border-border p-3.5 text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary"
      } ${pulse ? "scale-105" : "scale-100"}`}
    >
      <span className="relative flex items-center justify-center">
        <ShoppingBag
          className="size-5 transition-transform duration-300 group-hover:-rotate-6"
          strokeWidth={1.8}
        />
        {hasItems && (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-primary"
          >
            {totalItems > 99 ? "99+" : totalItems}
          </span>
        )}
      </span>
      {hasItems && (
        <span className="font-body text-sm font-medium">
          View cart
        </span>
      )}
    </Link>
  )
}

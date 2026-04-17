"use client"

import Link from "next/link"
import { ShoppingBag } from "lucide-react"
import { useCart } from "@/lib/shop/cart"

interface CartBadgeProps {
  useLight?: boolean
  className?: string
}

export function CartBadge({ useLight = false, className = "" }: CartBadgeProps) {
  const { totalItems } = useCart()

  return (
    <Link
      href="/shop/cart"
      aria-label={`Cart, ${totalItems} item${totalItems === 1 ? "" : "s"}`}
      className={`relative inline-flex size-10 items-center justify-center rounded-full transition-colors ${
        useLight
          ? "text-white hover:bg-white/10"
          : "text-primary hover:bg-primary/5"
      } ${className}`}
    >
      <ShoppingBag className="size-5" strokeWidth={1.8} />
      {totalItems > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background"
          aria-hidden="true"
        >
          {totalItems > 99 ? "99+" : totalItems}
        </span>
      )}
    </Link>
  )
}

"use client"

import { useSearchParams } from "next/navigation"

export function CheckoutCancelledBanner() {
  const params = useSearchParams()
  if (params.get("checkout") !== "cancelled") return null
  return (
    <div className="border-b border-accent/30 bg-accent/10">
      <div className="mx-auto max-w-7xl px-4 py-3 text-sm text-foreground md:px-6">
        Checkout was cancelled — feel free to try again when you're ready.
      </div>
    </div>
  )
}

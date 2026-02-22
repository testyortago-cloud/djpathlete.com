"use client"

import { useRouter } from "next/navigation"

interface BuyButtonProps {
  programId: string
  isLoggedIn: boolean
}

export function BuyButton({ programId, isLoggedIn }: BuyButtonProps) {
  const router = useRouter()

  function handleBuy() {
    if (!isLoggedIn) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/client/programs/${programId}`)}`)
      return
    }

    // Logged-in users go through the client flow
    router.push(`/client/programs/${programId}`)
  }

  return (
    <button
      onClick={handleBuy}
      className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      {isLoggedIn ? "Buy Now" : "Sign In to Purchase"}
    </button>
  )
}

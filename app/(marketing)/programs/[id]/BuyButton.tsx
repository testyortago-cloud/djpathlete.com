"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

interface BuyButtonProps {
  programId: string
  isLoggedIn: boolean
}

export function BuyButton({ programId, isLoggedIn }: BuyButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleBuy() {
    if (!isLoggedIn) {
      router.push("/login")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error ?? "Something went wrong")
      }

      if (data.url) {
        window.location.href = data.url
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start checkout")
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleBuy}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {isLoggedIn ? "Buy Now" : "Sign In to Purchase"}
    </button>
  )
}

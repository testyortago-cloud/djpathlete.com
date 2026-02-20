"use client"

import { useState, useEffect } from "react"
import { Loader2, ShoppingBag } from "lucide-react"
import { toast } from "sonner"

interface ClientBuyButtonProps {
  programId: string
}

export function ClientBuyButton({ programId }: ClientBuyButtonProps) {
  const [loading, setLoading] = useState(false)

  // Reset loading if user navigates back from Stripe (e.g., presses back/escape)
  useEffect(() => {
    function handleFocus() {
      setLoading(false)
    }
    window.addEventListener("pageshow", handleFocus)
    window.addEventListener("focus", handleFocus)
    return () => {
      window.removeEventListener("pageshow", handleFocus)
      window.removeEventListener("focus", handleFocus)
    }
  }, [])

  async function handleBuy() {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, returnUrl: "/client/programs/success" }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error ?? "Something went wrong")
      }

      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error("No checkout URL received")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start checkout")
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleBuy}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ShoppingBag className="size-4" />
      )}
      {loading ? "Redirecting to checkout..." : "Buy Now"}
    </button>
  )
}

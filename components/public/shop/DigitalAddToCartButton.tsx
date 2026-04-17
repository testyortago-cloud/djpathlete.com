"use client"
import { useCart } from "@/lib/shop/cart"
import { useRouter } from "next/navigation"

export function DigitalAddToCartButton({
  variantId,
  priceCents,
}: {
  variantId: string
  priceCents: number
}) {
  const { addItem } = useCart()
  const router = useRouter()

  function handleAdd() {
    addItem(variantId, 1)
    router.push("/shop/cart")
  }

  return (
    <button
      onClick={handleAdd}
      className="w-full rounded-full bg-primary px-6 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
    >
      Add to cart — ${(priceCents / 100).toFixed(2)}
    </button>
  )
}

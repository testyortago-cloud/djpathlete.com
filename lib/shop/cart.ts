"use client"
import { useCallback, useEffect, useState } from "react"

const KEY = "djp_shop_cart"

export interface CartLine {
  variant_id: string
  quantity: number
}

function read(): CartLine[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is CartLine =>
      typeof x?.variant_id === "string" && typeof x?.quantity === "number" && x.quantity > 0
    )
  } catch {
    return []
  }
}

function write(lines: CartLine[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(lines))
  window.dispatchEvent(new Event("djp-cart-change"))
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([])

  useEffect(() => {
    setLines(read())
    const onChange = () => setLines(read())
    window.addEventListener("djp-cart-change", onChange)
    window.addEventListener("storage", onChange)
    return () => {
      window.removeEventListener("djp-cart-change", onChange)
      window.removeEventListener("storage", onChange)
    }
  }, [])

  const addItem = useCallback((variant_id: string, quantity = 1) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variant_id === variant_id)
      const next =
        idx >= 0
          ? prev.map((l, i) =>
              i === idx ? { ...l, quantity: Math.min(99, l.quantity + quantity) } : l
            )
          : [...prev, { variant_id, quantity: Math.min(99, quantity) }]
      write(next)
      return next
    })
  }, [])

  const removeItem = useCallback((variant_id: string) => {
    setLines((prev) => {
      const next = prev.filter((l) => l.variant_id !== variant_id)
      write(next)
      return next
    })
  }, [])

  const updateQuantity = useCallback((variant_id: string, quantity: number) => {
    setLines((prev) => {
      const next =
        quantity <= 0
          ? prev.filter((l) => l.variant_id !== variant_id)
          : prev.map((l) =>
              l.variant_id === variant_id ? { ...l, quantity: Math.min(99, quantity) } : l
            )
      write(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    write([])
    setLines([])
  }, [])

  const totalItems = lines.reduce((sum, l) => sum + l.quantity, 0)
  return {
    lines,
    totalItems,
    hasItems: lines.length > 0,
    addItem,
    removeItem,
    updateQuantity,
    clear,
  }
}

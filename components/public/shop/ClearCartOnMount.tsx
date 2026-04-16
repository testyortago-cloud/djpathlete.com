"use client"
import { useEffect } from "react"
import { useCart } from "@/lib/shop/cart"

export function ClearCartOnMount() {
  const { clear } = useCart()

  useEffect(() => {
    clear()
  }, [clear])

  return null
}

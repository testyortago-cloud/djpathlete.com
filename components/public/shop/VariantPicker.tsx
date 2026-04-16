"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { useCart } from "@/lib/shop/cart"
import type { ShopProduct, ShopProductVariant } from "@/types/database"

interface VariantPickerProps {
  product: ShopProduct
  variants: ShopProductVariant[]
}

const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL"]

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

export function VariantPicker({ product, variants }: VariantPickerProps) {
  const { addItem } = useCart()

  // Derive unique sizes and colors from available variants
  const sizes = unique(
    variants
      .map((v) => v.size)
      .filter((s): s is string => s !== null && s !== ""),
  )
  const colors = unique(
    variants
      .map((v) => v.color)
      .filter((c): c is string => c !== null && c !== ""),
  )

  const isStandardSizes =
    sizes.length > 0 && sizes.every((s) => STANDARD_SIZES.includes(s))

  // Default to first variant's values
  const defaultSize = variants[0]?.size ?? null
  const defaultColor = variants[0]?.color ?? null

  const [selectedSize, setSelectedSize] = useState<string | null>(defaultSize)
  const [selectedColor, setSelectedColor] = useState<string | null>(defaultColor)
  const [quantity, setQuantity] = useState(1)
  const [addedToCart, setAddedToCart] = useState(false)

  // Find matching variant
  const selectedVariant = variants.find((v) => {
    const sizeMatch = sizes.length === 0 || v.size === selectedSize
    const colorMatch = colors.length === 0 || v.color === selectedColor
    return sizeMatch && colorMatch
  }) ?? null

  const isAvailable = selectedVariant !== null

  const imageSrc =
    selectedVariant?.mockup_url_override ??
    selectedVariant?.mockup_url ??
    product.thumbnail_url_override ??
    product.thumbnail_url

  function handleAddToCart() {
    if (!selectedVariant) return
    addItem(selectedVariant.id, quantity)
    toast.success(`${product.name} added to cart!`)
    setAddedToCart(true)
  }

  function handleQuantityChange(delta: number) {
    setQuantity((q) => Math.min(99, Math.max(1, q + delta)))
  }

  function handleQuantityInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10)
    if (!isNaN(val)) {
      setQuantity(Math.min(99, Math.max(1, val)))
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
      {/* Image */}
      <div className="aspect-square bg-surface rounded-2xl overflow-hidden">
        {imageSrc ? (
          // Printful CDN domains are not configured in next.config.mjs remotePatterns,
          // so plain <img> is used for v1.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-sm text-muted-foreground">No image available</span>
          </div>
        )}
      </div>

      {/* Product info + pickers */}
      <div className="flex flex-col gap-6">
        {/* Name */}
        <h1 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight leading-tight">
          {product.name}
        </h1>

        {/* Price */}
        <p className="text-2xl font-body font-semibold text-accent">
          {selectedVariant ? formatPrice(selectedVariant.retail_price_cents) : "Unavailable"}
        </p>

        {/* Description */}
        {product.description && (
          <div
            className="prose prose-sm max-w-none text-muted-foreground font-body"
            dangerouslySetInnerHTML={{ __html: product.description }}
          />
        )}

        {/* Color picker */}
        {colors.length > 0 && (
          <div>
            <p className="text-sm font-medium text-primary mb-2">
              Color: <span className="font-normal text-muted-foreground">{selectedColor}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    setSelectedColor(color)
                    setAddedToCart(false)
                  }}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    selectedColor === color
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-primary hover:border-primary"
                  }`}
                >
                  {color}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Size picker */}
        {sizes.length > 0 && (
          <div>
            <p className="text-sm font-medium text-primary mb-2">Size</p>
            {isStandardSizes ? (
              <div className="flex flex-wrap gap-2">
                {STANDARD_SIZES.filter((s) => sizes.includes(s)).map((size) => {
                  const combo = variants.find((v) => {
                    const sizeMatch = v.size === size
                    const colorMatch = colors.length === 0 || v.color === selectedColor
                    return sizeMatch && colorMatch
                  })
                  const unavailable = !combo
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        setSelectedSize(size)
                        setAddedToCart(false)
                      }}
                      disabled={unavailable}
                      className={`w-12 h-12 rounded-lg border text-sm font-medium transition-colors ${
                        selectedSize === size
                          ? "border-primary bg-primary text-primary-foreground"
                          : unavailable
                            ? "border-border bg-background text-muted-foreground opacity-40 cursor-not-allowed"
                            : "border-border bg-background text-primary hover:border-primary"
                      }`}
                    >
                      {size}
                    </button>
                  )
                })}
              </div>
            ) : (
              <select
                value={selectedSize ?? ""}
                onChange={(e) => {
                  setSelectedSize(e.target.value || null)
                  setAddedToCart(false)
                }}
                className="border border-border rounded-lg px-3 py-2 text-sm text-primary bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {sizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Combination unavailable warning */}
        {!isAvailable && (sizes.length > 0 || colors.length > 0) && (
          <p className="text-sm text-destructive font-medium">
            This combination is not available. Please choose a different size or color.
          </p>
        )}

        {/* Quantity */}
        <div>
          <p className="text-sm font-medium text-primary mb-2">Quantity</p>
          <div className="flex items-center gap-0 border border-border rounded-lg w-fit overflow-hidden">
            <button
              type="button"
              onClick={() => handleQuantityChange(-1)}
              disabled={quantity <= 1}
              className="w-10 h-10 flex items-center justify-center text-lg font-medium text-primary hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={99}
              value={quantity}
              onChange={handleQuantityInput}
              className="w-12 h-10 text-center text-sm font-medium text-primary bg-background border-x border-border focus:outline-none"
            />
            <button
              type="button"
              onClick={() => handleQuantityChange(1)}
              disabled={quantity >= 99}
              className="w-10 h-10 flex items-center justify-center text-lg font-medium text-primary hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>

        {/* Add to Cart */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={!isAvailable}
            className="w-full sm:w-auto flex-1 sm:flex-none px-8 py-3 rounded-xl bg-primary text-primary-foreground font-medium font-body hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity text-sm"
          >
            {isAvailable ? "Add to Cart" : "Unavailable"}
          </button>

          {addedToCart && (
            <Link
              href="/shop/cart"
              className="text-sm font-medium text-accent underline underline-offset-2 hover:text-primary transition-colors"
            >
              View Cart →
            </Link>
          )}
        </div>

        {/* Single-variant note: if only one variant exists, no pickers are shown — just one-click add */}
      </div>
    </div>
  )
}

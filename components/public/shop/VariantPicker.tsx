"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Minus,
  Plus,
  Star,
  Truck,
  RotateCcw,
  ShieldCheck,
  Check,
  ChevronDown,
  Ruler,
  ShoppingBag,
} from "lucide-react"
import { useCart } from "@/lib/shop/cart"
import type { ShopProduct, ShopProductVariant } from "@/types/database"

interface VariantPickerProps {
  product: ShopProduct
  variants: ShopProductVariant[]
}

const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL"]

const COLOR_DOT_MAP: Record<string, string> = {
  black: "#111111",
  white: "#f4f4f4",
  navy: "#0e1f3a",
  heather: "#9aa3ad",
  gray: "#8a8f95",
  grey: "#8a8f95",
  charcoal: "#2c2c2c",
  red: "#b3261e",
  green: "#2e6f3f",
  olive: "#59663d",
  sand: "#d7c6a5",
  cream: "#efe9da",
}

function colorToSwatch(color: string): string {
  const key = color.toLowerCase().trim()
  for (const k of Object.keys(COLOR_DOT_MAP)) {
    if (key.includes(k)) return COLOR_DOT_MAP[k]
  }
  return "#c9c4bc"
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

export function VariantPicker({ product, variants }: VariantPickerProps) {
  const router = useRouter()
  const { addItem } = useCart()

  const sizes = unique(
    variants.map((v) => v.size).filter((s): s is string => s !== null && s !== ""),
  )
  const colors = unique(
    variants.map((v) => v.color).filter((c): c is string => c !== null && c !== ""),
  )

  const isStandardSizes =
    sizes.length > 0 && sizes.every((s) => STANDARD_SIZES.includes(s))

  const defaultSize = variants[0]?.size ?? null
  const defaultColor = variants[0]?.color ?? null

  const [selectedSize, setSelectedSize] = useState<string | null>(defaultSize)
  const [selectedColor, setSelectedColor] = useState<string | null>(defaultColor)
  const [quantity, setQuantity] = useState(1)
  const [addedToCart, setAddedToCart] = useState(false)
  const [activeImage, setActiveImage] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<string | null>("details")

  const selectedVariant =
    variants.find((v) => {
      const sizeMatch = sizes.length === 0 || v.size === selectedSize
      const colorMatch = colors.length === 0 || v.color === selectedColor
      return sizeMatch && colorMatch
    }) ?? null

  const isAvailable = selectedVariant !== null

  const minPriceCents = variants.reduce(
    (min, v) => Math.min(min, v.retail_price_cents),
    variants[0].retail_price_cents,
  )
  const maxPriceCents = variants.reduce(
    (max, v) => Math.max(max, v.retail_price_cents),
    variants[0].retail_price_cents,
  )
  const hasPriceRange = minPriceCents !== maxPriceCents

  // Gallery for the currently selected variant — every mockup returned by
  // Printful (front, back, flat, sleeve, lifestyle…). Falls back to the legacy
  // single-image fields if the array hasn't been populated by a sync yet.
  const gallery = useMemo(() => {
    const images: string[] = []
    if (selectedVariant?.mockup_url_override) {
      images.push(selectedVariant.mockup_url_override)
    } else if (selectedVariant) {
      if (
        Array.isArray(selectedVariant.mockup_urls) &&
        selectedVariant.mockup_urls.length > 0
      ) {
        images.push(...selectedVariant.mockup_urls)
      } else if (selectedVariant.mockup_url) {
        images.push(selectedVariant.mockup_url)
      }
    }
    const fallback = product.thumbnail_url_override ?? product.thumbnail_url
    if (images.length === 0 && fallback) images.push(fallback)
    return Array.from(new Set(images))
  }, [selectedVariant, product])

  const autoImage = gallery[0] ?? null
  // If the active thumb was from a previous variant's gallery, fall back to the
  // current variant's first image instead of showing a stale selection.
  const mainImage =
    activeImage && gallery.includes(activeImage) ? activeImage : autoImage

  function handleAddToCart() {
    if (!selectedVariant) return
    addItem(selectedVariant.id, quantity)
    toast.success(`${product.name} added to cart`)
    setAddedToCart(true)
  }

  function handleBuyNow() {
    if (!selectedVariant) return
    addItem(selectedVariant.id, quantity)
    router.push("/shop/checkout")
  }

  function handleQuantityChange(delta: number) {
    setQuantity((q) => Math.min(99, Math.max(1, q + delta)))
  }

  function handleQuantityInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10)
    if (!isNaN(val)) setQuantity(Math.min(99, Math.max(1, val)))
  }

  function toggleSection(id: string) {
    setOpenSection((cur) => (cur === id ? null : id))
  }

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
      {/* Gallery */}
      <div className="lg:col-span-7">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-muted via-background to-muted ring-1 ring-border/60">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-multiply"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 10%, black 0.5px, transparent 1.5px)",
              backgroundSize: "6px 6px",
            }}
            aria-hidden="true"
          />
          <div className="relative aspect-square">
            {mainImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mainImage}
                alt={product.name}
                className="absolute inset-0 h-full w-full object-contain p-8 transition-opacity duration-300 sm:p-12"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className="text-sm text-muted-foreground">
                  No image available
                </span>
              </div>
            )}
          </div>
          {product.is_featured && (
            <span className="absolute left-5 top-5 rounded-full bg-primary px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-primary-foreground">
              Featured
            </span>
          )}
        </div>

        {gallery.length > 1 && (
          <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
            {gallery.map((img) => {
              const isActive = (activeImage ?? autoImage) === img
              return (
                <button
                  key={img}
                  type="button"
                  onClick={() => setActiveImage(img)}
                  className={`relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted transition-all ${
                    isActive
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "ring-1 ring-border hover:ring-primary/60"
                  }`}
                  aria-label="Show image"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img}
                    alt=""
                    className="h-full w-full object-contain p-2"
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Right — info & buy */}
      <div className="lg:col-span-5">
        <div className="lg:sticky lg:top-28">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">
              DJP Performance
            </span>
            <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/60" />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Apparel
            </span>
          </div>

          <h1 className="mt-3 font-heading text-4xl font-semibold leading-[1.05] tracking-tight text-primary sm:text-5xl">
            {product.name}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1">
              <div className="flex items-center gap-0.5 text-accent">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} className="size-3.5 fill-accent" />
                ))}
              </div>
              <span className="font-mono text-[11px] font-medium text-primary">
                5.0
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                · New
              </span>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              SKU {selectedVariant?.sku ?? "—"}
            </span>
          </div>

          <div className="mt-6 flex items-baseline gap-3">
            <span className="font-heading text-3xl font-semibold text-primary">
              {selectedVariant
                ? formatPrice(selectedVariant.retail_price_cents)
                : "Unavailable"}
            </span>
            {hasPriceRange && !selectedVariant && (
              <span className="font-body text-sm text-muted-foreground">
                from {formatPrice(minPriceCents)}
              </span>
            )}
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              USD · Tax incl.
            </span>
          </div>

          {/* Color */}
          {colors.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between">
                <p className="font-body text-sm font-medium text-primary">
                  Color ·{" "}
                  <span className="text-muted-foreground">{selectedColor}</span>
                </p>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {colors.length} option{colors.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                {colors.map((color) => {
                  const isSelected = selectedColor === color
                  return (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      onClick={() => {
                        setSelectedColor(color)
                        setAddedToCart(false)
                        setActiveImage(null)
                      }}
                      className={`group relative flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 transition ${
                        isSelected
                          ? "border-primary bg-primary/[0.04]"
                          : "border-border hover:border-primary/60"
                      }`}
                    >
                      <span
                        className="size-6 rounded-full ring-1 ring-border"
                        style={{ backgroundColor: colorToSwatch(color) }}
                      />
                      <span className="font-body text-xs font-medium text-primary">
                        {color}
                      </span>
                      {isSelected && (
                        <Check className="size-3 text-primary" strokeWidth={3} />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Size */}
          {sizes.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between">
                <p className="font-body text-sm font-medium text-primary">Size</p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 font-body text-xs font-medium text-primary underline underline-offset-4 hover:text-accent"
                >
                  <Ruler className="size-3.5" />
                  Size guide
                </button>
              </div>
              {isStandardSizes ? (
                <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {STANDARD_SIZES.filter((s) => sizes.includes(s)).map((size) => {
                    const combo = variants.find((v) => {
                      const sizeMatch = v.size === size
                      const colorMatch =
                        colors.length === 0 || v.color === selectedColor
                      return sizeMatch && colorMatch
                    })
                    const unavailable = !combo
                    const isSelected = selectedSize === size
                    return (
                      <button
                        key={size}
                        type="button"
                        disabled={unavailable}
                        onClick={() => {
                          setSelectedSize(size)
                          setAddedToCart(false)
                        }}
                        className={`h-11 rounded-lg border font-body text-sm font-medium transition-all ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : unavailable
                              ? "cursor-not-allowed border-border bg-muted/40 text-muted-foreground line-through opacity-50"
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
                  className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2.5 font-body text-sm text-primary focus:outline-none focus:ring-2 focus:ring-primary"
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

          {!isAvailable && (sizes.length > 0 || colors.length > 0) && (
            <p className="mt-4 font-body text-sm font-medium text-destructive">
              This combination is unavailable. Please pick another size or color.
            </p>
          )}

          {/* Quantity */}
          <div className="mt-8">
            <p className="font-body text-sm font-medium text-primary">Quantity</p>
            <div className="mt-3 inline-flex items-center overflow-hidden rounded-full border border-border">
              <button
                type="button"
                onClick={() => handleQuantityChange(-1)}
                disabled={quantity <= 1}
                className="flex size-11 items-center justify-center text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Decrease quantity"
              >
                <Minus className="size-4" />
              </button>
              <input
                type="number"
                min={1}
                max={99}
                value={quantity}
                onChange={handleQuantityInput}
                className="h-11 w-12 border-x border-border bg-background text-center font-body text-sm font-medium text-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleQuantityChange(1)}
                disabled={quantity >= 99}
                className="flex size-11 items-center justify-center text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Increase quantity"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>

          {/* CTAs */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!isAvailable}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary font-body text-sm font-medium text-primary-foreground transition-all hover:shadow-lg hover:shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ShoppingBag className="size-4" />
              {isAvailable ? "Add to cart" : "Unavailable"}
            </button>
            <button
              type="button"
              onClick={handleBuyNow}
              disabled={!isAvailable}
              className="inline-flex h-12 flex-1 items-center justify-center rounded-full border border-primary bg-background font-body text-sm font-medium text-primary transition-all hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Buy it now
            </button>
          </div>

          {addedToCart && (
            <Link
              href="/shop/cart"
              className="mt-4 inline-flex items-center gap-1 font-body text-sm font-medium text-accent underline underline-offset-4 hover:text-primary"
            >
              View cart →
            </Link>
          )}

          {/* Trust row */}
          <div className="mt-8 grid grid-cols-3 gap-3 rounded-2xl border border-border bg-muted/30 p-4">
            {[
              { icon: Truck, label: "Ships in 5–7 days" },
              { icon: RotateCcw, label: "30-day returns" },
              { icon: ShieldCheck, label: "Secure checkout" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-1.5 text-center"
              >
                <Icon className="size-4 text-accent" />
                <span className="font-body text-[11px] font-medium text-primary">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Accordion */}
          <div className="mt-10 border-t border-border">
            {[
              {
                id: "details",
                title: "Details",
                body: product.description ? (
                  <div
                    className="prose prose-sm max-w-none font-body text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: product.description }}
                  />
                ) : (
                  <p className="font-body text-sm text-muted-foreground">
                    Premium performance fabric, fitted cut, and DJP signature
                    embroidery. Made to move with you — gym, field, or street.
                  </p>
                ),
              },
              {
                id: "shipping",
                title: "Shipping & Returns",
                body: (
                  <ul className="space-y-2 font-body text-sm text-muted-foreground">
                    <li>• Printed to order — fulfilled in 2–5 business days.</li>
                    <li>• Tracked shipping to US &amp; EU in 5–7 business days.</li>
                    <li>• 30-day return window. Item must be unworn and unwashed.</li>
                    <li>• Damaged or misprinted items replaced free of charge.</li>
                  </ul>
                ),
              },
              {
                id: "care",
                title: "Care & Materials",
                body: (
                  <ul className="space-y-2 font-body text-sm text-muted-foreground">
                    <li>• Machine wash cold, inside out.</li>
                    <li>• Tumble dry low or line dry.</li>
                    <li>• Do not iron directly on print.</li>
                    <li>• Do not dry clean or bleach.</li>
                  </ul>
                ),
              },
            ].map(({ id, title, body }) => {
              const isOpen = openSection === id
              return (
                <div
                  key={id}
                  className="border-b border-border"
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between py-5 text-left transition-colors hover:text-accent"
                  >
                    <span className="font-heading text-base font-semibold text-primary">
                      {title}
                    </span>
                    <ChevronDown
                      className={`size-4 text-primary transition-transform duration-300 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <div
                    className={`grid transition-all duration-300 ease-out ${
                      isOpen
                        ? "grid-rows-[1fr] pb-5 opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">{body}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

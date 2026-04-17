"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback } from "react"

export type ShopCategory = "all" | "pod" | "digital" | "affiliate"
export type ShopSort = "featured" | "newest" | "price-asc" | "price-desc"

const CATEGORIES: { value: ShopCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pod", label: "Apparel" },
  { value: "digital", label: "Digital" },
  { value: "affiliate", label: "Affiliate" },
]

interface Props {
  activeCategory: ShopCategory
  activeSort: ShopSort
  totalCount: number
  categoryCounts: Record<Exclude<ShopCategory, "all">, number>
}

export function ShopFilterBar({
  activeCategory,
  activeSort,
  totalCount,
  categoryCounts,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateParams = useCallback(
    (updates: Partial<Record<"category" | "sort", string>>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === "all" || (key === "sort" && value === "featured")) {
          next.delete(key)
        } else {
          next.set(key, value)
        }
      }
      const qs = next.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  return (
    <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
      <nav className="flex items-center gap-1 overflow-x-auto">
        {CATEGORIES.map(({ value, label }) => {
          const isActive = value === activeCategory
          const count = value === "all" ? totalCount : categoryCounts[value]
          return (
            <button
              key={value}
              type="button"
              onClick={() => updateParams({ category: value })}
              className={`shrink-0 rounded-full px-4 py-1.5 font-body text-sm transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-primary"
              }`}
            >
              {label}
              <span
                className={`ml-2 font-mono text-[10px] ${
                  isActive ? "opacity-80" : "opacity-60"
                }`}
              >
                {count}
              </span>
            </button>
          )
        })}
      </nav>
      <div className="hidden items-center gap-3 sm:flex">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Sort
        </span>
        <select
          value={activeSort}
          onChange={(e) => updateParams({ sort: e.target.value })}
          className="rounded-full border border-border bg-background px-3 py-1.5 font-body text-sm text-primary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="featured">Featured</option>
          <option value="newest">Newest</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </div>
    </div>
  )
}

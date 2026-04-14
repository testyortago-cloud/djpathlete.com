"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Video, Clock, MessageSquare, CheckCircle2, Search, ArrowUpDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FormReviewStatus } from "@/types/database"

interface ReviewItem {
  id: string
  title: string
  status: string
  created_at: string
  users?: { first_name: string; last_name: string; email: string } | null
}

interface FormReviewListProps {
  reviews: ReviewItem[]
  counts: { pending: number; in_progress: number; reviewed: number; total: number }
}

const tabs: { label: string; value: string; count?: keyof FormReviewListProps["counts"] }[] = [
  { label: "All", value: "all", count: "total" },
  { label: "Pending", value: "pending", count: "pending" },
  { label: "In Progress", value: "in_progress", count: "in_progress" },
  { label: "Reviewed", value: "reviewed", count: "reviewed" },
]

const statusConfig: Record<FormReviewStatus, { label: string; icon: typeof Clock; className: string }> = {
  pending: { label: "Pending", icon: Clock, className: "bg-amber-100 text-amber-700" },
  in_progress: { label: "In Progress", icon: MessageSquare, className: "bg-blue-100 text-blue-700" },
  reviewed: { label: "Reviewed", icon: CheckCircle2, className: "bg-green-100 text-green-700" },
}

type SortOrder = "newest" | "oldest"

export function FormReviewList({ reviews, counts }: FormReviewListProps) {
  const [activeTab, setActiveTab] = useState("all")
  const [search, setSearch] = useState("")
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest")

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()

    let result = reviews.filter((r) => {
      // Status tab
      if (activeTab !== "all" && r.status !== activeTab) return false

      // Search across athlete name, title, email
      if (q) {
        const clientName = r.users ? `${r.users.first_name} ${r.users.last_name}`.toLowerCase() : ""
        const email = r.users?.email?.toLowerCase() ?? ""
        const title = r.title.toLowerCase()
        if (!clientName.includes(q) && !email.includes(q) && !title.includes(q)) return false
      }

      return true
    })

    // Sort
    result = [...result].sort((a, b) => {
      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return sortOrder === "newest" ? diff : -diff
    })

    return result
  }, [reviews, activeTab, search, sortOrder])

  const hasActiveFilters = !!search

  return (
    <div>
      {/* Search & sort bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search athlete or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-white pl-9 pr-9 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <button
          onClick={() => setSortOrder((s) => (s === "newest" ? "oldest" : "newest"))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowUpDown className="size-3.5" />
          {sortOrder === "newest" ? "Newest first" : "Oldest first"}
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {tabs.map((tab) => {
          const count = tab.count ? counts[tab.count] : 0
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors shrink-0",
                activeTab === tab.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-white border border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full font-semibold",
                    activeTab === tab.value ? "bg-white/20 text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Active filter summary */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
          <span>
            {filtered.length} result{filtered.length !== 1 && "s"}
          </span>
          <button onClick={() => setSearch("")} className="text-primary hover:underline">
            Clear filters
          </button>
        </div>
      )}

      {/* Review list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {hasActiveFilters ? "No form reviews match your filters." : "No form reviews found."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((review) => {
            const config = statusConfig[review.status as FormReviewStatus]
            const StatusIcon = config?.icon ?? Clock
            const clientName = review.users ? `${review.users.first_name} ${review.users.last_name}` : "Unknown"

            return (
              <Link
                key={review.id}
                href={`/admin/form-reviews/${review.id}`}
                className="group flex items-center gap-4 bg-white rounded-xl border border-border p-4 hover:border-primary/30 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-center size-10 rounded-full bg-primary/10 shrink-0">
                  <Video className="size-5 text-primary" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                      {review.title}
                    </h3>
                    {config && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0",
                          config.className,
                        )}
                      >
                        <StatusIcon className="size-3" />
                        {config.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{clientName}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                  {new Date(review.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

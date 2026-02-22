"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Star,
  Eye,
  EyeOff,
  Trash2,
  Plus,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { ImportGoogleReviewDialog } from "@/components/admin/ImportGoogleReviewDialog"

export interface ReviewWithSource {
  id: string
  user_id: string
  rating: number
  comment: string | null
  is_published: boolean
  created_at: string
  updated_at: string
  source: "app" | "google"
  google_maps_uri?: string
  users: {
    first_name: string
    last_name: string
    avatar_url: string | null
  } | null
}

interface ReviewListProps {
  reviews: ReviewWithSource[]
}

const PAGE_SIZE_OPTIONS = [10, 25, 50]

type FilterTab = "all" | "published" | "unpublished" | "google"

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`size-3.5 ${
            i < rating
              ? "fill-warning text-warning"
              : "fill-none text-muted-foreground/40"
          }`}
        />
      ))}
    </span>
  )
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function ReviewList({ reviews }: ReviewListProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [filterTab, setFilterTab] = useState<FilterTab>("all")
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Action states
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReviewWithSource | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const filtered = reviews.filter((review) => {
    // Filter tab
    if (filterTab === "published" && !review.is_published) return false
    if (filterTab === "unpublished" && review.is_published) return false
    if (filterTab === "google" && review.source !== "google") return false

    // Search
    if (search) {
      const q = search.toLowerCase()
      const userName = review.users
        ? `${review.users.first_name} ${review.users.last_name}`.toLowerCase()
        : ""
      const comment = review.comment?.toLowerCase() ?? ""
      if (!userName.includes(q) && !comment.includes(q)) return false
    }

    return true
  })

  const totalPages = Math.ceil(filtered.length / perPage)
  const paginated = filtered.slice((page - 1) * perPage, page * perPage)

  async function handleTogglePublish(review: ReviewWithSource) {
    setTogglingId(review.id)
    try {
      const response = await fetch(`/api/admin/reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: !review.is_published }),
      })

      if (!response.ok) throw new Error("Failed to update")

      toast.success(
        review.is_published
          ? "Review unpublished"
          : "Review published"
      )
      router.refresh()
    } catch {
      toast.error("Failed to update review")
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      const isGoogle = deleteTarget.source === "google"
      const apiId = isGoogle
        ? deleteTarget.id.replace("google_", "")
        : deleteTarget.id
      const url = isGoogle
        ? `/api/admin/google-reviews/${apiId}`
        : `/api/admin/reviews/${apiId}`

      const response = await fetch(url, {
        method: "DELETE",
      })

      if (!response.ok) throw new Error("Failed to delete")

      toast.success("Review deleted successfully")
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error("Failed to delete review")
    } finally {
      setIsDeleting(false)
    }
  }

  if (reviews.length === 0) {
    return (
      <div>
        <div className="flex justify-end mb-4">
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            Import Google Reviews
          </Button>
        </div>
        <EmptyState
          icon={Star}
          heading="No reviews yet"
          description="Client reviews and testimonials will appear here once athletes submit their feedback."
        />
        <ImportGoogleReviewDialog
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      </div>
    )
  }

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: reviews.length },
    {
      key: "published",
      label: "Published",
      count: reviews.filter((r) => r.is_published).length,
    },
    {
      key: "unpublished",
      label: "Unpublished",
      count: reviews.filter((r) => !r.is_published).length,
    },
    {
      key: "google",
      label: "Google",
      count: reviews.filter((r) => r.source === "google").length,
    },
  ]

  return (
    <div>
      {/* Filter Tabs + Import Button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setFilterTab(tab.key)
              setPage(1)
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filterTab === tab.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-surface"
            }`}
          >
            {tab.label}
            <span
              className={`ml-1.5 text-xs ${
                filterTab === tab.key
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground/60"
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
        </div>
        <Button size="sm" onClick={() => setImportOpen(true)}>
          <Plus className="size-4 mr-1.5" />
          Import Google Reviews
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm">
        {/* Search */}
        <div className="p-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or comment..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="pl-9 h-9"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  User
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Rating
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
                  Comment
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Source
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
                  Date
                </th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((review) => (
                <tr
                  key={review.id}
                  className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {review.users
                      ? `${review.users.first_name} ${review.users.last_name}`
                      : "Unknown User"}
                  </td>
                  <td className="px-4 py-3">
                    <StarRating rating={review.rating} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-xs">
                    <span className="line-clamp-2">
                      {review.comment || "No comment"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {review.source === "google" ? (
                      <Badge variant="outline" className="text-xs">
                        Google
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        In-App
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {review.is_published ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-success/10 text-success">
                        Published
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-warning/10 text-warning">
                        Unpublished
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {formatDate(review.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {review.source === "app" && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleTogglePublish(review)}
                          disabled={togglingId === review.id}
                          title={
                            review.is_published
                              ? "Unpublish review"
                              : "Publish review"
                          }
                        >
                          {review.is_published ? (
                            <EyeOff className="size-3.5" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setDeleteTarget(review)}
                        title="Delete review"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    No reviews found matching your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-border flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value))
                setPage(1)
              }}
              className="h-8 rounded border border-border bg-white px-2 text-sm"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="ml-2">
              {filtered.length === 0
                ? "0"
                : `${(page - 1) * perPage + 1}-${Math.min(
                    page * perPage,
                    filtered.length
                  )}`}{" "}
              of {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Review</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the review from{" "}
              &ldquo;
              {deleteTarget?.users
                ? `${deleteTarget.users.first_name} ${deleteTarget.users.last_name}`
                : "Unknown User"}
              &rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportGoogleReviewDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  )
}

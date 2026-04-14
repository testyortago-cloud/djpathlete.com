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
  Heart,
  Trash2,
  Plus,
  Pencil,
  X,
  Check,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import type { Testimonial } from "@/types/database"

interface TestimonialListProps {
  testimonials: Testimonial[]
}

const PAGE_SIZE_OPTIONS = [10, 25, 50]

type FilterTab = "all" | "active" | "featured" | "inactive"

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`size-3.5 ${i < rating ? "fill-warning text-warning" : "fill-none text-muted-foreground/40"}`}
        />
      ))}
    </span>
  )
}

const emptyFormData = {
  name: "",
  role: "",
  sport: "",
  quote: "",
  rating: 5,
  is_featured: false,
  is_active: true,
  display_order: 0,
}

export function TestimonialList({ testimonials }: TestimonialListProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [filterTab, setFilterTab] = useState<FilterTab>("all")
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Action states
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Testimonial | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Form dialog
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState(emptyFormData)
  const [isSaving, setIsSaving] = useState(false)

  const filtered = testimonials.filter((t) => {
    if (filterTab === "active" && !t.is_active) return false
    if (filterTab === "featured" && !t.is_featured) return false
    if (filterTab === "inactive" && t.is_active) return false

    if (search) {
      const q = search.toLowerCase()
      const name = t.name.toLowerCase()
      const quote = t.quote.toLowerCase()
      const role = t.role?.toLowerCase() ?? ""
      if (!name.includes(q) && !quote.includes(q) && !role.includes(q)) return false
    }

    return true
  })

  const totalPages = Math.ceil(filtered.length / perPage)
  const paginated = filtered.slice((page - 1) * perPage, page * perPage)

  function openCreateForm() {
    setEditingId(null)
    setFormData({
      ...emptyFormData,
      display_order: testimonials.length + 1,
    })
    setFormOpen(true)
  }

  function openEditForm(t: Testimonial) {
    setEditingId(t.id)
    setFormData({
      name: t.name,
      role: t.role ?? "",
      sport: t.sport ?? "",
      quote: t.quote,
      rating: t.rating ?? 5,
      is_featured: t.is_featured,
      is_active: t.is_active,
      display_order: t.display_order,
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!formData.name.trim() || !formData.quote.trim()) {
      toast.error("Name and quote are required")
      return
    }

    setIsSaving(true)
    try {
      const url = editingId ? `/api/admin/testimonials/${editingId}` : "/api/admin/testimonials"
      const method = editingId ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          role: formData.role || null,
          sport: formData.sport || null,
        }),
      })

      if (!response.ok) throw new Error("Failed to save")

      toast.success(editingId ? "Testimonial updated" : "Testimonial created")
      setFormOpen(false)
      router.refresh()
    } catch {
      toast.error("Failed to save testimonial")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleToggle(t: Testimonial, field: "is_active" | "is_featured") {
    setTogglingId(t.id)
    try {
      const response = await fetch(`/api/admin/testimonials/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !t[field] }),
      })

      if (!response.ok) throw new Error("Failed to update")

      toast.success(
        field === "is_active"
          ? t.is_active
            ? "Testimonial deactivated"
            : "Testimonial activated"
          : t.is_featured
            ? "Removed from featured"
            : "Added to featured",
      )
      router.refresh()
    } catch {
      toast.error("Failed to update testimonial")
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      const response = await fetch(`/api/admin/testimonials/${deleteTarget.id}`, { method: "DELETE" })

      if (!response.ok) throw new Error("Failed to delete")

      toast.success("Testimonial deleted")
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error("Failed to delete testimonial")
    } finally {
      setIsDeleting(false)
    }
  }

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: testimonials.length },
    {
      key: "active",
      label: "Active",
      count: testimonials.filter((t) => t.is_active).length,
    },
    {
      key: "featured",
      label: "Featured",
      count: testimonials.filter((t) => t.is_featured).length,
    },
    {
      key: "inactive",
      label: "Inactive",
      count: testimonials.filter((t) => !t.is_active).length,
    },
  ]

  if (testimonials.length === 0) {
    return (
      <div>
        <div className="flex justify-end mb-4">
          <Button size="sm" onClick={openCreateForm}>
            <Plus className="size-4 mr-1.5" />
            Add Testimonial
          </Button>
        </div>
        <EmptyState
          icon={Star}
          heading="No testimonials yet"
          description="Add athlete testimonials to showcase on your website."
        />
        {renderFormDialog()}
      </div>
    )
  }

  function renderFormDialog() {
    return (
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Testimonial" : "Add Testimonial"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update the testimonial details below." : "Add a new athlete testimonial."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="t-name">Name *</Label>
                <Input
                  id="t-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Stephen Ireland"
                />
              </div>
              <div>
                <Label htmlFor="t-sport">Sport</Label>
                <Input
                  id="t-sport"
                  value={formData.sport}
                  onChange={(e) => setFormData({ ...formData, sport: e.target.value })}
                  placeholder="Football"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="t-role">Role / Title</Label>
              <Input
                id="t-role"
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                placeholder="Former Professional Football Player"
              />
            </div>

            <div>
              <Label htmlFor="t-quote">Quote *</Label>
              <Textarea
                id="t-quote"
                value={formData.quote}
                onChange={(e) => setFormData({ ...formData, quote: e.target.value })}
                placeholder="Their testimonial..."
                rows={4}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="t-rating">Rating</Label>
                <select
                  id="t-rating"
                  value={formData.rating}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      rating: Number(e.target.value),
                    })
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} star{n !== 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="t-order">Display Order</Label>
                <Input
                  id="t-order"
                  type="number"
                  value={formData.display_order}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      display_order: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-2 pt-5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formData.is_featured}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        is_featured: e.target.checked,
                      })
                    }
                    className="rounded border-border"
                  />
                  Featured
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        is_active: e.target.checked,
                      })
                    }
                    className="rounded border-border"
                  />
                  Active
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : editingId ? "Update" : "Add Testimonial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <div>
      {/* Filter Tabs + Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none -mx-1 px-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setFilterTab(tab.key)
                setPage(1)
              }}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors shrink-0 ${
                filterTab === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface"
              }`}
            >
              {tab.label}
              <span
                className={`ml-1 text-[10px] sm:text-xs ${
                  filterTab === tab.key ? "text-primary-foreground/70" : "text-muted-foreground/60"
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
        <Button size="sm" onClick={openCreateForm} className="shrink-0 self-end sm:self-auto">
          <Plus className="size-4" />
          <span className="hidden sm:inline">Add Testimonial</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm">
        {/* Search */}
        <div className="p-4 border-b border-border">
          <div className="relative sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, role, or quote..."
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
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Athlete</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Quote</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Rating</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Order</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <span className="text-xs font-semibold">{t.name.charAt(0)}</span>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{[t.role, t.sport].filter(Boolean).join(" · ")}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-xs">
                    <span className="line-clamp-2">{t.quote}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StarRating rating={t.rating ?? 0} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {t.is_active ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-success/10 text-success w-fit">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground w-fit">
                          Inactive
                        </span>
                      )}
                      {t.is_featured && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-warning/10 text-warning w-fit">
                          Featured
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{t.display_order}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon-xs" onClick={() => openEditForm(t)} title="Edit testimonial">
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleToggle(t, "is_active")}
                        disabled={togglingId === t.id}
                        title={t.is_active ? "Deactivate" : "Activate"}
                      >
                        {t.is_active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleToggle(t, "is_featured")}
                        disabled={togglingId === t.id}
                        title={t.is_featured ? "Remove from featured" : "Add to featured"}
                      >
                        <Heart
                          className={`size-3.5 ${
                            t.is_featured ? "fill-warning text-warning" : "text-muted-foreground"
                          }`}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setDeleteTarget(t)}
                        title="Delete testimonial"
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
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No testimonials found matching your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-3 sm:p-4 border-t border-border flex items-center justify-between text-xs sm:text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="hidden sm:inline">Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value))
                setPage(1)
              }}
              className="h-7 sm:h-8 rounded border border-border bg-white px-1.5 sm:px-2 text-xs sm:text-sm"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="sm:ml-2">
              {filtered.length === 0 ? "0" : `${(page - 1) * perPage + 1}-${Math.min(page * perPage, filtered.length)}`}{" "}
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
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Testimonial</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the testimonial from &ldquo;{deleteTarget?.name}&rdquo;? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Form Dialog */}
      {renderFormDialog()}
    </div>
  )
}

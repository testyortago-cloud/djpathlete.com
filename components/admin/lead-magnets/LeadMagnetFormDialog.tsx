"use client"

import { useState, useEffect } from "react"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BLOG_CATEGORIES } from "@/lib/validators/blog-post"
import type { LeadMagnet, BlogCategory } from "@/types/database"

interface LeadMagnetFormDialogProps {
  magnet: LeadMagnet | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function LeadMagnetFormDialog({ magnet, open, onOpenChange, onSaved }: LeadMagnetFormDialogProps) {
  const [slug, setSlug] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [assetUrl, setAssetUrl] = useState("")
  const [category, setCategory] = useState<BlogCategory | "">("")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (magnet) {
      setSlug(magnet.slug)
      setTitle(magnet.title)
      setDescription(magnet.description)
      setAssetUrl(magnet.asset_url)
      setCategory(magnet.category ?? "")
      setTags(magnet.tags)
      setActive(magnet.active)
    } else {
      setSlug("")
      setTitle("")
      setDescription("")
      setAssetUrl("")
      setCategory("")
      setTags([])
      setActive(true)
    }
    setTagInput("")
    setError(null)
  }, [magnet, open])

  function addTag() {
    const t = tagInput.trim().toLowerCase()
    if (!t) return
    if (tags.includes(t)) return
    if (tags.length >= 10) return
    setTags((prev) => [...prev, t])
    setTagInput("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const body = {
        slug,
        title,
        description,
        asset_url: assetUrl,
        category: category || null,
        tags,
        active,
      }
      const url = magnet ? `/api/admin/lead-magnets/${magnet.id}` : "/api/admin/lead-magnets"
      const method = magnet ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Save failed")
      }
      toast.success(magnet ? "Lead magnet updated" : "Lead magnet created")
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{magnet ? "Edit lead magnet" : "New lead magnet"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={140}
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={120}
              pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">Lowercase letters, numbers, hyphens.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={400}
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Asset URL <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              required
              value={assetUrl}
              onChange={(e) => setAssetUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">Direct URL to the PDF or asset (Supabase Storage, S3, etc.).</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory((e.target.value as BlogCategory) || "")}
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="">Any</option>
              {BLOG_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Tags (max 10)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addTag()
                  }
                }}
                placeholder="add and press Enter"
                className="flex-1 px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <button
                type="button"
                onClick={addTag}
                disabled={!tagInput.trim() || tags.length >= 10}
                className="px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-surface transition-colors disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.map((t, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-border text-xs">
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-muted-foreground hover:text-red-500"
                      aria-label={`Remove ${t}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="lead-magnet-active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 rounded border-border"
            />
            <label htmlFor="lead-magnet-active" className="text-sm text-foreground">
              Active (rendered on public posts)
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {saving ? "Saving..." : magnet ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

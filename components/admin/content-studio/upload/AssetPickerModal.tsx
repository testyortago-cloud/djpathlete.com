"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, FileImage, Search, X } from "lucide-react"
import type { AssetWithPostCount } from "@/lib/db/media-assets"

type OriginFilter = "all" | "uploaded" | "video_derived" | "quote_card"

export interface PickedAsset {
  id: string
  filename: string
  thumbnailUrl: string | null
}

interface AssetPickerModalProps {
  open: boolean
  onClose: () => void
  onPick: (asset: PickedAsset) => void
  excludeIds?: string[]
  title?: string
}

function originOf(asset: AssetWithPostCount): OriginFilter {
  if (asset.derived_from_video_id) {
    const origin = (asset.ai_analysis as { origin?: string } | null)?.origin
    return origin === "quote_card" ? "quote_card" : "video_derived"
  }
  return "uploaded"
}

function filenameFromPath(path: string): string {
  const last = path.split("/").pop()
  return last && last.length > 0 ? last : path
}

export function AssetPickerModal({
  open,
  onClose,
  onPick,
  excludeIds = [],
  title = "Pick from library",
}: AssetPickerModalProps) {
  const [assets, setAssets] = useState<AssetWithPostCount[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [origin, setOrigin] = useState<OriginFilter>("all")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/media-assets?kind=image")
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      const body = (await res.json()) as {
        assets: AssetWithPostCount[]
        thumbnailUrls: Record<string, string>
      }
      setAssets(body.assets ?? [])
      setThumbs(body.thumbnailUrls ?? {})
    } catch (err) {
      setError((err as Error).message || "Failed to load assets")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setSelectedId(null)
      setQuery("")
      void load()
    }
  }, [open, load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets.filter((a) => {
      if (excludeSet.has(a.id)) return false
      if (origin !== "all" && originOf(a) !== origin) return false
      if (q) {
        const name = filenameFromPath(a.storage_path).toLowerCase()
        const alt = (a.ai_alt_text ?? "").toLowerCase()
        if (!name.includes(q) && !alt.includes(q)) return false
      }
      return true
    })
  }, [assets, query, origin, excludeSet])

  if (!open) return null

  function confirm() {
    const asset = assets.find((a) => a.id === selectedId)
    if (!asset) return
    onPick({
      id: asset.id,
      filename: filenameFromPath(asset.storage_path),
      thumbnailUrl: thumbs[asset.id] ?? null,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-white rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <h3 className="font-heading text-base text-primary">{title}</h3>
            <p className="text-xs text-muted-foreground">
              Choose an existing image from your asset library.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close picker"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-surface/30">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search filenames or alt text…"
              className="w-full pl-7 pr-2 py-1.5 text-sm rounded border border-border bg-white"
            />
          </div>
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            Origin
            <select
              aria-label="Origin filter"
              value={origin}
              onChange={(e) => setOrigin(e.target.value as OriginFilter)}
              className="rounded border border-border px-2 py-1.5 text-xs bg-white"
            >
              <option value="all">All</option>
              <option value="uploaded">Uploaded</option>
              <option value="video_derived">Video-derived</option>
              <option value="quote_card">AI quote-card</option>
            </select>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-10">Loading library…</p>
          ) : error ? (
            <p className="text-sm text-error text-center py-10">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              {assets.length === 0
                ? "No image assets yet. Upload from the Assets tab first."
                : "No assets match your filters."}
            </p>
          ) : (
            <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {filtered.map((asset) => {
                const name = filenameFromPath(asset.storage_path)
                const thumb = thumbs[asset.id]
                const isSelected = selectedId === asset.id
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(asset.id)}
                      onDoubleClick={() => {
                        setSelectedId(asset.id)
                        onPick({
                          id: asset.id,
                          filename: name,
                          thumbnailUrl: thumb ?? null,
                        })
                        onClose()
                      }}
                      className={`group relative block w-full rounded-lg border-2 overflow-hidden text-left transition-colors ${
                        isSelected
                          ? "border-primary ring-2 ring-primary/20"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="relative aspect-square bg-muted">
                        {thumb ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={thumb}
                            alt={asset.ai_alt_text ?? name}
                            loading="lazy"
                            draggable={false}
                            className="absolute inset-0 size-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <FileImage className="size-6 text-muted-foreground" />
                          </div>
                        )}
                        {isSelected ? (
                          <div className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                            <Check className="size-3.5" strokeWidth={3} />
                          </div>
                        ) : null}
                      </div>
                      <p
                        className="px-2 py-1 text-[11px] text-muted-foreground truncate"
                        title={name}
                      >
                        {name}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border bg-surface/30">
          <p className="text-[11px] text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "asset" : "assets"}
            {excludeIds.length > 0 ? ` · ${excludeIds.length} already picked` : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!selectedId}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use selected
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

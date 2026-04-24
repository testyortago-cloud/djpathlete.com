"use client"

import { useMemo, useState } from "react"
import { FileImage, Film } from "lucide-react"
import type { AssetWithPostCount } from "@/lib/db/media-assets"

type KindFilter = "all" | "image" | "video"
type OriginFilter = "all" | "uploaded" | "video_derived" | "quote_card"

interface AssetsListProps {
  assets: AssetWithPostCount[]
  thumbnailUrls?: Record<string, string>
}

function originOf(asset: AssetWithPostCount): { key: OriginFilter; label: string } {
  if (asset.derived_from_video_id) {
    const origin = (asset.ai_analysis as { origin?: string } | null)?.origin
    if (origin === "quote_card") return { key: "quote_card", label: "AI quote-card" }
    return { key: "video_derived", label: "Video-derived" }
  }
  return { key: "uploaded", label: "Uploaded" }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

function filenameFromStoragePath(path: string): string {
  const last = path.split("/").pop()
  return last && last.length > 0 ? last : path
}

export function AssetsList({ assets, thumbnailUrls }: AssetsListProps) {
  const [kindFilter, setKindFilter] = useState<KindFilter>("all")
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all")

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (kindFilter !== "all" && a.kind !== kindFilter) return false
      if (originFilter !== "all" && originOf(a).key !== originFilter) return false
      return true
    })
  }, [assets, kindFilter, originFilter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
        <label className="text-xs text-muted-foreground">
          Kind
          <select
            aria-label="Kind"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            className="ml-2 rounded border border-border px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Origin
          <select
            aria-label="Origin"
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}
            className="ml-2 rounded border border-border px-2 py-1 text-sm"
          >
            <option value="all">All origins</option>
            <option value="uploaded">Originals</option>
            <option value="video_derived">Frames from videos</option>
            <option value="quote_card">Quote cards (AI)</option>
          </select>
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {assets.length} assets
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No assets match the current filters.
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-lg bg-white">
          {filtered.map((asset) => {
            const origin = originOf(asset)
            const Icon = asset.kind === "video" ? Film : FileImage
            const filename = filenameFromStoragePath(asset.storage_path)
            return (
              <li
                key={asset.id}
                className="flex items-start gap-3 px-4 py-3"
              >
                {asset.kind === "image" && thumbnailUrls?.[asset.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnailUrls[asset.id]}
                    alt={asset.ai_alt_text ?? ""}
                    loading="lazy"
                    className="size-10 shrink-0 rounded-md object-cover ring-1 ring-border"
                  />
                ) : (
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Icon className="size-4 text-primary" />
                  </span>
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className="text-sm font-medium text-primary truncate"
                      title={filename}
                    >
                      {filename}
                    </p>
                    <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                      {origin.label}
                    </span>
                  </div>
                  {asset.ai_alt_text ? (
                    <p className="text-xs text-muted-foreground italic line-clamp-2" title={asset.ai_alt_text}>
                      “{asset.ai_alt_text}”
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground font-mono">
                    <span>{asset.kind}</span>
                    <span>{formatSize(asset.bytes)}</span>
                    {asset.width && asset.height ? (
                      <span>
                        {asset.width}×{asset.height}
                      </span>
                    ) : null}
                    <span>{new Date(asset.created_at).toLocaleDateString()}</span>
                    <span>
                      {asset.post_count} {asset.post_count === 1 ? "post" : "posts"}
                    </span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

"use client"

import { Layers, CircleCheck, Clock } from "lucide-react"
import type { TeamVideoVersion } from "@/types/database"

export interface VersionRow extends TeamVideoVersion {
  /** Pre-fetched signed read URL, or null if the version isn't uploaded yet. */
  signedUrl: string | null
}

interface Props {
  versions: VersionRow[]
  /** Currently displayed version's id. */
  selectedId: string | null
  onSelect: (versionId: string) => void
}

function formatBytes(b: number | null): string {
  if (b == null || b <= 0) return "—"
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(iso: string | null): string {
  if (!iso) return "Pending upload"
  const d = new Date(iso)
  const now = Date.now()
  const diffMs = now - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function VersionHistoryList({ versions, selectedId, onSelect }: Props) {
  if (versions.length <= 1) return null

  // Newest first feels right when scanning history.
  const sorted = [...versions].sort((a, b) => b.version_number - a.version_number)

  return (
    <section
      aria-labelledby="version-history-heading"
      className="rounded-md border bg-card overflow-hidden"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" strokeWidth={1.5} />
          <h3
            id="version-history-heading"
            className="font-heading text-sm font-medium text-primary"
          >
            Version history
          </h3>
        </div>
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
          {versions.length} versions
        </span>
      </header>

      <ul role="list" className="divide-y divide-border">
        {sorted.map((v) => {
          const isSelected = v.id === selectedId
          const isUploaded = v.status === "uploaded" && v.signedUrl != null
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => isUploaded && onSelect(v.id)}
                disabled={!isUploaded}
                aria-current={isSelected ? "true" : undefined}
                aria-label={`View version ${v.version_number}`}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed ${
                  isSelected
                    ? "bg-primary/5"
                    : isUploaded
                      ? "hover:bg-muted/40"
                      : "opacity-60"
                }`}
              >
                {/* Version number plate */}
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-md font-mono text-xs font-medium tabular-nums ${
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  v{v.version_number}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-primary" title={v.original_filename}>
                      {v.original_filename}
                    </p>
                    {isSelected && (
                      <span className="font-mono text-[9px] tracking-widest uppercase text-accent">
                        viewing
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {formatDate(v.uploaded_at)} · {formatBytes(v.size_bytes)}
                  </p>
                </div>

                <span
                  className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide uppercase text-muted-foreground"
                  title={isUploaded ? "Ready to play" : "Awaiting finalize"}
                >
                  {isUploaded ? (
                    <CircleCheck className="size-3 text-success" strokeWidth={1.5} />
                  ) : (
                    <Clock className="size-3" strokeWidth={1.5} />
                  )}
                  {isUploaded ? "ready" : "pending"}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

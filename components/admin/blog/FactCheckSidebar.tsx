"use client"

import { useState } from "react"
import { X, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

export interface FactCheckFlaggedClaim {
  claim: string
  span_start: number | null
  span_end: number | null
  source_urls_checked: string[]
  verdict: "unverifiable" | "contradicted"
  notes: string
}

export interface FactCheckDetails {
  flagged_claims: FactCheckFlaggedClaim[]
  generated_at?: string
  model?: string
}

interface FactCheckSidebarProps {
  claims: FactCheckFlaggedClaim[]
  onClose: () => void
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function FactCheckSidebar({ claims, onClose }: FactCheckSidebarProps) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  return (
    <aside
      className="w-80 shrink-0 border-l border-border bg-surface/50 flex flex-col overflow-hidden"
      aria-label="Fact-check sidebar"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold text-primary">Flagged claims</div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-primary"
          aria-label="Close fact-check sidebar"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">No flagged claims.</p>
        ) : (
          claims.map((c, i) => {
            const isDismissed = dismissed.has(i)
            return (
              <div
                key={i}
                className={cn(
                  "border border-border rounded-md bg-card p-3 text-sm",
                  isDismissed && "opacity-60",
                )}
              >
                <blockquote className={cn("italic text-primary", isDismissed && "line-through")}>
                  {c.claim}
                </blockquote>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full font-medium",
                      c.verdict === "contradicted"
                        ? "bg-error/10 text-error"
                        : "bg-warning/10 text-warning",
                    )}
                  >
                    {c.verdict}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{c.notes}</p>
                {c.source_urls_checked.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {c.source_urls_checked.map((u) => (
                      <li key={u} className="text-xs">
                        <a
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <ExternalLink className="size-3" />
                          {domainOf(u)}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {!isDismissed && (
                  <button
                    type="button"
                    onClick={() => setDismissed((s) => new Set(s).add(i))}
                    className="mt-2 text-xs text-muted-foreground hover:text-primary"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

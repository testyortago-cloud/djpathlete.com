"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronUp, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import type { VoiceDriftFlag } from "@/types/database"

interface ApiResponse {
  flags: VoiceDriftFlag[]
  lastScanAt: string | null
}

const ENTITY_LABELS: Record<VoiceDriftFlag["entity_type"], string> = {
  social_post: "Social post",
  blog_post: "Blog post",
  newsletter: "Newsletter",
}

const SEVERITY_COLORS: Record<VoiceDriftFlag["severity"], string> = {
  low: "bg-muted/40 text-muted-foreground",
  medium: "bg-warning/10 text-warning",
  high: "bg-error/10 text-error",
}

function formatScanAt(iso: string | null): string {
  if (!iso) return "never"
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function preview(text: string, max = 80): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

function FlagRow({ flag }: { flag: VoiceDriftFlag }) {
  const [open, setOpen] = useState(false)

  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface/40"
      >
        <span
          className={cn(
            "inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded",
            SEVERITY_COLORS[flag.severity],
          )}
        >
          {flag.severity}
        </span>
        <span className="text-xs text-muted-foreground w-24 shrink-0">{ENTITY_LABELS[flag.entity_type]}</span>
        <span className="flex-1 text-sm text-primary truncate">{preview(flag.content_preview)}</span>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{flag.drift_score}</span>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && flag.issues.length > 0 && (
        <div className="px-4 pb-3 pl-32 space-y-2">
          {flag.issues.map((issue, i) => (
            <div key={i} className="text-xs text-primary">
              <p className="font-medium">{issue.issue}</p>
              <p className="text-muted-foreground mt-0.5">→ {issue.suggestion}</p>
            </div>
          ))}
        </div>
      )}
    </li>
  )
}

export function VoiceDriftCard() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/admin/ai/voice-drift")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as ApiResponse
        if (!cancelled) setData(body)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Voice drift — last 7 days</h2>
        </div>
        <span className="text-xs text-muted-foreground">Last scan: {formatScanAt(data?.lastScanAt ?? null)}</span>
      </div>

      {loading && <div className="p-8 text-center text-sm text-muted-foreground">Loading voice drift flags…</div>}

      {error && !loading && (
        <div className="p-8 text-center text-sm text-error">
          <AlertTriangle className="size-5 mx-auto mb-2" />
          Couldn&apos;t load voice drift flags: {error}
        </div>
      )}

      {!loading && !error && data && data.flags.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No drift flagged this week — voice holding steady.
        </div>
      )}

      {!loading && !error && data && data.flags.length > 0 && (
        <ul>
          {data.flags.map((flag) => (
            <FlagRow key={flag.id} flag={flag} />
          ))}
        </ul>
      )}
    </div>
  )
}

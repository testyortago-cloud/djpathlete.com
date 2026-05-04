"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { GoogleAdsRecommendation, GoogleAdsRecommendationType } from "@/types/database"

const TYPE_LABEL: Record<GoogleAdsRecommendationType, string> = {
  add_negative_keyword: "Add negative keyword",
  adjust_bid: "Adjust bid",
  pause_keyword: "Pause keyword",
  add_keyword: "Add keyword",
  add_ad_variant: "Add ad variant",
  pause_ad: "Pause ad",
}

const TYPE_TONE: Record<GoogleAdsRecommendationType, string> = {
  add_negative_keyword: "bg-warning/15 text-warning",
  adjust_bid: "bg-accent/15 text-accent",
  pause_keyword: "bg-error/10 text-error",
  add_keyword: "bg-success/15 text-success",
  add_ad_variant: "bg-accent/15 text-accent",
  pause_ad: "bg-error/10 text-error",
}

function payloadSummary(
  type: GoogleAdsRecommendationType,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case "add_negative_keyword":
      return `"${payload.text}" [${payload.match_type}]`
    case "adjust_bid": {
      const cur = Number(payload.current_micros ?? 0) / 1_000_000
      const next = Number(payload.proposed_micros ?? 0) / 1_000_000
      const delta = cur > 0 ? `${(((next - cur) / cur) * 100).toFixed(0)}%` : "—"
      return `$${cur.toFixed(2)} → $${next.toFixed(2)} (${delta})`
    }
    case "pause_keyword":
      return `criterion ${payload.criterion_id}`
    case "add_keyword":
      return `"${payload.text}" [${payload.match_type}]`
    case "add_ad_variant": {
      const headlines = Array.isArray(payload.headlines) ? payload.headlines : []
      return `${headlines.length} headlines · ${
        Array.isArray(payload.descriptions) ? payload.descriptions.length : 0
      } descriptions`
    }
    case "pause_ad":
      return `ad ${payload.ad_id}`
  }
}

export function RecommendationCard({ rec }: { rec: GoogleAdsRecommendation }) {
  const [pending, setPending] = useState<"approve" | "reject" | null>(null)
  const [resolved, setResolved] = useState<"approved" | "rejected" | null>(null)

  async function act(action: "approve" | "reject") {
    if (pending) return
    setPending(action)
    try {
      const res = await fetch(`/api/admin/ads/recommendations/${rec.id}/${action}`, {
        method: "POST",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(action === "approve" ? "Approved." : "Rejected.")
      setResolved(action === "approve" ? "approved" : "rejected")
    } catch (err) {
      toast.error(`${action} failed: ${(err as Error).message}`)
    } finally {
      setPending(null)
    }
  }

  if (resolved) {
    return (
      <div className="border border-border/60 bg-muted/20 rounded-xl p-5 text-sm text-muted-foreground">
        Recommendation {resolved}.
      </div>
    )
  }

  return (
    <div className="border border-border bg-card rounded-xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${TYPE_TONE[rec.recommendation_type]}`}
          >
            {TYPE_LABEL[rec.recommendation_type]}
          </span>
          <span className="text-xs font-mono text-muted-foreground truncate">
            {payloadSummary(rec.recommendation_type, rec.payload)}
          </span>
        </div>
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">
          conf {(rec.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <p className="text-sm text-primary leading-relaxed">{rec.reasoning}</p>

      <div className="flex items-center justify-between pt-2 border-t border-border/40">
        <p className="text-[11px] font-mono text-muted-foreground">
          {rec.scope_type} · {rec.scope_id} · expires{" "}
          {new Date(rec.expires_at).toLocaleDateString()}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => act("reject")}
            disabled={Boolean(pending)}
            className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-error hover:border-error/50 disabled:opacity-50 transition-colors"
          >
            {pending === "reject" ? "Rejecting..." : "Reject"}
          </button>
          <button
            type="button"
            onClick={() => act("approve")}
            disabled={Boolean(pending)}
            className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {pending === "approve" ? "Approving..." : "Approve"}
          </button>
        </div>
      </div>
    </div>
  )
}

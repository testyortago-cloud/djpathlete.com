"use client"

import { useState } from "react"
import { toast } from "sonner"
import { BlueprintModal } from "./BlueprintModal"
import { campaignBlueprintArgsSchema } from "@/lib/ads/agent/decision-schema"
import { verifyTrackingForBlueprint } from "@/lib/ads/tracking-verification"
import type { GoogleAdsRecommendation, GoogleAdsRecommendationType } from "@/types/database"

const TYPE_LABEL: Record<GoogleAdsRecommendationType, string> = {
  add_negative_keyword: "Block a bad search term",
  adjust_bid: "Change a bid",
  pause_keyword: "Pause a keyword",
  add_keyword: "Add a keyword",
  add_ad_variant: "Try a new ad headline",
  pause_ad: "Pause an ad",
  // Phase 1.6+ — agent-only types (advisory; no apply path yet).
  budget_shift: "Move money between campaigns",
  audience_expansion: "Reach more people",
  new_campaign: "Launch a new campaign",
  campaign_pause: "Pause a whole campaign",
  campaign_split: "Split a campaign",
  match_type_change: "Change how a keyword matches",
  bid_strategy_review: "Review bidding approach",
  flag: "Heads up — not a fix",
}

const TYPE_TONE: Record<GoogleAdsRecommendationType, string> = {
  add_negative_keyword: "bg-warning/15 text-warning",
  adjust_bid: "bg-accent/15 text-accent",
  pause_keyword: "bg-error/10 text-error",
  add_keyword: "bg-success/15 text-success",
  add_ad_variant: "bg-accent/15 text-accent",
  pause_ad: "bg-error/10 text-error",
  // Agent-only types — neutral tone until they have an apply path.
  budget_shift: "bg-accent/15 text-accent",
  audience_expansion: "bg-accent/15 text-accent",
  new_campaign: "bg-success/15 text-success",
  campaign_pause: "bg-error/10 text-error",
  campaign_split: "bg-accent/15 text-accent",
  match_type_change: "bg-accent/15 text-accent",
  bid_strategy_review: "bg-warning/15 text-warning",
  flag: "bg-warning/15 text-warning",
}

function payloadSummary(
  type: GoogleAdsRecommendationType,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case "add_negative_keyword":
      return `"${payload.text}" (${String(payload.match_type ?? "").toLowerCase()})`
    case "adjust_bid": {
      const cur = Number(payload.current_micros ?? 0) / 1_000_000
      const next = Number(payload.proposed_micros ?? 0) / 1_000_000
      const delta = cur > 0 ? `${(((next - cur) / cur) * 100).toFixed(0)}%` : ""
      return `$${cur.toFixed(2)} → $${next.toFixed(2)}${delta ? ` (${delta})` : ""}`
    }
    case "pause_keyword":
      return ""
    case "add_keyword":
      return `"${payload.text}" (${String(payload.match_type ?? "").toLowerCase()})`
    case "add_ad_variant": {
      const headlines = Array.isArray(payload.headlines) ? payload.headlines : []
      const descs = Array.isArray(payload.descriptions) ? payload.descriptions : []
      return `${headlines.length} headlines, ${descs.length} descriptions`
    }
    case "pause_ad":
      return ""
    case "new_campaign": {
      const args = (payload.args ?? payload) as Record<string, unknown>
      const name = args.campaign_name ? String(args.campaign_name) : ""
      const budget = Number(args.daily_budget_cents ?? 0) / 100
      return name ? `${name} · $${budget.toFixed(2)}/day` : ""
    }
    // Other agent-advisory types — no extra summary, keep the card clean.
    case "budget_shift":
    case "audience_expansion":
    case "campaign_pause":
    case "campaign_split":
    case "match_type_change":
    case "bid_strategy_review":
    case "flag":
      return ""
  }
}

function formatScope(scope_type: string, scope_id: string): string {
  // Hide the sentinel scope_ids used for account-wide actions — they aren't
  // useful to a non-technical reader.
  if (scope_type === "account") return "Whole account"
  if (scope_id.startsWith("__") && scope_id.endsWith("__")) {
    return scope_type === "campaign" ? "New campaign (not yet created)" : "Account-level"
  }
  return `${scope_type}: ${scope_id}`
}

function formatExpires(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function confidenceLabel(c: number): { text: string; tone: string } {
  if (c >= 0.8) return { text: "High confidence", tone: "text-success" }
  if (c >= 0.5) return { text: "Medium confidence", tone: "text-accent" }
  return { text: "Lower confidence", tone: "text-muted-foreground" }
}

type Action = "approve" | "reject" | "apply"
type ResolvedState = "applied" | "auto_applied" | "rejected" | "failed"

const RESOLVED_LABEL: Record<ResolvedState, { text: string; tone: string }> = {
  applied: {
    text: "Done. The change is live in your Google Ads account.",
    tone: "border-success/40 bg-success/5 text-success",
  },
  auto_applied: {
    text: "Done — the assistant applied this automatically (high confidence).",
    tone: "border-success/40 bg-success/5 text-success",
  },
  rejected: {
    text: "Skipped — no change was made.",
    tone: "border-border/60 bg-muted/20 text-muted-foreground",
  },
  failed: {
    text: "Couldn't be applied. You can try again or skip.",
    tone: "border-error/40 bg-error/5 text-error",
  },
}

/**
 * For new_campaign recs, compute the tracking-coverage status from the
 * blueprint payload so admins see at a glance whether the conversion gtag
 * will fire for this campaign's landing page before approving. Returns
 * null for any non-new_campaign rec or malformed payload (no banner shown).
 */
function computeTrackingForRec(rec: GoogleAdsRecommendation) {
  if (rec.recommendation_type !== "new_campaign") return null
  const raw =
    (rec.payload as { args?: unknown }).args ?? (rec.payload as unknown)
  const parsed = campaignBlueprintArgsSchema.safeParse(raw)
  if (!parsed.success) return null
  return verifyTrackingForBlueprint(parsed.data)
}

export function RecommendationCard({ rec }: { rec: GoogleAdsRecommendation }) {
  const [pending, setPending] = useState<Action | null>(null)
  const [resolved, setResolved] = useState<ResolvedState | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isFailed = rec.status === "failed"
  const tracking = computeTrackingForRec(rec)

  async function act(action: Action) {
    if (pending) return
    setPending(action)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/admin/ads/recommendations/${rec.id}/${action}`, {
        method: "POST",
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        result?: { status?: ResolvedState; error?: string }
        error?: string
      }
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      if (action === "reject") {
        setResolved("rejected")
        toast.success("Rejected.")
        return
      }

      // approve or apply: result.status tells us whether the apply succeeded
      const status = body.result?.status
      if (status === "applied" || status === "auto_applied") {
        setResolved(status)
        toast.success("Applied to Google Ads.")
      } else if (status === "failed") {
        setResolved("failed")
        setErrorMessage(body.result?.error ?? "Unknown failure")
        toast.error(`Apply failed: ${body.result?.error ?? "see log"}`)
      }
    } catch (err) {
      toast.error(`${action} failed: ${(err as Error).message}`)
    } finally {
      setPending(null)
    }
  }

  if (resolved) {
    const meta = RESOLVED_LABEL[resolved]
    // new_campaign success deserves an extra line — the campaign is created
    // PAUSED and needs geo targeting + a final review in Google Ads.
    const isNewCampaignApplied =
      rec.recommendation_type === "new_campaign" &&
      (resolved === "applied" || resolved === "auto_applied")
    return (
      <div className={`border ${meta.tone} rounded-xl p-5 text-sm space-y-2`}>
        <p>{meta.text}</p>
        {isNewCampaignApplied ? (
          <p className="text-xs opacity-90">
            Created as <strong>Paused</strong>. Open it in Google Ads to set location
            targeting and review ad copy, then enable.
          </p>
        ) : null}
        {errorMessage ? (
          <p className="text-[11px] font-mono mt-2 leading-snug opacity-80">{errorMessage}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={`border bg-card rounded-xl p-5 space-y-3 ${isFailed ? "border-error/40" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TYPE_TONE[rec.recommendation_type]}`}
          >
            {TYPE_LABEL[rec.recommendation_type]}
          </span>
          {payloadSummary(rec.recommendation_type, rec.payload) ? (
            <span className="text-xs text-muted-foreground truncate">
              {payloadSummary(rec.recommendation_type, rec.payload)}
            </span>
          ) : null}
        </div>
        <span className={`text-xs shrink-0 ${confidenceLabel(rec.confidence).tone}`}>
          {confidenceLabel(rec.confidence).text}
        </span>
      </div>

      <p className="text-sm text-primary leading-relaxed">{rec.reasoning}</p>

      {isFailed && rec.failure_reason ? (
        <div className="border border-error/40 bg-error/5 rounded-md p-3 text-xs text-error leading-snug">
          <span className="font-medium">Why it failed last time:</span>{" "}
          {rec.failure_reason.slice(0, 280)}
        </div>
      ) : null}

      {tracking ? (
        <div
          className={`border rounded-md p-3 text-xs leading-snug ${
            tracking.status === "tracked"
              ? "border-success/40 bg-success/5 text-success"
              : tracking.status === "partial"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-error/40 bg-error/5 text-error"
          }`}
        >
          <div className="font-medium">
            {tracking.status === "tracked"
              ? "✓ Conversion tracking ready"
              : tracking.status === "partial"
                ? "⚠ Partial tracking — review before enabling"
                : "✗ No conversion tracking on the landing page"}
          </div>
          {tracking.status !== "tracked" ? (
            <div className="mt-1 opacity-90">{tracking.notes[0]}</div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between pt-2 border-t border-border/40">
        <p className="text-xs text-muted-foreground">
          {formatScope(rec.scope_type, rec.scope_id)} · expires {formatExpires(rec.expires_at)}
        </p>
        <div className="flex items-center gap-2">
          {rec.recommendation_type === "new_campaign" ? (
            <BlueprintModal
              recId={rec.id}
              trigger={
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-md border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
                >
                  View campaign
                </button>
              }
            />
          ) : null}
          {!isFailed ? (
            <button
              type="button"
              onClick={() => act("reject")}
              disabled={Boolean(pending)}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-error hover:border-error/50 disabled:opacity-50 transition-colors"
            >
              {pending === "reject" ? "Rejecting..." : "Reject"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => act(isFailed ? "apply" : "approve")}
            disabled={Boolean(pending)}
            className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {pending === "approve" || pending === "apply"
              ? isFailed
                ? "Retrying..."
                : "Applying..."
              : isFailed
                ? "Retry apply"
                : "Approve & apply"}
          </button>
        </div>
      </div>
    </div>
  )
}

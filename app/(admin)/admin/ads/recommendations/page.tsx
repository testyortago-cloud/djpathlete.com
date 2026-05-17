import Link from "next/link"
import { Sparkles, Wrench, ArrowRight } from "lucide-react"
import {
  listRecommendations,
  getRecommendationStatusCounts,
} from "@/lib/db/google-ads-recommendations"
import { RecommendationCard } from "./RecommendationCard"
import type { GoogleAdsRecommendationType } from "@/types/database"

export const metadata = { title: "Google Ads — Recommendations" }
export const dynamic = "force-dynamic"

// Categorise recommendation types into the two surfaces a coach actually
// thinks about: a "launch a whole campaign" decision vs an "approve a small
// tweak" decision. flag rows are advisory observations and live on the AI
// Agent page where they're rationalised — we surface a count at the bottom
// of this page but don't render them inline.
const NEW_CAMPAIGN_TYPES: GoogleAdsRecommendationType[] = ["new_campaign"]
const TWEAK_TYPES: GoogleAdsRecommendationType[] = [
  "add_keyword",
  "add_negative_keyword",
  "add_ad_variant",
  "adjust_bid",
  "pause_keyword",
  "pause_ad",
  "budget_shift",
  "audience_expansion",
  "campaign_pause",
  "campaign_split",
  "match_type_change",
  "bid_strategy_review",
]

export default async function RecommendationsPage() {
  const [actionable, counts] = await Promise.all([
    listRecommendations({ status: ["pending", "failed"], limit: 100 }),
    getRecommendationStatusCounts(),
  ])

  const newCampaigns = actionable.filter((r) =>
    NEW_CAMPAIGN_TYPES.includes(r.recommendation_type),
  )
  const tweaks = actionable.filter((r) => TWEAK_TYPES.includes(r.recommendation_type))
  const flags = actionable.filter((r) => r.recommendation_type === "flag")

  const hasAnyAction = newCampaigns.length + tweaks.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading text-primary">Recommendations</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Things the AI assistant proposes you do to your Google Ads account. Click{" "}
            <span className="font-semibold text-primary">Approve</span> to apply a change,
            or <span className="font-semibold text-primary">Reject</span> to skip it.
            Unactioned items disappear after 14 days. Background observations and warnings
            from the assistant live on the{" "}
            <Link href="/admin/ads/agent" className="text-accent hover:underline">
              AI Agent
            </Link>{" "}
            page.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CountTile label="Waiting for you" value={counts.pending} tone="bg-accent/10 text-accent" />
        <CountTile label="Needs another try" value={counts.failed} tone="bg-error/10 text-error" />
        <CountTile label="Live in Google Ads" value={counts.applied + counts.auto_applied} tone="bg-success/10 text-success" />
        <CountTile label="Skipped" value={counts.rejected} tone="bg-muted/40 text-muted-foreground" />
      </div>

      {!hasAnyAction && flags.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-8 text-center bg-card">
          <p className="text-sm text-muted-foreground">
            Nothing to review right now. New suggestions show up after the nightly Google Ads
            refresh, or you can{" "}
            <Link href="/admin/ads/campaigns" className="underline hover:text-accent">
              refresh now
            </Link>
            .
          </p>
        </div>
      ) : null}

      {/* ── New campaigns ───────────────────────────────────────── */}
      {newCampaigns.length > 0 ? (
        <Section
          icon={<Sparkles className="size-4" />}
          title="New campaigns to launch"
          count={newCampaigns.length}
          blurb="Each card has a full preview (keywords, ad copy, budget) you can review before approving. Click View campaign."
        >
          <div className="space-y-3">
            {newCampaigns.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </div>
        </Section>
      ) : null}

      {/* ── Smaller tweaks ──────────────────────────────────────── */}
      {tweaks.length > 0 ? (
        <Section
          icon={<Wrench className="size-4" />}
          title="Smaller tweaks to existing campaigns"
          count={tweaks.length}
          blurb="Quick changes the AI thinks will improve your numbers. Approve to apply directly to Google Ads."
        >
          <div className="space-y-3">
            {tweaks.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </div>
        </Section>
      ) : null}

      {/* ── Footer note for flags ───────────────────────────────── */}
      {flags.length > 0 ? (
        <Link
          href="/admin/ads/agent"
          className="block border border-border rounded-xl p-4 bg-card hover:bg-surface/50 transition-colors text-sm text-muted-foreground"
        >
          <span className="flex items-center justify-between gap-3">
            <span>
              <strong className="text-primary">{flags.length}</strong> heads-up{" "}
              {flags.length === 1 ? "note" : "notes"} from the assistant — observations and
              warnings, not actions you can approve. View them with the rest of the agent&apos;s
              analysis.
            </span>
            <ArrowRight className="size-4 shrink-0" />
          </span>
        </Link>
      ) : null}
    </div>
  )
}

function Section({
  icon,
  title,
  count,
  blurb,
  children,
}: {
  icon: React.ReactNode
  title: string
  count: number
  blurb: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-heading text-primary flex items-baseline gap-2">
            {title}
            <span className="text-xs font-mono text-muted-foreground">({count})</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{blurb}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function CountTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-2xl font-heading mt-1">{value.toLocaleString()}</p>
    </div>
  )
}

import Link from "next/link"
import {
  listRecommendations,
  getRecommendationStatusCounts,
} from "@/lib/db/google-ads-recommendations"
import { RecommendationCard } from "./RecommendationCard"

export const metadata = { title: "Google Ads — Recommendations" }
export const dynamic = "force-dynamic"

export default async function RecommendationsPage() {
  const [actionable, counts] = await Promise.all([
    listRecommendations({ status: ["pending", "failed"], limit: 100 }),
    getRecommendationStatusCounts(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading text-primary">Recommendations</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Suggestions the AI assistant made about your Google Ads account. Click{" "}
            <span className="font-semibold text-primary">Approve</span> to apply a change to your
            ads, or <span className="font-semibold text-primary">Reject</span> to skip it.
            Unactioned suggestions disappear after 14 days.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CountTile label="Waiting for you" value={counts.pending} tone="bg-accent/10 text-accent" />
        <CountTile label="Needs another try" value={counts.failed} tone="bg-error/10 text-error" />
        <CountTile label="Live in Google Ads" value={counts.applied + counts.auto_applied} tone="bg-success/10 text-success" />
        <CountTile label="Skipped" value={counts.rejected} tone="bg-muted/40 text-muted-foreground" />
      </div>

      {actionable.length === 0 ? (
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
      ) : (
        <div className="space-y-3">
          {actionable.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}
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

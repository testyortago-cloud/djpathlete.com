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
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading text-primary">Recommendations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-generated optimizations sorted by confidence. Approve to queue for application
            (Plan 1.3 wires the Google Ads write-back); reject to dismiss. Rows expire 14 days
            after generation if untouched.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <CountTile label="Pending" value={counts.pending} tone="bg-accent/10 text-accent" />
        <CountTile label="Failed" value={counts.failed} tone="bg-error/10 text-error" />
        <CountTile label="Applied" value={counts.applied} tone="bg-success/10 text-success" />
        <CountTile label="Auto-applied" value={counts.auto_applied} tone="bg-success/10 text-success" />
        <CountTile label="Rejected" value={counts.rejected} tone="bg-muted/40 text-muted-foreground" />
      </div>

      {actionable.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-8 text-center bg-card">
          <p className="text-sm text-muted-foreground">
            No pending or failed recommendations.{" "}
            <Link href="/admin/ads/campaigns" className="underline hover:text-accent">
              Trigger a sync
            </Link>{" "}
            to refresh, or wait for the 06:00 UTC nightly run.
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

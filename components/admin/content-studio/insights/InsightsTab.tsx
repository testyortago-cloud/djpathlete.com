// components/admin/content-studio/insights/InsightsTab.tsx
// The Insights tab. Two bands: what your team has been making (always has
// numbers, even on day one), and how your posts are doing (empty on a fresh
// site, because nothing has published yet). The second band must say WHY it
// is empty in plain words — a bare "0 views" looks identical to a broken
// connection, and production genuinely has zero published posts today.
//
// Written for a coach, not a developer: no "sync", "pipeline", "aggregate",
// "impressions" or "metrics" in the copy below. Say what happened and what
// to do next.

import { StatTile } from "./StatTile"
import type { StudioInsights } from "@/lib/content-studio/insights"

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

function describeDelta(current: number, previous: number): string {
  const delta = current - previous
  if (delta === 0) return "Same as the 30 days before"
  if (delta > 0) return `${delta} more than the 30 days before`
  return `${Math.abs(delta)} fewer than the 30 days before`
}

export function InsightsTab({ data }: { data: StudioInsights }) {
  const { production, performance } = data
  const draftPosts = production.postsByStage.draft ?? 0
  const publishedPosts = production.postsByStage.published ?? 0
  const totalAssets = Object.values(production.assetsByKind).reduce((sum, n) => sum + n, 0)
  const submittedByTeam = production.teamSubmissionsByStatus.submitted ?? 0

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-heading text-lg text-primary">What your team has been making</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The last 30 days, compared with the 30 days before that.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile
            testId="stat-new-videos"
            label="New videos uploaded"
            value={String(production.videosUploaded)}
            hint={describeDelta(production.videosUploaded, production.videosUploadedPrevious)}
          />
          <StatTile
            testId="stat-posts-draft"
            label="Posts still in draft"
            value={String(draftPosts)}
          />
          <StatTile
            testId="stat-posts-published"
            label="Posts published"
            value={String(publishedPosts)}
          />
          <StatTile
            testId="stat-videos-edit-gate"
            label="Videos waiting on an edit"
            value={String(production.videosBlockedByEditGate)}
          />
          <StatTile
            testId="stat-assets"
            label="Images and clips saved"
            value={String(totalAssets)}
            hint={`${formatBytes(production.assetBytes)} saved`}
          />
          <StatTile
            testId="stat-team-submissions"
            label="Clips the team has submitted"
            value={String(submittedByTeam)}
          />
        </div>
      </section>

      {production.oldestInStage.length > 0 ? (
        <section>
          <h2 className="font-heading text-lg text-primary">What&apos;s been sitting the longest</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These are worth a look before they get any older.
          </p>
          <ul className="mt-4 space-y-2" data-testid="stuck-items">
            {production.oldestInStage.map((item) => (
              <li
                key={item.stage}
                data-testid={`stuck-item-${item.stage}`}
                className="rounded-lg border border-border bg-white px-4 py-2 text-sm text-foreground"
              >
                <span className="font-medium">{item.label}</span> — the oldest one has been
                waiting {item.ageDays} days.
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="font-heading text-lg text-primary">How your posts are doing</h2>
        {performance.measuredPostCount === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface/30 p-6 text-center"
            data-testid="performance-empty"
          >
            <p className="font-body text-sm text-primary">Nothing has been published yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              View and like counts appear here once your posts go live. Approve a post and
              schedule it, and the numbers arrive after the next nightly update.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="performance-tiles">
            <StatTile
              testId="stat-views"
              label="Views"
              value={performance.totals.views.toLocaleString()}
            />
            <StatTile
              testId="stat-likes"
              label="Likes"
              value={performance.totals.likes.toLocaleString()}
            />
            <StatTile
              testId="stat-comments"
              label="Comments"
              value={performance.totals.comments.toLocaleString()}
            />
            <StatTile
              testId="stat-shares"
              label="Shares"
              value={performance.totals.shares.toLocaleString()}
            />
          </div>
        )}
      </section>
    </div>
  )
}

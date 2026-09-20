// components/admin/content-studio/insights/InsightsTab.tsx
// The Insights tab. Two bands: what your team has been making (always has
// numbers, even on day one), and how your posts are doing (empty on a fresh
// site, because nothing has published yet). The second band must say WHY it
// is empty in plain words — a bare "0 views" looks identical to a broken
// connection, and production genuinely has zero published posts today.
//
// Three more states share this band, and collapsing all of them into
// `measuredPostCount === 0 -> "Nothing has been published yet"` made the tab
// contradict itself on its own screen: the production band can show
// "Posts published — 3" directly above "Nothing has been published yet" for
// up to a full sync cycle after a same-day publish, and a post on a
// disconnected platform read that way forever. This reads `performance.videos`
// (each a VideoPerformanceSummary with a `perPost` ladder) and tallies across
// every post's own PerformanceState, the same four-state ladder the video
// detail page's VideoPerformance.tsx renders per post — so the two surfaces
// can't drift out of sync about the same post's state.
//
// Written for a coach, not a developer: no "sync", "pipeline", "aggregate",
// "impressions" or "metrics" in the copy below. Say what happened and what
// to do next.

import { StatTile } from "./StatTile"
import { PLATFORM_LABELS } from "@/lib/social/platform-ui"
import type { StudioInsights, VideoPerformanceSummary } from "@/lib/content-studio/insights"

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

function describeDelta(current: number, previous: number, periodDays: number): string {
  const delta = current - previous
  if (delta === 0) return `Same as the ${periodDays} days before`
  if (delta > 0) return `${delta} more than the ${periodDays} days before`
  return `${Math.abs(delta)} fewer than the ${periodDays} days before`
}

interface PerformanceBreakdown {
  /** Every post that IS published (i.e. not the `not_published` state) — measured, awaiting a sync, or on a disconnected platform. */
  publishedCount: number
  measuredCount: number
  awaitingCount: number
  notConnectedCount: number
  /** Display labels, deduped and sorted, for platforms behind a not_connected post. */
  notConnectedPlatforms: string[]
}

function summarizePerformance(videos: VideoPerformanceSummary[]): PerformanceBreakdown {
  let measuredCount = 0
  let awaitingCount = 0
  let notConnectedCount = 0
  const platforms = new Set<string>()

  for (const video of videos) {
    for (const post of video.perPost) {
      switch (post.state.kind) {
        case "not_published":
          break
        case "measured":
          measuredCount++
          break
        case "awaiting_sync":
          awaitingCount++
          break
        case "not_connected":
          notConnectedCount++
          platforms.add(PLATFORM_LABELS[post.state.platform] ?? post.state.platform)
          break
      }
    }
  }

  return {
    publishedCount: measuredCount + awaitingCount + notConnectedCount,
    measuredCount,
    awaitingCount,
    notConnectedCount,
    notConnectedPlatforms: Array.from(platforms).sort(),
  }
}

function platformList(platforms: string[]): string {
  if (platforms.length <= 1) return platforms[0] ?? ""
  return `${platforms.slice(0, -1).join(", ")} and ${platforms[platforms.length - 1]}`
}

/**
 * One plain line about the posts NOT shown as figures — either beneath the
 * "posts have gone live" message (nothing measured yet) or beneath the
 * tiles (some measured, some not). Never mentions `not_published`: drafts
 * and unscheduled posts already have their own tile in the band above.
 */
function pendingLine(breakdown: PerformanceBreakdown): string | null {
  const clauses: string[] = []

  if (breakdown.awaitingCount > 0) {
    clauses.push(
      breakdown.awaitingCount === 1
        ? "1 post is still waiting on the next nightly update for its numbers."
        : `${breakdown.awaitingCount} posts are still waiting on the next nightly update for their numbers.`,
    )
  }

  if (breakdown.notConnectedCount > 0) {
    const platforms = platformList(breakdown.notConnectedPlatforms)
    const isAre = breakdown.notConnectedPlatforms.length <= 1 ? "isn't" : "aren't"
    clauses.push(
      breakdown.notConnectedCount === 1
        ? `1 post is on ${platforms}, which ${isAre} connected, so we can't read its numbers.`
        : `${breakdown.notConnectedCount} posts are on ${platforms}, which ${isAre} connected, so we can't read their numbers.`,
    )
  }

  return clauses.length > 0 ? clauses.join(" ") : null
}

export function InsightsTab({ data }: { data: StudioInsights }) {
  const { production, performance, periodDays } = data
  const draftPosts = production.postsByStage.draft ?? 0
  const publishedPosts = production.postsByStage.published ?? 0
  const totalAssets = Object.values(production.assetsByKind).reduce((sum, n) => sum + n, 0)
  const submittedByTeam = production.teamSubmissionsByStatus.submitted ?? 0
  const breakdown = summarizePerformance(performance.videos)

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-heading text-lg text-primary">What your team has been making</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The last {periodDays} days, compared with the {periodDays} days before that.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile
            testId="stat-new-videos"
            label="New videos uploaded"
            value={String(production.videosUploaded)}
            hint={describeDelta(production.videosUploaded, production.videosUploadedPrevious, periodDays)}
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
        {breakdown.publishedCount === 0 ? (
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
        ) : breakdown.measuredCount === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface/30 p-6 text-center"
            data-testid="performance-pending"
          >
            <p className="font-body text-sm text-primary">
              {breakdown.publishedCount === 1
                ? "1 post has gone live."
                : `${breakdown.publishedCount} posts have gone live.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{pendingLine(breakdown)}</p>
          </div>
        ) : (
          <div className="mt-4" data-testid="performance-tiles">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
            {pendingLine(breakdown) ? (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="performance-partial-note">
                {pendingLine(breakdown)}
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}

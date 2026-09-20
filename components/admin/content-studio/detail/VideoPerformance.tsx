// components/admin/content-studio/detail/VideoPerformance.tsx
// Per-video performance panel for the video detail page. Renders the
// video-level roll-up AND, beneath it, one line per post with that post's
// OWN state — never the roll-up alone.
//
// summarizeVideoPerformance sums every measured post into the roll-up, so a
// video with one measured post and one post on a disconnected platform still
// reports "measured" at the video level; the disconnected post's absence is
// invisible in `state` alone (see the comment atop summarizeVideoPerformance
// in lib/content-studio/insights.ts). Rendering only the roll-up would make a
// half-broken video look completely fine, which is the exact failure this
// panel exists to prevent — so `perPost` is always rendered too, whatever the
// roll-up says.
//
// Copy is written for the coach, not a developer: no "sync", "metrics", or
// platform ids on screen (PLATFORM_LABELS capitalises `youtube_shorts` etc.).

import { StatTile } from "@/components/admin/content-studio/insights/StatTile"
import { PLATFORM_LABELS } from "@/lib/social/platform-ui"
import type { PerformanceState, VideoPerformanceSummary } from "@/lib/content-studio/insights"

interface VideoPerformanceProps {
  performance: VideoPerformanceSummary | null
}

type StateDescriptor =
  | { kind: "message"; text: string }
  | { kind: "figures"; views: number; likes: number; comments: number; shares: number }

/** The one place a PerformanceState becomes copy. Both the roll-up and each
 *  perPost line call this, so they can never drift out of sync with each
 *  other or with the four-state ladder in lib/content-studio/insights.ts. */
function describeState(state: PerformanceState): StateDescriptor {
  switch (state.kind) {
    case "not_published":
      return {
        kind: "message",
        text: "This video isn't published yet. Once its posts go live, you'll see how they did here.",
      }
    case "awaiting_sync":
      return {
        kind: "message",
        text: `Published ${new Date(state.publishedAt).toLocaleDateString()}. The first numbers arrive overnight.`,
      }
    case "not_connected":
      return {
        kind: "message",
        text: `${PLATFORM_LABELS[state.platform]} isn't connected, so we can't read its numbers.`,
      }
    case "measured":
      return {
        kind: "figures",
        views: state.views,
        likes: state.likes,
        comments: state.comments,
        shares: state.shares,
      }
    default: {
      // exhaustiveness guard — a new PerformanceState variant becomes a compile error here
      const _never: never = state
      return _never
    }
  }
}

function RollupFigures({
  views,
  likes,
  comments,
  shares,
}: Omit<Extract<StateDescriptor, { kind: "figures" }>, "kind">) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile testId="perf-stat-views" label="Views" value={views.toLocaleString()} />
      <StatTile testId="perf-stat-likes" label="Likes" value={likes.toLocaleString()} />
      <StatTile testId="perf-stat-comments" label="Comments" value={comments.toLocaleString()} />
      <StatTile testId="perf-stat-shares" label="Shares" value={shares.toLocaleString()} />
    </div>
  )
}

function PerPostFigures({
  views,
  likes,
  comments,
  shares,
}: Omit<Extract<StateDescriptor, { kind: "figures" }>, "kind">) {
  return (
    <span className="text-muted-foreground">
      {views.toLocaleString()} views · {likes.toLocaleString()} likes · {comments.toLocaleString()} comments ·{" "}
      {shares.toLocaleString()} shares
    </span>
  )
}

export function VideoPerformance({ performance }: VideoPerformanceProps) {
  if (!performance) return null

  const rollup = describeState(performance.state)

  return (
    <div className="space-y-4">
      <div data-testid="performance-rollup">
        {rollup.kind === "message" ? (
          <p className="text-sm text-muted-foreground">{rollup.text}</p>
        ) : (
          <RollupFigures {...rollup} />
        )}
      </div>

      {performance.perPost.length > 0 && (
        <ul className="space-y-1.5" data-testid="performance-per-post">
          {performance.perPost.map((post) => {
            const d = describeState(post.state)
            return (
              <li
                key={post.postId}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-border bg-white px-3 py-2 text-xs"
              >
                <span className="font-medium text-primary">{PLATFORM_LABELS[post.platform]}</span>
                {d.kind === "message" ? (
                  <span className="text-muted-foreground">{d.text}</span>
                ) : (
                  <PerPostFigures {...d} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

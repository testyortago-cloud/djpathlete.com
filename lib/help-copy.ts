// lib/help-copy.ts
// Central dictionary of short, plain-English help strings for admin surfaces.
// Pair with <HelpTooltip label="..." /> anywhere a coach might wonder
// "what does this mean?" Keep entries under ~280 chars so the tooltip stays
// readable at narrow widths.

export const HELP_COPY = {
  // ─── Content Studio pipeline columns ──
  needsReview: "AI just generated these. Nothing publishes until you approve. Edit first if the voice is off.",
  approvedColumn:
    "You approved these. Connected platforms will publish on schedule; disconnected platforms wait for the platform to be connected.",
  scheduledColumn:
    "Posts queued for a specific future time. A background cron runs every 5 minutes and publishes anything due.",
  publishedColumn: "Published successfully. Engagement metrics populate overnight.",
  failedColumn: "Publishing hit an error. Open the post to see the failure reason. Re-approve to retry.",

  // ─── Analytics — Social tab KPIs ──
  postsCreated:
    "Total social posts created in the selected range, across all statuses. Counts the moment the AI generates them.",
  postsPublished: "Posts that actually made it out the door — status = published, platform_post_id set.",
  impressions:
    "Total times posts appeared in feeds, summed across each post's most-recent analytics snapshot. Higher is broader reach; not the same as engagement.",
  engagement:
    "Platform-defined engagement — likes, comments, shares, depending on the platform. Summed across the latest snapshot per post.",

  // ─── Analytics — Content tab KPIs ──
  blogsCreated: "Blog drafts created in the range — includes AI-generated and hand-written.",
  blogsPublished: "Blog posts flipped to the published status in the range.",
  newslettersSent: "Newsletters with a sent_at timestamp in the range.",
  activeSubscribers: "Current subscriber count (never unsubscribed). Snapshot, not a range — updates live.",

  // ─── AI Insights — Voice drift ──
  voiceDriftSeverity:
    "Severity signals how far the generation drifted from the voice profile. Low (<40) is filtered out before it lands here. Medium is worth a look; High needs attention.",
  voiceDriftScore: "0 = perfectly on-brand, 100 = completely off-brand. Claude's editorial judgment, not a hard math.",

  // ─── Automation page ──
  automationPaused:
    "Global kill switch. When paused, every scheduled cron (analytics, emails, voice drift, learning loop) skips its run. Flip back to resume.",
  runNow:
    "Fires the same code the cron would fire, right now. Useful after a tweak or between scheduled windows. Runs still honor the pause switch.",

  // ─── Platform connections ──
  platformConnected: "OAuth tokens are valid and the plugin can publish.",
  platformPaused:
    "Credentials are still on file but publishing is paused for this platform specifically. Anything queued stays queued.",
  platformNotConnected:
    "No OAuth tokens yet. AI can still generate captions for this platform — they'll queue as Awaiting connection until you link the account.",
  platformError:
    "Last publish attempt raised an error (usually token expired or permissions revoked). Reconnect to clear.",
} as const

export type HelpCopyKey = keyof typeof HELP_COPY

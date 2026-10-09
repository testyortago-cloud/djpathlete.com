// lib/social/plugins/types.ts
import type { SocialPlatform, PlatformConnection, PostType } from "@/types/database"

/** A link card (LinkedIn "article" content). LinkedIn's API never scrapes a URL itself. */
export interface PublishLink {
  url: string
  title: string
  description: string | null
  /** https image for the card; uploaded as the thumbnail. Null → card without image. */
  imageUrl: string | null
}

/**
 * A publish that is waiting on the platform (e.g. Instagram processing a video
 * container). Returned by a plugin as `PublishResult.pending`, saved by the
 * publish runner, and handed back as `PublishInput.resumeState` on a later tick.
 */
export interface PendingPublish {
  /** ISO time the wait began. The runner gives up 30 minutes after it. */
  startedAt: string
  /** Opaque to the runner: only the plugin that wrote it reads it. */
  data: Record<string, unknown>
}

export interface PublishInput {
  content: string
  mediaUrl: string | null
  link?: PublishLink
  /**
   * Ordered signed URLs for carousel slides. Populated by the publish runner
   * when post_type === "carousel". Non-carousel posts omit this field.
   * Plugins that don't support carousels can ignore it — the existing
   * mediaUrl field still holds slide 0's URL as a backcompat mirror.
   */
  mediaUrls?: string[]
  /**
   * Parallel to mediaUrls: what each slide is. Filled by the publish runner from
   * the media_assets rows, so plugins never guess from a file name.
   */
  mediaKinds?: Array<"image" | "video">
  /**
   * The post's content type. Plugins use this to differentiate between e.g.
   * a single-image feed post and a Story, which are published via different
   * endpoints on IG and FB. Non-Story plugins can ignore this field.
   */
  postType?: PostType
  /** Signed JPEG URL of the cover the operator chose for the source video. Instagram Reels only today. */
  coverUrl?: string | null
  scheduledAt: string | null
  metadata?: Record<string, unknown>
  /** Saved state from an earlier `pending` answer for this post. */
  resumeState?: PendingPublish
}

export interface PublishResult {
  success: boolean
  platform_post_id?: string
  error?: string
  /** success=true + pending: the platform is still processing; publish later. */
  pending?: PendingPublish
}

export interface AnalyticsResult {
  impressions?: number
  engagement?: number
  likes?: number
  comments?: number
  shares?: number
  views?: number
  [key: string]: number | undefined
}

export interface ConnectResult {
  status: PlatformConnection["status"]
  account_handle?: string
  error?: string
}

/**
 * Result of a native-platform schedule attempt. `supported: false` means the
 * plugin (or this specific post type) doesn't support delegating scheduling
 * to the platform — the caller should fall back to the DB-cron path.
 */
export type ScheduleOnPlatformResult =
  | { supported: false; reason: string }
  | { supported: true; success: true; platform_post_id: string }
  | { supported: true; success: false; error: string }

export interface PublishPlugin {
  name: SocialPlatform
  displayName: string
  connect(credentials: Record<string, unknown>): Promise<ConnectResult>
  publish(input: PublishInput): Promise<PublishResult>
  fetchAnalytics(platformPostId: string): Promise<AnalyticsResult>
  disconnect(): Promise<void>
  getSetupInstructions(): Promise<string>
  /**
   * Optional: schedule the post natively on the platform with the platform's
   * own scheduler (e.g. Facebook `scheduled_publish_time`). Plugins that
   * implement this skip our DB-cron entirely — the post sits on the
   * platform's queue and the platform publishes it itself.
   *
   * `scheduledAt` is required (must be a future ISO datetime).
   */
  scheduleOnPlatform?(
    input: PublishInput & { scheduledAt: string },
  ): Promise<ScheduleOnPlatformResult>
  /**
   * Optional: cancel a previously-scheduled post on the platform (counterpart
   * to scheduleOnPlatform). Only called when a row has platform_post_id set
   * and the user clicks Unschedule.
   */
  unscheduleOnPlatform?(platformPostId: string): Promise<{ success: boolean; error?: string }>
}

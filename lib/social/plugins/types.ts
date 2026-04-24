// lib/social/plugins/types.ts
import type { SocialPlatform, PlatformConnection, PostType } from "@/types/database"

export interface PublishInput {
  content: string
  mediaUrl: string | null
  /**
   * Ordered signed URLs for carousel slides. Populated by the publish runner
   * when post_type === "carousel". Non-carousel posts omit this field.
   * Plugins that don't support carousels can ignore it — the existing
   * mediaUrl field still holds slide 0's URL as a backcompat mirror.
   */
  mediaUrls?: string[]
  /**
   * The post's content type. Plugins use this to differentiate between e.g.
   * a single-image feed post and a Story, which are published via different
   * endpoints on IG and FB. Non-Story plugins can ignore this field.
   */
  postType?: PostType
  scheduledAt: string | null
  metadata?: Record<string, unknown>
}

export interface PublishResult {
  success: boolean
  platform_post_id?: string
  error?: string
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

export interface PublishPlugin {
  name: SocialPlatform
  displayName: string
  connect(credentials: Record<string, unknown>): Promise<ConnectResult>
  publish(input: PublishInput): Promise<PublishResult>
  fetchAnalytics(platformPostId: string): Promise<AnalyticsResult>
  disconnect(): Promise<void>
  getSetupInstructions(): Promise<string>
}

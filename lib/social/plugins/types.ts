// lib/social/plugins/types.ts
import type { SocialPlatform, PlatformConnection } from "@/types/database"

export interface PublishInput {
  content: string
  mediaUrl: string | null
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

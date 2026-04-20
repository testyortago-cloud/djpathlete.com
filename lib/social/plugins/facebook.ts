// lib/social/plugins/facebook.ts
// Facebook Page publishing via Meta Graph API.
// Docs: https://developers.facebook.com/docs/graph-api/reference/v22.0/page/feed

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"
import { fetchJson, buildQueryString } from "./shared/fetch-helpers"

const GRAPH_API_VERSION = "v22.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface FacebookCredentials {
  access_token: string
  page_id: string
}

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv)(\?|$)/i

function isImageUrl(url: string): boolean {
  return IMAGE_EXTENSIONS.test(url)
}

function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url)
}

export function createFacebookPlugin(credentials: FacebookCredentials): PublishPlugin {
  const { access_token, page_id } = credentials

  return {
    name: "facebook",
    displayName: "Facebook",

    async connect(creds): Promise<ConnectResult> {
      const token = typeof creds?.access_token === "string" ? creds.access_token : access_token
      const result = await fetchJson<{ id?: string; name?: string; error?: { message: string } }>(
        `${GRAPH_API_BASE}/${page_id}?${new URLSearchParams({ access_token: token, fields: "id,name" }).toString()}`,
      )
      if (!result.ok) {
        return { status: "error", error: result.errorText ?? "Facebook connection check failed" }
      }
      return { status: "connected", account_handle: result.data?.name }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl, scheduledAt } = input

      let endpoint: string
      let body: Record<string, unknown>

      if (mediaUrl && isImageUrl(mediaUrl)) {
        endpoint = `${GRAPH_API_BASE}/${page_id}/photos`
        body = { url: mediaUrl, caption: content, access_token }
      } else if (mediaUrl && isVideoUrl(mediaUrl)) {
        endpoint = `${GRAPH_API_BASE}/${page_id}/videos`
        body = { file_url: mediaUrl, description: content, access_token }
      } else {
        endpoint = `${GRAPH_API_BASE}/${page_id}/feed`
        body = { message: content, access_token }
      }

      if (scheduledAt) {
        body.published = false
        body.scheduled_publish_time = Math.floor(new Date(scheduledAt).getTime() / 1000)
      }

      const response = await fetchJson<{ id?: string; error?: { message: string } }>(endpoint, {
        method: "POST",
        body,
      })

      if (!response.ok || !response.data?.id) {
        const message = response.errorText ? extractFbError(response.errorText) : "Facebook publish failed"
        return { success: false, error: message }
      }

      return { success: true, platform_post_id: response.data.id }
    },

    async fetchAnalytics(platformPostId: string): Promise<AnalyticsResult> {
      const qs = buildQueryString({
        access_token,
        metric: "post_impressions,post_engagements",
      })
      const response = await fetchJson<{
        data?: Array<{ name: string; values: Array<{ value: number }> }>
      }>(`${GRAPH_API_BASE}/${platformPostId}/insights${qs}`)

      const analytics: AnalyticsResult = {}
      if (response.ok && response.data?.data) {
        for (const row of response.data.data) {
          const value = row.values?.[0]?.value ?? 0
          if (row.name === "post_impressions") analytics.impressions = value
          if (row.name === "post_engagements") analytics.engagement = value
        }
      }
      return analytics
    },

    async disconnect() {
      // Token revocation is optional; server-side we simply forget credentials.
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your Facebook Page",
        "",
        "1. Go to https://developers.facebook.com and create a Page access token for the Page you want to automate.",
        "2. The token needs these permissions: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`.",
        "3. Paste the long-lived Page access token and the Page ID into the Connect dialog.",
        "4. After connecting, a test ping is made to `/me` to verify the token works.",
        "",
        "Don't have a Facebook Page yet? Create one at https://www.facebook.com/pages/create — takes about 15 minutes.",
      ].join("\n")
    },
  }
}

function extractFbError(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } }
    return parsed.error?.message ?? raw
  } catch {
    return raw
  }
}

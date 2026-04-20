// lib/social/plugins/instagram.ts
// Instagram Business/Creator publishing via IG Graph API (two-step: create container, publish).
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"
import { fetchJson, buildQueryString } from "./shared/fetch-helpers"

const GRAPH_API_VERSION = "v22.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface InstagramCredentials {
  access_token: string
  ig_user_id: string
}

const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv)(\?|$)/i

function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url)
}

export function createInstagramPlugin(credentials: InstagramCredentials): PublishPlugin {
  const { access_token, ig_user_id } = credentials

  return {
    name: "instagram",
    displayName: "Instagram",

    async connect(creds): Promise<ConnectResult> {
      const token = (creds as InstagramCredentials).access_token ?? access_token
      const result = await fetchJson<{ id?: string; username?: string }>(
        `${GRAPH_API_BASE}/${ig_user_id}?${new URLSearchParams({ access_token: token, fields: "id,username" }).toString()}`,
      )
      if (!result.ok) {
        return { status: "error", error: result.errorText ?? "Instagram connection check failed" }
      }
      return { status: "connected", account_handle: result.data?.username ? `@${result.data.username}` : undefined }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl } = input

      if (!mediaUrl) {
        return {
          success: false,
          error: "Instagram requires a media URL (photo or video). Text-only posts are not supported by the API.",
        }
      }

      const containerBody: Record<string, unknown> = {
        caption: content,
        access_token,
      }
      if (isVideoUrl(mediaUrl)) {
        containerBody.video_url = mediaUrl
        containerBody.media_type = "REELS"
      } else {
        containerBody.image_url = mediaUrl
      }

      const container = await fetchJson<{ id?: string; error?: { message: string } }>(
        `${GRAPH_API_BASE}/${ig_user_id}/media`,
        { method: "POST", body: containerBody },
      )
      if (!container.ok || !container.data?.id) {
        return { success: false, error: extractIgError(container.errorText) }
      }

      const publishRes = await fetchJson<{ id?: string }>(
        `${GRAPH_API_BASE}/${ig_user_id}/media_publish`,
        { method: "POST", body: { creation_id: container.data.id, access_token } },
      )
      if (!publishRes.ok || !publishRes.data?.id) {
        return { success: false, error: extractIgError(publishRes.errorText) }
      }
      return { success: true, platform_post_id: publishRes.data.id }
    },

    async fetchAnalytics(platformPostId: string): Promise<AnalyticsResult> {
      const qs = buildQueryString({
        access_token,
        metric: "impressions,engagement,reach,saved",
      })
      const response = await fetchJson<{
        data?: Array<{ name: string; values: Array<{ value: number }> }>
      }>(`${GRAPH_API_BASE}/${platformPostId}/insights${qs}`)

      const analytics: AnalyticsResult = {}
      if (response.ok && response.data?.data) {
        for (const row of response.data.data) {
          const value = row.values?.[0]?.value ?? 0
          if (row.name === "impressions") analytics.impressions = value
          if (row.name === "engagement") analytics.engagement = value
        }
      }
      return analytics
    },

    async disconnect() {
      // no-op — credentials cleared at DAL layer
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your Instagram Business or Creator account",
        "",
        "Instagram posting requires a Business or Creator account linked to a Facebook Page.",
        "",
        "1. Convert your Instagram to a Business or Creator account (Settings → Account → Switch account type).",
        "2. Link it to the Facebook Page you connected above.",
        "3. Get the Instagram User ID — run `GET /me/accounts?fields=instagram_business_account` with your Page token.",
        "4. Paste the IG user id + the Page access token into the Connect dialog.",
        "",
        "Note: only Business/Creator accounts can post via the API. Personal accounts are not supported.",
      ].join("\n")
    },
  }
}

function extractIgError(raw: string | null): string {
  if (!raw) return "Instagram publish failed"
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } }
    return parsed.error?.message ?? raw
  } catch {
    return raw
  }
}

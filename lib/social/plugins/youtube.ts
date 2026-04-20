// lib/social/plugins/youtube.ts
// YouTube Data API v3 video upload.
// Docs: https://developers.google.com/youtube/v3/docs/videos/insert

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"
import { fetchJson } from "./shared/fetch-helpers"

const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const ANALYTICS_URL = "https://www.googleapis.com/youtube/v3/videos"

export interface YouTubeCredentials {
  access_token: string
  refresh_token: string
  client_id: string
  client_secret: string
}

export function createYouTubePlugin(credentials: YouTubeCredentials): PublishPlugin {
  let { access_token } = credentials
  const { refresh_token, client_id, client_secret } = credentials

  async function refreshAccessToken(): Promise<string | null> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id,
        client_secret,
        refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    })
    if (!response.ok) return null
    const text = await response.text()
    const data = JSON.parse(text) as { access_token?: string }
    if (!data.access_token) return null
    access_token = data.access_token
    return data.access_token
  }

  async function uploadVideo(
    videoBytes: ArrayBuffer,
    title: string,
    description: string,
    tags: string[],
  ): Promise<{ id: string } | { error: string }> {
    const metadata = JSON.stringify({
      snippet: { title, description, tags },
      status: { privacyStatus: "public" },
    })

    const boundary = "djp_yt_" + Math.random().toString(36).slice(2)
    const encoder = new TextEncoder()
    const metadataPart = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    )
    const closingPart = encoder.encode(`\r\n--${boundary}--`)
    const combined = new Uint8Array(metadataPart.byteLength + videoBytes.byteLength + closingPart.byteLength)
    combined.set(metadataPart, 0)
    combined.set(new Uint8Array(videoBytes), metadataPart.byteLength)
    combined.set(closingPart, metadataPart.byteLength + videoBytes.byteLength)

    async function attemptUpload(bearer: string) {
      return fetch(UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: combined,
      })
    }

    let response = await attemptUpload(access_token)
    if (response.status === 401) {
      const newToken = await refreshAccessToken()
      if (!newToken) return { error: "Token refresh failed" }
      response = await attemptUpload(newToken)
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      return { error: text || `YouTube upload failed with status ${response.status}` }
    }
    const rawText = await response.text()
    const data = JSON.parse(rawText) as { id?: string }
    if (!data.id) return { error: "YouTube response missing video id" }
    return { id: data.id }
  }

  return {
    name: "youtube",
    displayName: "YouTube",

    async connect(): Promise<ConnectResult> {
      const refreshed = await refreshAccessToken()
      if (!refreshed) return { status: "error", error: "Could not refresh YouTube token" }
      return { status: "connected" }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      if (!input.mediaUrl) {
        return { success: false, error: "YouTube requires a video URL" }
      }

      const separatorMatch = input.content.match(/\r?\n\r?\n/)
      const separatorIndex = separatorMatch ? input.content.indexOf(separatorMatch[0]) : -1
      const title = (
        separatorIndex >= 0 ? input.content.slice(0, separatorIndex) : input.content
      )
        .trim()
        .slice(0, 100)
      const description = (
        separatorIndex >= 0
          ? input.content.slice(separatorIndex + (separatorMatch?.[0].length ?? 0))
          : ""
      ).trim()
      const tags = (input.metadata?.tags as string[] | undefined) ?? []

      const fileResponse = await fetch(input.mediaUrl)
      if (!fileResponse.ok) {
        return { success: false, error: `Could not download media from ${input.mediaUrl}` }
      }
      const videoBytes = await fileResponse.arrayBuffer()

      const result = await uploadVideo(videoBytes, title, description, tags)
      if ("error" in result) return { success: false, error: result.error }
      return { success: true, platform_post_id: result.id }
    },

    async fetchAnalytics(videoId: string): Promise<AnalyticsResult> {
      const url = `${ANALYTICS_URL}?${new URLSearchParams({ id: videoId, part: "statistics" }).toString()}`
      const response = await fetchJson<{
        items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>
      }>(url, { headers: { Authorization: `Bearer ${access_token}` } })

      const stats = response.data?.items?.[0]?.statistics
      if (!stats) return {}
      return {
        views: Number(stats.viewCount ?? 0),
        likes: Number(stats.likeCount ?? 0),
        comments: Number(stats.commentCount ?? 0),
      }
    },

    async disconnect() {
      // no-op
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your YouTube channel",
        "",
        "1. Create a YouTube channel at https://youtube.com (free, takes 10 minutes).",
        "2. Go to Google Cloud Console → enable YouTube Data API v3.",
        "3. Create an OAuth 2.0 client (type: Web application). Add the callback URL from the Platform Connections page.",
        "4. Complete the OAuth flow — DJP Athlete captures the refresh_token and client credentials.",
        "",
        "Phase 1 note: a full OAuth connect button ships in Phase 2b. For now, manual token entry is supported.",
      ].join("\n")
    },
  }
}

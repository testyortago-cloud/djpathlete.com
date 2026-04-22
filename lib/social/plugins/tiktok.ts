// lib/social/plugins/tiktok.ts
// TikTok Content Posting API — Direct Post flow.
// Docs: https://developers.tiktok.com/doc/content-posting-api-get-started
//
// Videos are pulled by TikTok from the provided mediaUrl (PULL_FROM_URL),
// so no chunked upload is needed — the URL must be publicly reachable.
//
// Privacy: without App Review, posts are forced to SELF_ONLY. After review,
// set TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE in env to go live.

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
const PUBLISH_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/"
const PUBLISH_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"
const USER_INFO_URL =
  "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,username"
const VIDEO_QUERY_URL =
  "https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count"

export interface TikTokCredentials {
  access_token: string
  refresh_token: string
  client_key: string
  client_secret: string
  open_id?: string
}

type PrivacyLevel =
  | "SELF_ONLY"
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"

function defaultPrivacy(): PrivacyLevel {
  const env = process.env.TIKTOK_PRIVACY_LEVEL as PrivacyLevel | undefined
  if (
    env === "PUBLIC_TO_EVERYONE" ||
    env === "MUTUAL_FOLLOW_FRIENDS" ||
    env === "FOLLOWER_OF_CREATOR"
  ) {
    return env
  }
  return "SELF_ONLY"
}

export function createTikTokPlugin(credentials: TikTokCredentials): PublishPlugin {
  let { access_token, refresh_token } = credentials
  const { client_key, client_secret } = credentials

  async function refreshAccessToken(): Promise<string | null> {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key,
        client_secret,
        grant_type: "refresh_token",
        refresh_token,
      }).toString(),
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { access_token?: string; refresh_token?: string }
    if (!data.access_token) return null
    access_token = data.access_token
    if (data.refresh_token) refresh_token = data.refresh_token
    return access_token
  }

  async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers)
    headers.set("Authorization", `Bearer ${access_token}`)
    let resp = await fetch(url, { ...init, headers })
    if (resp.status === 401) {
      const fresh = await refreshAccessToken()
      if (!fresh) return resp
      headers.set("Authorization", `Bearer ${fresh}`)
      resp = await fetch(url, { ...init, headers })
    }
    return resp
  }

  return {
    name: "tiktok",
    displayName: "TikTok",

    async connect(): Promise<ConnectResult> {
      const fresh = await refreshAccessToken()
      if (!fresh) return { status: "error", error: "Could not refresh TikTok token" }
      try {
        const resp = await authedFetch(USER_INFO_URL)
        if (!resp.ok) return { status: "error", error: `TikTok user info failed (${resp.status})` }
        const body = (await resp.json()) as {
          data?: { user?: { username?: string; display_name?: string } }
        }
        const user = body.data?.user
        const handle = user?.username
          ? `@${user.username}`
          : (user?.display_name ?? undefined)
        return { status: "connected", account_handle: handle }
      } catch (err) {
        return { status: "error", error: (err as Error).message }
      }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      if (!input.mediaUrl) {
        return { success: false, error: "TikTok requires a video URL" }
      }

      const initBody = {
        post_info: {
          title: input.content.slice(0, 2200),
          privacy_level: defaultPrivacy(),
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: input.mediaUrl,
        },
      }

      const initResp = await authedFetch(PUBLISH_INIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(initBody),
      })
      if (!initResp.ok) {
        const text = await initResp.text().catch(() => "")
        return {
          success: false,
          error: `TikTok publish init failed (${initResp.status}): ${text.slice(0, 300)}`,
        }
      }

      const initData = (await initResp.json()) as {
        data?: { publish_id?: string }
        error?: { code?: string; message?: string }
      }
      if (initData.error?.code && initData.error.code !== "ok") {
        return { success: false, error: `TikTok: ${initData.error.message ?? initData.error.code}` }
      }
      const publishId = initData.data?.publish_id
      if (!publishId) {
        return { success: false, error: "TikTok init returned no publish_id" }
      }

      // TikTok ingests the video asynchronously. We return the publish_id;
      // the analytics path resolves it to the real post id later via
      // /v2/post/publish/status/fetch/.
      return { success: true, platform_post_id: publishId }
    },

    async fetchAnalytics(platformPostId: string): Promise<AnalyticsResult> {
      let videoId = platformPostId

      // Heuristic: TikTok publish_ids are short opaque strings; real post
      // ids are long numeric. If it looks like a publish_id, resolve it.
      if (!/^\d{15,}$/.test(platformPostId)) {
        try {
          const statusResp = await authedFetch(PUBLISH_STATUS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({ publish_id: platformPostId }),
          })
          if (statusResp.ok) {
            const statusData = (await statusResp.json()) as {
              data?: { publicaly_available_post_id?: string[] }
            }
            const resolved = statusData.data?.publicaly_available_post_id?.[0]
            if (resolved) videoId = resolved
          }
        } catch {
          /* ignore, try with original id */
        }
      }

      try {
        const resp = await authedFetch(VIDEO_QUERY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify({ filters: { video_ids: [videoId] } }),
        })
        if (!resp.ok) return {}
        const data = (await resp.json()) as {
          data?: {
            videos?: Array<{
              view_count?: number
              like_count?: number
              comment_count?: number
              share_count?: number
            }>
          }
        }
        const v = data.data?.videos?.[0]
        if (!v) return {}
        return {
          views: v.view_count ?? 0,
          likes: v.like_count ?? 0,
          comments: v.comment_count ?? 0,
          shares: v.share_count ?? 0,
        }
      } catch {
        return {}
      }
    },

    async disconnect() {
      // No-op at the plugin level; the disconnect API route revokes the
      // token with TikTok and clears the row.
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your TikTok account",
        "",
        "1. Create an app at https://developers.tiktok.com — enable Login Kit and Content Posting API.",
        "2. Add the redirect URI for this app's /api/admin/platform-connections/tiktok/callback.",
        "3. Copy Client Key + Client Secret into Vercel env (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET).",
        "4. Click Connect and grant `video.publish` + `user.info.basic`.",
        "5. While the app is unaudited, posts are SELF_ONLY. After App Review, set TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE.",
      ].join("\n")
    },
  }
}

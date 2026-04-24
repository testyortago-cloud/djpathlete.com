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

const CAROUSEL_POLL_MAX_ATTEMPTS = 5
const CAROUSEL_POLL_INITIAL_DELAY_MS = 500

function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url)
}

export function createInstagramPlugin(credentials: InstagramCredentials): PublishPlugin {
  const { access_token, ig_user_id } = credentials

  return {
    name: "instagram",
    displayName: "Instagram",

    async connect(creds): Promise<ConnectResult> {
      const token = typeof creds?.access_token === "string" ? creds.access_token : access_token
      const result = await fetchJson<{ id?: string; username?: string }>(
        `${GRAPH_API_BASE}/${ig_user_id}?${new URLSearchParams({ access_token: token, fields: "id,username" }).toString()}`,
      )
      if (!result.ok) {
        return { status: "error", error: result.errorText ?? "Instagram connection check failed" }
      }
      return { status: "connected", account_handle: result.data?.username ? `@${result.data.username}` : undefined }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl, mediaUrls } = input

      // Carousel branch — 2+ slides
      if (mediaUrls && mediaUrls.length >= 2) {
        return publishCarousel({
          accessToken: access_token,
          igUserId: ig_user_id,
          caption: content,
          slideUrls: mediaUrls,
        })
      }

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

interface CarouselArgs {
  accessToken: string
  igUserId: string
  caption: string
  slideUrls: string[]
}

async function publishCarousel(args: CarouselArgs): Promise<PublishResult> {
  const { accessToken, igUserId, caption, slideUrls } = args

  // Step 1: create a child container for each slide
  const childIds: string[] = []
  for (const url of slideUrls) {
    const child = await fetchJson<{ id?: string; error?: { message: string } }>(
      `${GRAPH_API_BASE}/${igUserId}/media`,
      {
        method: "POST",
        body: {
          image_url: url,
          is_carousel_item: true,
          access_token: accessToken,
        },
      },
    )
    if (!child.ok || !child.data?.id) {
      return { success: false, error: extractIgError(child.errorText) }
    }
    childIds.push(child.data.id)
  }

  // Step 2: poll each child until FINISHED
  for (const childId of childIds) {
    const ready = await waitForContainerFinished({ accessToken, containerId: childId })
    if (!ready.ok) return { success: false, error: ready.error }
  }

  // Step 3: create the parent CAROUSEL container
  const parent = await fetchJson<{ id?: string; error?: { message: string } }>(
    `${GRAPH_API_BASE}/${igUserId}/media`,
    {
      method: "POST",
      body: {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption,
        access_token: accessToken,
      },
    },
  )
  if (!parent.ok || !parent.data?.id) {
    return { success: false, error: extractIgError(parent.errorText) }
  }

  // Step 4: publish
  const publishRes = await fetchJson<{ id?: string }>(
    `${GRAPH_API_BASE}/${igUserId}/media_publish`,
    {
      method: "POST",
      body: { creation_id: parent.data.id, access_token: accessToken },
    },
  )
  if (!publishRes.ok || !publishRes.data?.id) {
    return { success: false, error: extractIgError(publishRes.errorText) }
  }
  return { success: true, platform_post_id: publishRes.data.id }
}

interface WaitArgs {
  accessToken: string
  containerId: string
}

async function waitForContainerFinished(
  args: WaitArgs,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let delay = CAROUSEL_POLL_INITIAL_DELAY_MS
  for (let attempt = 0; attempt < CAROUSEL_POLL_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetchJson<{
      status_code?: string
      status?: string
      error?: { message: string }
    }>(
      `${GRAPH_API_BASE}/${args.containerId}?fields=status_code,status&access_token=${encodeURIComponent(args.accessToken)}`,
      { method: "GET" },
    )
    if (response.ok) {
      const code = response.data?.status_code
      if (code === "FINISHED") return { ok: true }
      if (code === "ERROR" || code === "EXPIRED") {
        return {
          ok: false,
          error: `Container ${args.containerId} ${code}: ${response.data?.status ?? ""}`.trim(),
        }
      }
      // IN_PROGRESS or PUBLISHED — keep polling (shouldn't be PUBLISHED yet for a child)
    }
    if (attempt < CAROUSEL_POLL_MAX_ATTEMPTS - 1) {
      await sleep(delay)
      delay *= 2
    }
  }
  return {
    ok: false,
    error: `Container ${args.containerId} did not reach FINISHED before timeout`,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

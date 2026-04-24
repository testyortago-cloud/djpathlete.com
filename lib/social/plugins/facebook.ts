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
      const { content, mediaUrl, mediaUrls, postType, scheduledAt } = input

      // Story branch — single image via /photos (unpublished) + /photo_stories,
      // OR single video via 3-phase /video_stories (start/upload/finish).
      if (postType === "story") {
        if (!mediaUrl) {
          return { success: false, error: "Facebook stories require a media URL" }
        }
        if (isVideoUrl(mediaUrl)) {
          return publishVideoStory({
            accessToken: access_token,
            pageId: page_id,
            videoUrl: mediaUrl,
          })
        }
        return publishPhotoStory({
          accessToken: access_token,
          pageId: page_id,
          imageUrl: mediaUrl,
        })
      }

      // Carousel branch — 2+ slides
      if (mediaUrls && mediaUrls.length >= 2) {
        return publishCarousel({
          accessToken: access_token,
          pageId: page_id,
          message: content,
          slideUrls: mediaUrls,
          scheduledAt,
        })
      }

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

interface VideoStoryArgs {
  accessToken: string
  pageId: string
  videoUrl: string
}

async function publishVideoStory(args: VideoStoryArgs): Promise<PublishResult> {
  const { accessToken, pageId, videoUrl } = args

  // Phase 1: start upload — returns video_id + upload_url
  const start = await fetchJson<{
    video_id?: string
    upload_url?: string
    error?: { message: string }
  }>(`${GRAPH_API_BASE}/${pageId}/video_stories`, {
    method: "POST",
    body: { upload_phase: "start", access_token: accessToken },
  })
  if (!start.ok || !start.data?.video_id || !start.data?.upload_url) {
    return { success: false, error: extractFbError(start.errorText) }
  }

  // Phase 2: POST to upload_url with file_url header — Meta fetches the video
  // from our signed URL (no byte chunking). Authorization uses the OAuth prefix.
  const uploadResp = await fetch(start.data.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_url: videoUrl,
    },
  })
  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => "")
    return {
      success: false,
      error: `video_stories upload ${uploadResp.status}: ${text.slice(0, 200)}`,
    }
  }

  // Phase 3: finish — returns post_id
  const finish = await fetchJson<{
    post_id?: string
    success?: boolean
    error?: { message: string }
  }>(`${GRAPH_API_BASE}/${pageId}/video_stories`, {
    method: "POST",
    body: {
      upload_phase: "finish",
      video_id: start.data.video_id,
      access_token: accessToken,
    },
  })
  if (!finish.ok || !finish.data?.post_id) {
    return { success: false, error: extractFbError(finish.errorText) }
  }
  return { success: true, platform_post_id: finish.data.post_id }
}

interface PhotoStoryArgs {
  accessToken: string
  pageId: string
  imageUrl: string
}

async function publishPhotoStory(args: PhotoStoryArgs): Promise<PublishResult> {
  const { accessToken, pageId, imageUrl } = args

  // Step 1: upload the photo unpublished
  const photo = await fetchJson<{ id?: string; error?: { message: string } }>(
    `${GRAPH_API_BASE}/${pageId}/photos`,
    { method: "POST", body: { url: imageUrl, published: false, access_token: accessToken } },
  )
  if (!photo.ok || !photo.data?.id) {
    return { success: false, error: extractFbError(photo.errorText) }
  }

  // Step 2: attach to a Story
  const story = await fetchJson<{ post_id?: string; success?: boolean; error?: { message: string } }>(
    `${GRAPH_API_BASE}/${pageId}/photo_stories`,
    { method: "POST", body: { photo_id: photo.data.id, access_token: accessToken } },
  )
  if (!story.ok || !story.data?.post_id) {
    return { success: false, error: extractFbError(story.errorText) }
  }
  return { success: true, platform_post_id: story.data.post_id }
}

interface CarouselArgs {
  accessToken: string
  pageId: string
  message: string
  slideUrls: string[]
  scheduledAt: string | null
}

async function publishCarousel(args: CarouselArgs): Promise<PublishResult> {
  const { accessToken, pageId, message, slideUrls, scheduledAt } = args

  // Step 1: upload each photo unpublished. Sequential to keep error-surface simple
  // — if one fails, stop and return. Unpublished photos on FB auto-expire in ~24h.
  const mediaFbIds: string[] = []
  for (const url of slideUrls) {
    const photo = await fetchJson<{ id?: string; error?: { message: string } }>(
      `${GRAPH_API_BASE}/${pageId}/photos`,
      {
        method: "POST",
        body: { url, published: false, access_token: accessToken },
      },
    )
    if (!photo.ok || !photo.data?.id) {
      return { success: false, error: extractFbError(photo.errorText) }
    }
    mediaFbIds.push(photo.data.id)
  }

  // Step 2: create the feed post referencing all photos in order
  const feedBody: Record<string, unknown> = {
    message,
    attached_media: mediaFbIds.map((id) => ({ media_fbid: id })),
    access_token: accessToken,
  }
  if (scheduledAt) {
    feedBody.published = false
    feedBody.scheduled_publish_time = Math.floor(new Date(scheduledAt).getTime() / 1000)
  }

  const feed = await fetchJson<{ id?: string; error?: { message: string } }>(
    `${GRAPH_API_BASE}/${pageId}/feed`,
    { method: "POST", body: feedBody },
  )
  if (!feed.ok || !feed.data?.id) {
    return { success: false, error: extractFbError(feed.errorText) }
  }
  return { success: true, platform_post_id: feed.data.id }
}

function extractFbError(raw: string | null): string {
  if (!raw) return "Facebook publish failed"
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } }
    return parsed.error?.message ?? raw
  } catch {
    return raw
  }
}

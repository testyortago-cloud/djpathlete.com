// lib/social/plugins/instagram.ts
// Instagram Business/Creator publishing via IG Graph API (two-step: create container, publish).
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media

import type {
  PublishPlugin,
  PublishInput,
  PublishResult,
  AnalyticsResult,
  ConnectResult,
  PendingPublish,
} from "./types"
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

export interface InstagramDeps {
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
}

type ContainerState = { state: "finished" } | { state: "in_progress" } | { state: "error"; error: string }

type IgPending =
  | { step: "publish"; containerId: string }
  | { step: "children"; childIds: string[]; caption: string }

function readIgPending(data: Record<string, unknown>): IgPending | null {
  if (data.step === "publish" && typeof data.containerId === "string") {
    return { step: "publish", containerId: data.containerId }
  }
  if (
    data.step === "children" &&
    Array.isArray(data.childIds) &&
    data.childIds.every((id) => typeof id === "string") &&
    typeof data.caption === "string"
  ) {
    return { step: "children", childIds: data.childIds as string[], caption: data.caption }
  }
  return null
}

export function createInstagramPlugin(
  credentials: InstagramCredentials,
  deps: InstagramDeps = {},
): PublishPlugin {
  const { access_token, ig_user_id } = credentials
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? (() => new Date())

  async function statusOf(containerId: string): Promise<ContainerState> {
    const response = await fetchJson<{ status_code?: string; status?: string }>(
      `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(access_token)}`,
      { method: "GET" },
    )
    if (!response.ok) return { state: "in_progress" } // a failed status read is retried next tick
    const code = response.data?.status_code
    if (code === "FINISHED") return { state: "finished" }
    if (code === "ERROR" || code === "EXPIRED") {
      const status = response.data?.status
      return { state: "error", error: `Instagram could not process the media (${code}${status ? `: ${status}` : ""})` }
    }
    return { state: "in_progress" }
  }

  async function checkOnce(ids: string[]): Promise<ContainerState> {
    let pending = false
    for (const id of ids) {
      const s = await statusOf(id)
      if (s.state === "error") return s
      if (s.state === "in_progress") pending = true
    }
    return pending ? { state: "in_progress" } : { state: "finished" }
  }

  async function waitBriefly(ids: string[]): Promise<ContainerState> {
    let delay = CAROUSEL_POLL_INITIAL_DELAY_MS
    for (let attempt = 0; attempt < CAROUSEL_POLL_MAX_ATTEMPTS; attempt += 1) {
      const s = await checkOnce(ids)
      if (s.state !== "in_progress") return s
      if (attempt < CAROUSEL_POLL_MAX_ATTEMPTS - 1) {
        await sleep(delay)
        delay *= 2
      }
    }
    return { state: "in_progress" }
  }

  function pendingResult(data: IgPending, startedAt: string): PublishResult {
    return { success: true, pending: { startedAt, data: data as unknown as Record<string, unknown> } }
  }

  async function publishContainer(creationId: string): Promise<PublishResult> {
    const res = await fetchJson<{ id?: string }>(`${GRAPH_API_BASE}/${ig_user_id}/media_publish`, {
      method: "POST",
      body: { creation_id: creationId, access_token },
    })
    if (!res.ok || !res.data?.id) return { success: false, error: extractIgError(res.errorText) }
    return { success: true, platform_post_id: res.data.id }
  }

  /** Waits on one container, then publishes it or answers pending. */
  async function finishSingle(
    containerId: string,
    startedAt: string,
    wait: (ids: string[]) => Promise<ContainerState>,
  ): Promise<PublishResult> {
    const s = await wait([containerId])
    if (s.state === "error") return { success: false, error: s.error }
    if (s.state === "in_progress") return pendingResult({ step: "publish", containerId }, startedAt)
    return publishContainer(containerId)
  }

  async function createParent(
    childIds: string[],
    caption: string,
    hasVideo: boolean,
    startedAt: string,
  ): Promise<PublishResult> {
    const parent = await fetchJson<{ id?: string; error?: { message: string } }>(
      `${GRAPH_API_BASE}/${ig_user_id}/media`,
      {
        method: "POST",
        body: { media_type: "CAROUSEL", children: childIds.join(","), caption, access_token },
      },
    )
    if (!parent.ok || !parent.data?.id) return { success: false, error: extractIgError(parent.errorText) }
    if (!hasVideo) return publishContainer(parent.data.id) // photo-only: unchanged from before
    return finishSingle(parent.data.id, startedAt, waitBriefly)
  }

  async function resume(saved: PendingPublish): Promise<PublishResult> {
    const state = readIgPending(saved.data)
    if (!state) return { success: false, error: "Saved Instagram publish state is unreadable — schedule the post again." }
    if (state.step === "publish") return finishSingle(state.containerId, saved.startedAt, checkOnce)
    const s = await checkOnce(state.childIds)
    if (s.state === "error") return { success: false, error: s.error }
    if (s.state === "in_progress") return { success: true, pending: saved }
    return createParent(state.childIds, state.caption, true, saved.startedAt)
  }

  async function publishStory(mediaUrl: string, startedAt: string): Promise<PublishResult> {
    // Caption NOT sent — IG ignores it on stories.
    const containerBody: Record<string, unknown> = { media_type: "STORIES", access_token }
    if (isVideoUrl(mediaUrl)) containerBody.video_url = mediaUrl
    else containerBody.image_url = mediaUrl

    const container = await fetchJson<{ id?: string; error?: { message: string } }>(
      `${GRAPH_API_BASE}/${ig_user_id}/media`,
      { method: "POST", body: containerBody },
    )
    if (!container.ok || !container.data?.id) {
      return { success: false, error: extractIgError(container.errorText) }
    }
    return finishSingle(container.data.id, startedAt, waitBriefly)
  }

  async function publishCarousel(
    caption: string,
    slideUrls: string[],
    kinds: PublishInput["mediaKinds"],
    startedAt: string,
  ): Promise<PublishResult> {
    const childIds: string[] = []
    let hasVideo = false
    for (let i = 0; i < slideUrls.length; i += 1) {
      const url = slideUrls[i]
      const isVideo = kinds?.[i] === "video"
      if (isVideo) hasVideo = true
      const body: Record<string, unknown> = isVideo
        ? { media_type: "VIDEO", video_url: url, is_carousel_item: true, access_token }
        : { image_url: url, is_carousel_item: true, access_token }
      const child = await fetchJson<{ id?: string; error?: { message: string } }>(
        `${GRAPH_API_BASE}/${ig_user_id}/media`,
        { method: "POST", body },
      )
      if (!child.ok || !child.data?.id) {
        return { success: false, error: extractIgError(child.errorText) }
      }
      childIds.push(child.data.id)
    }

    const s = await waitBriefly(childIds)
    if (s.state === "error") return { success: false, error: s.error }
    if (s.state === "in_progress") return pendingResult({ step: "children", childIds, caption }, startedAt)
    return createParent(childIds, caption, hasVideo, startedAt)
  }

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
      if (input.resumeState) return resume(input.resumeState)
      const startedAt = now().toISOString()
      const { content, mediaUrl, mediaUrls, postType } = input

      // Story branch — single image or video, media_type=STORIES
      if (postType === "story") {
        if (!mediaUrl) {
          return { success: false, error: "Instagram stories require a media URL" }
        }
        return publishStory(mediaUrl, startedAt)
      }

      // Carousel branch — 2+ slides
      if (mediaUrls && mediaUrls.length >= 2) {
        return publishCarousel(content, mediaUrls, input.mediaKinds, startedAt)
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

      if (isVideoUrl(mediaUrl)) return finishSingle(container.data.id, startedAt, waitBriefly)
      return publishContainer(container.data.id)
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

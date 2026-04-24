// lib/social/plugins/linkedin.ts
// LinkedIn Company Page publishing via the versioned REST API.
// Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
// Phase 1c: text and single-image posts supported. Video and article posts are
// not supported in this release.

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"

const API_VERSION = "202604"
const POSTS_URL = "https://api.linkedin.com/rest/posts"
const IMAGES_URL = "https://api.linkedin.com/rest/images"

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)(\?|$)/i
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv)(\?|$)/i

const POLL_MAX_ATTEMPTS = 5
const POLL_INITIAL_DELAY_MS = 500

export interface LinkedInCredentials {
  access_token: string
  organization_id: string
}

export function createLinkedInPlugin(credentials: LinkedInCredentials): PublishPlugin {
  const { access_token, organization_id } = credentials

  return {
    name: "linkedin",
    displayName: "LinkedIn",

    async connect(): Promise<ConnectResult> {
      // Classic /v2/organizations still works for the connect check.
      const response = await fetch(`https://api.linkedin.com/v2/organizations/${organization_id}`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      })
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        return { status: "error", error: extractLiError(text) }
      }
      const data = (await response.json()) as { localizedName?: string }
      return { status: "connected", account_handle: data.localizedName }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl } = input

      if (mediaUrl && VIDEO_EXTENSIONS.test(mediaUrl)) {
        return {
          success: false,
          error: "LinkedIn video publishing is not supported in this release",
        }
      }

      if (mediaUrl && IMAGE_EXTENSIONS.test(mediaUrl)) {
        return publishImagePost({
          accessToken: access_token,
          organizationId: organization_id,
          caption: content,
          imageUrl: mediaUrl,
        })
      }

      return publishTextPost({
        accessToken: access_token,
        organizationId: organization_id,
        caption: content,
      })
    },

    async fetchAnalytics(_postId: string): Promise<AnalyticsResult> {
      return {}
    },

    async disconnect() {
      // no-op
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your LinkedIn Company Page",
        "",
        "LinkedIn posting requires a LinkedIn Company Page (not a personal profile) and an approved developer app.",
        "",
        "1. Create a Company Page at https://www.linkedin.com/company/setup/new (free, 20 minutes + verification).",
        "2. Apply to LinkedIn's Marketing Developer Platform for your app (free, 5–10 business days).",
        "3. Once approved, request the `w_organization_social` scope for the Page admin.",
        "4. Paste your organization id and the page access token into the Connect dialog.",
        "",
        "Phase 2a note: automated posting works once the token is present. Phase 2b adds the full OAuth flow.",
      ].join("\n")
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Text post
// ──────────────────────────────────────────────────────────────────────────

interface TextPostArgs {
  accessToken: string
  organizationId: string
  caption: string
}

async function publishTextPost(args: TextPostArgs): Promise<PublishResult> {
  const response = await fetch(POSTS_URL, {
    method: "POST",
    headers: versionedHeaders(args.accessToken),
    body: JSON.stringify({
      author: `urn:li:organization:${args.organizationId}`,
      commentary: args.caption,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  })
  return extractPostResult(response)
}

// ──────────────────────────────────────────────────────────────────────────
// Image post (3-step: initializeUpload → PUT → POST /rest/posts)
// ──────────────────────────────────────────────────────────────────────────

interface ImagePostArgs {
  accessToken: string
  organizationId: string
  caption: string
  imageUrl: string
}

async function publishImagePost(args: ImagePostArgs): Promise<PublishResult> {
  // Step 0: download the image bytes from the signed URL we got from resolve-media-url.
  const binary = await fetchBinary(args.imageUrl)
  if (!binary.ok) {
    return { success: false, error: `Image fetch failed: ${binary.error}` }
  }

  // Step 1: initialize upload on LinkedIn.
  const init = await initializeImageUpload(args.accessToken, args.organizationId)
  if (!init.ok) return { success: false, error: init.error }

  // Step 2: PUT the bytes to LinkedIn's upload URL.
  const put = await putImageBytes(args.accessToken, init.uploadUrl, binary.data)
  if (!put.ok) return { success: false, error: put.error }

  // Step 3a: poll until the asset reports AVAILABLE.
  const ready = await waitForImageReady(args.accessToken, init.imageUrn)
  if (!ready.ok) return { success: false, error: ready.error }

  // Step 3b: create the post referencing the image URN.
  const response = await fetch(POSTS_URL, {
    method: "POST",
    headers: versionedHeaders(args.accessToken),
    body: JSON.stringify({
      author: `urn:li:organization:${args.organizationId}`,
      commentary: args.caption,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      content: {
        media: {
          id: init.imageUrn,
          altText: args.caption.slice(0, 4086),
        },
      },
    }),
  })
  return extractPostResult(response)
}

interface InitOk {
  ok: true
  uploadUrl: string
  imageUrn: string
}
interface InitFail {
  ok: false
  error: string
}

async function initializeImageUpload(
  accessToken: string,
  organizationId: string,
): Promise<InitOk | InitFail> {
  const response = await fetch(`${IMAGES_URL}?action=initializeUpload`, {
    method: "POST",
    headers: versionedHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: { owner: `urn:li:organization:${organizationId}` },
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return { ok: false, error: `initializeUpload ${response.status}: ${extractLiError(text)}` }
  }
  const data = (await response.json().catch(() => null)) as {
    value?: { uploadUrl?: string; image?: string }
  } | null
  const uploadUrl = data?.value?.uploadUrl
  const imageUrn = data?.value?.image
  if (!uploadUrl || !imageUrn) {
    return { ok: false, error: "initializeUpload response missing uploadUrl or image urn" }
  }
  return { ok: true, uploadUrl, imageUrn }
}

interface PutOk {
  ok: true
}
interface PutFail {
  ok: false
  error: string
}

async function putImageBytes(
  accessToken: string,
  uploadUrl: string,
  bytes: ArrayBuffer,
): Promise<PutOk | PutFail> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: bytes,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return { ok: false, error: `image upload PUT ${response.status}: ${text.slice(0, 200)}` }
  }
  return { ok: true }
}

interface ReadyOk {
  ok: true
}
interface ReadyFail {
  ok: false
  error: string
}

async function waitForImageReady(
  accessToken: string,
  imageUrn: string,
): Promise<ReadyOk | ReadyFail> {
  let delay = POLL_INITIAL_DELAY_MS
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${IMAGES_URL}/${imageUrn}`, {
      method: "GET",
      headers: versionedHeaders(accessToken),
    })
    if (response.ok) {
      const data = (await response.json().catch(() => null)) as { status?: string } | null
      if (data?.status === "AVAILABLE") return { ok: true }
    }
    if (attempt < POLL_MAX_ATTEMPTS - 1) {
      await sleep(delay)
      delay *= 2
    }
  }
  return { ok: false, error: "LinkedIn image not AVAILABLE after polling timeout" }
}

async function fetchBinary(
  url: string,
): Promise<{ ok: true; data: ArrayBuffer } | { ok: false; error: string }> {
  try {
    const response = await fetch(url)
    if (!response.ok) return { ok: false, error: `${response.status}` }
    const data = await response.arrayBuffer()
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────

function versionedHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": API_VERSION,
    "Content-Type": "application/json",
  }
}

async function extractPostResult(response: Response): Promise<PublishResult> {
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return { success: false, error: extractLiError(text) }
  }
  const urn = response.headers.get("x-restli-id")
  if (!urn) {
    return { success: false, error: "LinkedIn post response missing x-restli-id header" }
  }
  return { success: true, platform_post_id: urn }
}

function extractLiError(raw: string): string {
  if (!raw) return "LinkedIn publish failed"
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string }
    return parsed.message ?? parsed.error ?? raw
  } catch {
    return raw
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

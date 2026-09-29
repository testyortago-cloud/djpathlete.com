// lib/social/plugins/linkedin.ts
// LinkedIn Company Page publishing via the versioned REST API.
// Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
// Text, image, multi-image, video and article (link card) posts are supported.

import type {
  PublishPlugin,
  PublishInput,
  PublishResult,
  PublishLink,
  AnalyticsResult,
  ConnectResult,
} from "./types"
import { escapeLittleText } from "../linkedin-little-text"

// Every call goes through /rest with this header. LinkedIn sunset the
// unversioned /v2 marketing endpoints on 2024-12-16, and a version is itself
// sunset a year after release (202604 → 2027-04-15).
const API_VERSION = "202604"
const ORGANIZATIONS_URL = "https://api.linkedin.com/rest/organizations"
const POSTS_URL = "https://api.linkedin.com/rest/posts"
const IMAGES_URL = "https://api.linkedin.com/rest/images"
const VIDEOS_URL = "https://api.linkedin.com/rest/videos"

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)(\?|$)/i
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv)(\?|$)/i

const POLL_MAX_ATTEMPTS = 5
const POLL_INITIAL_DELAY_MS = 500

const VIDEO_POLL_MAX_ATTEMPTS = 30
const VIDEO_POLL_INITIAL_DELAY_MS = 2000

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
      const response = await fetch(`${ORGANIZATIONS_URL}/${organization_id}`, {
        headers: versionedHeaders(access_token),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        return { status: "error", error: extractLiError(text) }
      }
      const data = (await response.json()) as { localizedName?: string }
      return { status: "connected", account_handle: data.localizedName }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl, mediaUrls, link } = input

      // Multi-image carousel — must come before the single-media branches
      if (mediaUrls && mediaUrls.length >= 2) {
        return publishMultiImagePost({
          accessToken: access_token,
          organizationId: organization_id,
          caption: content,
          imageUrls: mediaUrls,
        })
      }

      if (mediaUrl && VIDEO_EXTENSIONS.test(mediaUrl)) {
        return publishVideoPost({
          accessToken: access_token,
          organizationId: organization_id,
          caption: content,
          videoUrl: mediaUrl,
        })
      }

      if (mediaUrl && IMAGE_EXTENSIONS.test(mediaUrl)) {
        return publishImagePost({
          accessToken: access_token,
          organizationId: organization_id,
          caption: content,
          imageUrl: mediaUrl,
        })
      }

      if (link) {
        return publishArticlePost({
          accessToken: access_token,
          organizationId: organization_id,
          caption: content,
          link,
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
      commentary: escapeLittleText(args.caption),
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
// Article (link card) post. LinkedIn's API does not scrape URLs, so the card's
// title, description and thumbnail are supplied here. A thumbnail that cannot
// be fetched or uploaded degrades to a card without an image, never a failed post.
// ──────────────────────────────────────────────────────────────────────────

interface ArticlePostArgs {
  accessToken: string
  organizationId: string
  caption: string
  link: PublishLink
}

async function uploadThumbnail(args: ArticlePostArgs): Promise<string | null> {
  try {
    return await uploadThumbnailUnsafe(args)
  } catch (err) {
    console.warn(`[linkedin] card image upload threw (${(err as Error).message}); posting the card without it`)
    return null
  }
}

async function uploadThumbnailUnsafe(args: ArticlePostArgs): Promise<string | null> {
  if (!args.link.imageUrl) return null
  const binary = await fetchBinary(args.link.imageUrl)
  if (!binary.ok) {
    console.warn(`[linkedin] card image fetch failed (${binary.error}); posting the card without it`)
    return null
  }
  const init = await initializeImageUpload(args.accessToken, args.organizationId)
  if (!init.ok) {
    console.warn(`[linkedin] card image init failed (${init.error}); posting the card without it`)
    return null
  }
  const put = await putImageBytes(args.accessToken, init.uploadUrl, binary.data)
  if (!put.ok) {
    console.warn(`[linkedin] card image upload failed (${put.error}); posting the card without it`)
    return null
  }
  const ready = await waitForImageReady(args.accessToken, init.imageUrn)
  if (!ready.ok) {
    console.warn(`[linkedin] card image not ready (${ready.error}); posting the card without it`)
    return null
  }
  return init.imageUrn
}

async function publishArticlePost(args: ArticlePostArgs): Promise<PublishResult> {
  const thumbnail = await uploadThumbnail(args)
  const article: Record<string, string> = { source: args.link.url, title: args.link.title }
  if (args.link.description) article.description = args.link.description
  if (thumbnail) article.thumbnail = thumbnail

  const response = await fetch(POSTS_URL, {
    method: "POST",
    headers: versionedHeaders(args.accessToken),
    body: JSON.stringify({
      author: `urn:li:organization:${args.organizationId}`,
      commentary: escapeLittleText(args.caption),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      content: { article },
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
      commentary: escapeLittleText(args.caption),
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

// ──────────────────────────────────────────────────────────────────────────
// Multi-image post (N × upload flow, then POST /rest/posts with content.multiImage)
// ──────────────────────────────────────────────────────────────────────────

interface MultiImageArgs {
  accessToken: string
  organizationId: string
  caption: string
  imageUrls: string[]
}

async function publishMultiImagePost(args: MultiImageArgs): Promise<PublishResult> {
  const { accessToken, organizationId, caption, imageUrls } = args

  // Step 1: for each image URL, download bytes → initializeUpload → PUT → poll AVAILABLE.
  // Sequential to keep error surface simple. If any image fails, bail out and return.
  const imageUrns: string[] = []
  for (let i = 0; i < imageUrls.length; i += 1) {
    const url = imageUrls[i]

    const binary = await fetchBinary(url)
    if (!binary.ok) {
      return { success: false, error: `Image ${i + 1} fetch failed: ${binary.error}` }
    }

    const init = await initializeImageUpload(accessToken, organizationId)
    if (!init.ok) return { success: false, error: `Image ${i + 1} init: ${init.error}` }

    const put = await putImageBytes(accessToken, init.uploadUrl, binary.data)
    if (!put.ok) return { success: false, error: `Image ${i + 1} PUT: ${put.error}` }

    const ready = await waitForImageReady(accessToken, init.imageUrn)
    if (!ready.ok) return { success: false, error: `Image ${i + 1} not ready: ${ready.error}` }

    imageUrns.push(init.imageUrn)
  }

  // Step 2: create the post with content.multiImage.images[]
  const response = await fetch(POSTS_URL, {
    method: "POST",
    headers: versionedHeaders(accessToken),
    body: JSON.stringify({
      author: `urn:li:organization:${organizationId}`,
      commentary: escapeLittleText(caption),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      content: {
        multiImage: {
          images: imageUrns.map((urn, i) => ({
            id: urn,
            altText: caption ? `${caption.slice(0, 100)} (slide ${i + 1})` : `Slide ${i + 1}`,
          })),
        },
      },
    }),
  })
  return extractPostResult(response)
}

// ──────────────────────────────────────────────────────────────────────────
// Video post (5-step: fetch bytes → initializeUpload → PUT chunks → finalize → poll → POST)
// ──────────────────────────────────────────────────────────────────────────

interface VideoPostArgs {
  accessToken: string
  organizationId: string
  caption: string
  videoUrl: string
}

async function publishVideoPost(args: VideoPostArgs): Promise<PublishResult> {
  const { accessToken, organizationId, caption, videoUrl } = args

  // Step 0: download the video bytes from our Firebase signed URL
  const binary = await fetchBinary(videoUrl)
  if (!binary.ok) {
    return { success: false, error: `Video fetch failed: ${binary.error}` }
  }
  const buffer = binary.data

  // Step 1: initialize upload — LinkedIn returns chunked upload instructions
  const init = await initializeVideoUpload({
    accessToken,
    organizationId,
    fileSizeBytes: buffer.byteLength,
  })
  if (!init.ok) return { success: false, error: init.error }

  // Step 2: PUT each chunk, collect ETags in order
  const uploadedPartIds: string[] = []
  for (const instr of init.uploadInstructions) {
    const chunkBytes = buffer.slice(instr.firstByte, instr.lastByte + 1)
    const put = await putVideoChunk(instr.uploadUrl, chunkBytes)
    if (!put.ok) return { success: false, error: put.error }
    uploadedPartIds.push(put.etag)
  }

  // Step 3: finalize upload
  const finalize = await finalizeVideoUpload({
    accessToken,
    videoUrn: init.videoUrn,
    uploadedPartIds,
  })
  if (!finalize.ok) return { success: false, error: finalize.error }

  // Step 4: poll until AVAILABLE
  const ready = await waitForVideoReady({ accessToken, videoUrn: init.videoUrn })
  if (!ready.ok) return { success: false, error: ready.error }

  // Step 5: create the post referencing the video URN
  const response = await fetch(POSTS_URL, {
    method: "POST",
    headers: versionedHeaders(accessToken),
    body: JSON.stringify({
      author: `urn:li:organization:${organizationId}`,
      commentary: escapeLittleText(caption),
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
          id: init.videoUrn,
          title: caption.slice(0, 200),
        },
      },
    }),
  })
  return extractPostResult(response)
}

interface VideoUploadInstruction {
  firstByte: number
  lastByte: number
  uploadUrl: string
}

interface InitVideoOk {
  ok: true
  videoUrn: string
  uploadInstructions: VideoUploadInstruction[]
}
interface InitVideoFail {
  ok: false
  error: string
}

async function initializeVideoUpload(args: {
  accessToken: string
  organizationId: string
  fileSizeBytes: number
}): Promise<InitVideoOk | InitVideoFail> {
  const response = await fetch(`${VIDEOS_URL}?action=initializeUpload`, {
    method: "POST",
    headers: versionedHeaders(args.accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: `urn:li:organization:${args.organizationId}`,
        fileSizeBytes: args.fileSizeBytes,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return { ok: false, error: `initializeUpload ${response.status}: ${extractLiError(text)}` }
  }
  const data = (await response.json().catch(() => null)) as {
    value?: { video?: string; uploadInstructions?: VideoUploadInstruction[] }
  } | null
  const videoUrn = data?.value?.video
  const instructions = data?.value?.uploadInstructions
  if (!videoUrn || !Array.isArray(instructions) || instructions.length === 0) {
    return { ok: false, error: "initializeUpload response missing video urn or uploadInstructions" }
  }
  return { ok: true, videoUrn, uploadInstructions: instructions }
}

async function putVideoChunk(
  uploadUrl: string,
  bytes: ArrayBuffer,
): Promise<{ ok: true; etag: string } | { ok: false; error: string }> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return { ok: false, error: `video chunk PUT ${response.status}: ${text.slice(0, 200)}` }
  }
  const rawEtag = response.headers.get("etag") ?? response.headers.get("ETag") ?? ""
  if (!rawEtag) {
    return { ok: false, error: "video chunk PUT response missing etag header" }
  }
  const etag = rawEtag.replace(/^"|"$/g, "")
  return { ok: true, etag }
}

async function finalizeVideoUpload(args: {
  accessToken: string
  videoUrn: string
  uploadedPartIds: string[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(`${VIDEOS_URL}?action=finalizeUpload`, {
    method: "POST",
    headers: versionedHeaders(args.accessToken),
    body: JSON.stringify({
      finalizeUploadRequest: {
        video: args.videoUrn,
        uploadToken: "",
        uploadedPartIds: args.uploadedPartIds,
      },
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return { ok: false, error: `finalizeUpload ${response.status}: ${extractLiError(text)}` }
  }
  return { ok: true }
}

async function waitForVideoReady(args: {
  accessToken: string
  videoUrn: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let delay = VIDEO_POLL_INITIAL_DELAY_MS
  for (let attempt = 0; attempt < VIDEO_POLL_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${VIDEOS_URL}/${encodeURIComponent(args.videoUrn)}`, {
      method: "GET",
      headers: versionedHeaders(args.accessToken),
    })
    if (response.ok) {
      const data = (await response.json().catch(() => null)) as {
        status?: string
        processingFailureReason?: string
      } | null
      if (data?.status === "AVAILABLE") return { ok: true }
      if (data?.status === "PROCESSING_FAILED") {
        return {
          ok: false,
          error: `Video PROCESSING_FAILED: ${data.processingFailureReason ?? "unknown"}`,
        }
      }
    }
    if (attempt < VIDEO_POLL_MAX_ATTEMPTS - 1) {
      await sleep(delay)
      // Gentle backoff — cap at 10s to avoid waiting 5min on the last attempt
      delay = Math.min(delay + 1000, 10_000)
    }
  }
  return { ok: false, error: "Video did not reach AVAILABLE before polling timeout" }
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

export function versionedHeaders(accessToken: string): Record<string, string> {
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

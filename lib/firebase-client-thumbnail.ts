// lib/firebase-client-thumbnail.ts
// Generate a small JPG thumbnail from a video File client-side (canvas seek
// to 1s → drawImage → toBlob), then upload it via the same signed-URL pattern
// used for video uploads. Best-effort — a failure here does not block upload.

const THUMB_MAX_WIDTH = 480
const THUMB_JPEG_QUALITY = 0.75
const SEEK_TARGET_SECONDS = 1.0

type ThumbnailSource =
  | { kind: "file"; file: File }
  | { kind: "url"; url: string }

/**
 * Encode the frame a <video> element is CURRENTLY showing to a JPEG Blob.
 * Does not seek — the displayed frame is the operator's choice. Returns null
 * if the element has no decoded dimensions, or the canvas is tainted (remote
 * source without CORS).
 */
export function captureFrameFromElement(video: HTMLVideoElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      if (!video.videoWidth || !video.videoHeight) return resolve(null)
      const ratio = video.videoHeight / video.videoWidth
      const width = Math.min(THUMB_MAX_WIDTH, video.videoWidth)
      const height = Math.round(width * ratio)
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) return resolve(null)
      ctx.drawImage(video, 0, 0, width, height)
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", THUMB_JPEG_QUALITY)
    } catch {
      resolve(null)
    }
  })
}

function captureFrame(source: ThumbnailSource): Promise<Blob | null> {
  return new Promise((resolve) => {
    const objectUrl = source.kind === "file" ? URL.createObjectURL(source.file) : null
    const video = document.createElement("video")
    video.preload = "metadata"
    video.muted = true
    video.playsInline = true
    // crossOrigin is only meaningful for remote URLs. Required so canvas reads
    // aren't tainted; depends on the bucket having CORS configured. If CORS is
    // missing, the video element will fail to load and we silently bail.
    if (source.kind === "url") video.crossOrigin = "anonymous"
    video.src = source.kind === "file" ? objectUrl! : source.url

    let settled = false
    const cleanup = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      video.removeAttribute("src")
      video.load()
    }
    const finish = (blob: Blob | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(blob)
    }

    video.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const target = duration > 0 ? Math.min(SEEK_TARGET_SECONDS, duration / 2) : 0
      try {
        video.currentTime = target
      } catch {
        finish(null)
      }
    })

    video.addEventListener("seeked", () => {
      void captureFrameFromElement(video).then(finish)
    })

    video.addEventListener("error", () => finish(null))
    // Safety timeout — some browsers never fire "seeked" on odd codecs.
    setTimeout(() => finish(null), 15_000)
  })
}

/**
 * Render a single frame from a video File to a JPEG Blob.
 * Resolves null if the browser cannot load the video (e.g. unsupported codec).
 */
export function generateVideoThumbnail(file: File): Promise<Blob | null> {
  return captureFrame({ kind: "file", file })
}

/**
 * Render a single frame from a remote video URL (e.g. Firebase Storage signed URL).
 * Resolves null if the browser cannot load the video, the URL has no CORS
 * headers, or canvas reads taint. Used by paths where no File is available
 * (e.g. promoting a team-video submission to Content Studio).
 */
export function generateVideoThumbnailFromUrl(url: string): Promise<Blob | null> {
  return captureFrame({ kind: "url", url })
}

/**
 * Full flow: request a signed upload URL for the thumbnail, PUT the bytes.
 * Returns true on success. Silently returns false on any error; the caller
 * does not need to block on this.
 */
export async function uploadThumbnailFor(
  videoUploadId: string,
  blob: Blob,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/admin/videos/${videoUploadId}/thumbnail`,
      { method: "POST" },
    )
    if (!res.ok) return false
    const { uploadUrl } = (await res.json()) as { uploadUrl: string }
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    })
    return put.ok
  } catch {
    return false
  }
}

/**
 * Convenience wrapper: generate + upload in one call. Swallows all errors.
 */
export async function generateAndUploadThumbnail(
  file: File,
  videoUploadId: string,
): Promise<void> {
  const blob = await generateVideoThumbnail(file)
  if (!blob) return
  await uploadThumbnailFor(videoUploadId, blob)
}

/**
 * Set a CUSTOM thumbnail: ask for a unique path, PUT the bytes, and only then
 * ask the server to point the row at it. The row is never written before the
 * bytes land — a failed PUT must not destroy a working thumbnail.
 */
export async function commitThumbnail(
  videoUploadId: string,
  blob: Blob,
  source: "frame" | "upload",
): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/videos/${videoUploadId}/thumbnail/custom`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: blob.type || "image/jpeg" }),
    })
    if (!res.ok) return false
    const { uploadUrl, thumbnailPath } = (await res.json()) as {
      uploadUrl: string
      thumbnailPath: string
    }

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": blob.type || "image/jpeg" },
      body: blob,
    })
    if (!put.ok) return false

    const commit = await fetch(`/api/admin/videos/${videoUploadId}/thumbnail`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thumbnailPath, source }),
    })
    return commit.ok
  } catch {
    return false
  }
}

/**
 * Point the row back at the auto-captured thumbnail. Returns false when the
 * server answers 409 — the original blob no longer exists, so there is nothing
 * to revert to and the custom one is deliberately left in place.
 */
export async function revertThumbnailToAuto(videoUploadId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/videos/${videoUploadId}/thumbnail`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "auto" }),
    })
    return res.ok
  } catch {
    return false
  }
}

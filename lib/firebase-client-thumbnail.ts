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
      try {
        const ratio = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 0.5625
        const width = Math.min(THUMB_MAX_WIDTH, video.videoWidth || THUMB_MAX_WIDTH)
        const height = Math.round(width * ratio)
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) return finish(null)
        ctx.drawImage(video, 0, 0, width, height)
        canvas.toBlob(
          (blob) => finish(blob),
          "image/jpeg",
          THUMB_JPEG_QUALITY,
        )
      } catch {
        finish(null)
      }
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

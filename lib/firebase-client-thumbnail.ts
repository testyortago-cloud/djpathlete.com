// lib/firebase-client-thumbnail.ts
// Generate a small JPG thumbnail from a video File client-side (canvas seek
// to 1s → drawImage → toBlob), then upload it via the same signed-URL pattern
// used for video uploads. Best-effort — a failure here does not block upload.

const THUMB_MAX_WIDTH = 480
const THUMB_JPEG_QUALITY = 0.75
const SEEK_TARGET_SECONDS = 1.0

/**
 * Render a single frame from a video File to a JPEG Blob.
 * Resolves null if the browser cannot load the video (e.g. unsupported codec).
 */
export function generateVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    video.preload = "metadata"
    video.muted = true
    video.playsInline = true
    video.src = url

    let settled = false
    const cleanup = () => {
      URL.revokeObjectURL(url)
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

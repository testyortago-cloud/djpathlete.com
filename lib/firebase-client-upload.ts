// lib/firebase-client-upload.ts
// Client-side helper that uploads a File to Firebase Storage via a signed URL
// obtained from POST /api/admin/videos. Uses fetch() directly — no Firebase
// JS SDK dependency needed for the upload itself (the signed URL accepts a
// plain PUT). Reports progress via XHR since fetch() doesn't expose progress.

export interface UploadRequestBody {
  filename: string
  contentType: string
  title?: string
}

export interface UploadApiResponse {
  videoUploadId: string
  uploadUrl: string
  storagePath: string
  expiresInSeconds: number
}

export interface UploadProgressEvent {
  loaded: number
  total: number
  percent: number
}

export async function requestSignedUpload(body: UploadRequestBody): Promise<UploadApiResponse> {
  const response = await fetch("/api/admin/videos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "")
    throw new Error(`Upload request failed (${response.status}): ${errorBody}`)
  }
  return (await response.json()) as UploadApiResponse
}

/**
 * PUT the file bytes to the signed Storage URL. Uses XHR so we can report
 * progress — fetch() has no browser-native upload progress event yet.
 */
export function uploadToSignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (event: UploadProgressEvent) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", uploadUrl)
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4")

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      })
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload PUT failed with status ${xhr.status}: ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error("Network error during upload"))
    xhr.onabort = () => reject(new Error("Upload aborted"))

    xhr.send(file)
  })
}

/**
 * Full flow: request signed URL → PUT bytes → return video upload id.
 */
export async function uploadVideoFile(
  file: File,
  options: { title?: string; onProgress?: (event: UploadProgressEvent) => void } = {},
): Promise<{ videoUploadId: string; storagePath: string }> {
  const { videoUploadId, uploadUrl, storagePath } = await requestSignedUpload({
    filename: file.name,
    contentType: file.type || "video/mp4",
    title: options.title,
  })
  await uploadToSignedUrl(uploadUrl, file, options.onProgress)
  return { videoUploadId, storagePath }
}

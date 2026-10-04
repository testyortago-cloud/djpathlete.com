// lib/quizzes/poster-frame.ts — a JPEG poster grabbed in the browser.
//
// Resolves null instead of throwing whenever it cannot: Chrome cannot decode
// an iPhone HEVC .mov, a corrupt file never fires loadeddata, and a clip with
// no poster still works (the player shows its first frame once played). The
// timeout is what makes "never fires" a null rather than a hung upload.

const TIMEOUT_MS = 8000

export async function grabPosterFrame(file: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  try {
    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    const settle = (event: "loadeddata" | "seeked") =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), TIMEOUT_MS)
        video.addEventListener(event, () => { clearTimeout(timer); resolve(true) }, { once: true })
        video.addEventListener("error", () => { clearTimeout(timer); resolve(false) }, { once: true })
      })
    const loaded = settle("loadeddata")
    video.src = url
    if (!(await loaded)) return null
    const seeked = settle("seeked")
    video.currentTime = Math.min(1, (video.duration || 0) / 2)
    if (!(await seeked)) return null
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext("2d")
    if (!context || canvas.width === 0) return null
    context.drawImage(video, 0, 0)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
  } finally {
    video.removeAttribute("src")
    URL.revokeObjectURL(url)
  }
}

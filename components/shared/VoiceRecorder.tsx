"use client"

import { useEffect, useRef, useState } from "react"
import { ref as storageRef, uploadBytesResumable } from "firebase/storage"
import { storage } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Mic, Square, Send, Trash2, Loader2 } from "lucide-react"
import { toast } from "sonner"

export type VoiceRecorderState = "idle" | "recording" | "stopped" | "uploading"

interface VoiceRecorderProps {
  userId: string
  onSend(payload: {
    storage_path: string
    mime_type: string
    duration_seconds: number
    byte_size: number
  }): Promise<void>
  onStateChange?: (state: VoiceRecorderState) => void
  disabled?: boolean
}

const MAX_DURATION_SECONDS = 300
const MAX_BYTES = 6 * 1024 * 1024
const MIC_ERROR_TOAST_ID = "voice-recorder-mic-error"

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus"
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm"
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4"
  return null
}

// Translate a getUserMedia rejection into a message the user can act on.
// Returns null for benign cases (user dismissed the prompt) — no toast needed.
export function micErrorMessage(err: unknown): string | null {
  const name = (err as DOMException | undefined)?.name
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone blocked. Click the lock icon in the address bar → Site settings → Microphone → Allow, then click the mic button again."
    case "NotReadableError":
    case "TrackStartError":
      return "Microphone is in use by another app. Close anything using the mic and try again."
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "No microphone found. Check your audio devices."
    case "SecurityError":
      return "Voice recording requires a secure (HTTPS) connection."
    case "AbortError":
      return null
    default:
      return "Couldn't access the microphone. Try again."
  }
}

function normalizeMime(mime: string): "audio/webm" | "audio/mp4" | "audio/ogg" {
  if (mime.startsWith("audio/webm")) return "audio/webm"
  if (mime.startsWith("audio/mp4")) return "audio/mp4"
  return "audio/ogg"
}

function extFor(mime: string): string {
  if (mime.startsWith("audio/webm")) return "webm"
  if (mime.startsWith("audio/mp4")) return "m4a"
  return "ogg"
}

export function VoiceRecorder({ userId, onSend, onStateChange, disabled }: VoiceRecorderProps) {
  const [state, setState] = useState<VoiceRecorderState>("idle")

  // Notify parent on every state change so it can reflow layout — e.g. hide
  // the text Textarea and text-Send button while a recording is in progress
  // or being previewed, so the native <audio controls> widget doesn't push
  // the row off-screen on mobile.
  useEffect(() => {
    onStateChange?.(state)
  }, [state, onStateChange])

  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const supported =
    typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    timerRef.current = null
    stopTimerRef.current = null
  }

  useEffect(() => cleanupStream, [])

  // Watch mic permission state. If the user fixes a prior block via the lock
  // icon → Site settings, dismiss the stale error toast so the UI doesn't lie.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return

    let status: PermissionStatus | null = null
    let cancelled = false

    function handleChange() {
      if (status?.state === "granted") toast.dismiss(MIC_ERROR_TOAST_ID)
    }

    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((s) => {
        if (cancelled) return
        status = s
        status.addEventListener("change", handleChange)
      })
      .catch(() => {
        // Firefox + Safari don't expose "microphone" via the Permissions API.
        // Recording still works; we just lose the auto-dismiss nicety.
      })

    return () => {
      cancelled = true
      status?.removeEventListener("change", handleChange)
    }
  }, [])

  function reset() {
    setBlob(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setElapsed(0)
    setProgress(0)
    setState("idle")
    cleanupStream()
  }

  async function startRecording() {
    const mime = pickMimeType()
    if (!mime) {
      toast.error("Your browser doesn't support voice recording.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 })
      recorderRef.current = rec
      rec.ondataavailable = (e) => {
        if ((e as { data: Blob }).data.size > 0) chunksRef.current.push((e as { data: Blob }).data)
      }
      rec.onstop = () => {
        const recordedBlob = new Blob(chunksRef.current, { type: mime })
        setBlob(recordedBlob)
        setPreviewUrl(URL.createObjectURL(recordedBlob))
        setState("stopped")
      }
      rec.start()
      setState("recording")
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
      stopTimerRef.current = setTimeout(() => stopRecording(), MAX_DURATION_SECONDS * 1000)
    } catch (err) {
      // Demoted to warn: NotAllowedError / NotFoundError / NotReadableError /
      // AbortError are all user-initiated or environment outcomes (user denied
      // permission, no mic plugged in, mic in use, prompt dismissed) — not
      // app bugs. The toast tells the user how to fix it; the log is for
      // optional debugging. Truly unexpected errors still surface in the log
      // text + the fallback toast message.
      console.warn("getUserMedia rejected:", (err as DOMException | undefined)?.name ?? err)
      const msg = micErrorMessage(err)
      if (msg) toast.error(msg, { id: MIC_ERROR_TOAST_ID })
      cleanupStream()
      setState("idle")
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop()
    }
    if (timerRef.current) clearInterval(timerRef.current)
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
  }

  async function handleSend() {
    if (!blob) return
    if (elapsed < 1) {
      toast.error("Recording too short. Hold for at least 1 second.")
      return
    }
    if (blob.size < 1024) {
      // 0-byte / sub-1KB blobs slip through occasionally on mobile when the
      // mic captured silence or the recorder produced no chunks. Storage rule
      // would accept them but the backend validator's byte_size >= 1 + audio
      // playback would be a broken UX.
      toast.error("Recording looks empty. Try again — speak after the red dot appears.")
      return
    }
    if (blob.size > MAX_BYTES) {
      toast.error("Voice message too large. Re-record a shorter clip.")
      return
    }
    setState("uploading")
    // Some mobile browsers leave blob.type empty when codec params get
    // stripped during the Blob construction. Fall back to a sane default so
    // the Firebase Storage rule `contentType.matches('audio/.*')` still passes
    // and the upload doesn't 403.
    const blobMime = blob.type && blob.type.startsWith("audio/") ? blob.type : pickMimeType() ?? "audio/webm"
    const mime = normalizeMime(blobMime)
    const ext = extFor(blobMime)
    const path = `form-review-audio/${userId}/${Date.now()}.${ext}`
    const ref = storageRef(storage, path)

    // Stage 1: upload to Firebase Storage.
    try {
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(ref, blob, { contentType: blobMime })
        task.on(
          "state_changed",
          (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          (err) => reject(err),
          () => resolve(),
        )
      })
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const code = e.code ?? "unknown"
      console.error("Voice upload (storage) failed:", code, e.message ?? e)
      const detail =
        code === "storage/retry-limit-exceeded" || code === "storage/canceled"
          ? "Upload timed out. Check your connection and try again."
          : code === "storage/unauthorized"
            ? `Upload blocked by storage rule (${blobMime}). Refresh and try again.`
            : `Upload failed (${code}). ${e.message ?? ""}`.trim()
      toast.error(detail)
      setState("stopped")
      return
    }

    // Stage 2: register the message with the API.
    try {
      await onSend({
        storage_path: path,
        mime_type: mime,
        duration_seconds: elapsed,
        byte_size: blob.size,
      })
      reset()
    } catch (err) {
      const e = err as Error
      console.error("Voice send (API) failed:", e.message ?? e)
      toast.error(`Couldn't save voice message: ${e.message ?? "server error"}`)
      setState("stopped")
    }
  }

  if (!supported) return null

  function formatTime(s: number) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  if (state === "idle") {
    return (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Record voice message"
        title="Record voice message. Pick 'Always Allow' when prompted so you don't re-grant per session."
        onClick={startRecording}
        disabled={disabled}
      >
        <Mic className="size-4" />
      </Button>
    )
  }

  if (state === "recording") {
    return (
      <div className="flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 rounded-md bg-red-50 border border-red-200">
        <span className="size-2 shrink-0 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-mono text-red-700 tabular-nums shrink-0">{formatTime(elapsed)}</span>
        <span className="flex-1" />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Stop recording"
          onClick={stopRecording}
          className="shrink-0"
        >
          <Square className="size-4 fill-current" />
        </Button>
      </div>
    )
  }

  if (state === "stopped" && previewUrl) {
    return (
      <div className="flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 rounded-md bg-muted">
        <audio src={previewUrl} controls className="h-8 min-w-0 max-w-full flex-1" />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Delete recording"
          onClick={reset}
          className="shrink-0"
        >
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
        <Button type="button" size="icon" aria-label="Send voice message" onClick={handleSend} className="shrink-0">
          <Send className="size-4" />
        </Button>
      </div>
    )
  }

  // uploading
  return (
    <div className="flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 rounded-md bg-muted">
      <Loader2 className="size-4 shrink-0 animate-spin" />
      <span className="text-xs text-muted-foreground">{progress}%</span>
    </div>
  )
}

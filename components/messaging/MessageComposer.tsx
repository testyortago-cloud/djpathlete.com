"use client"

import { useCallback, useRef, useState } from "react"
import { Paperclip, Send, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { validateAttachmentSpecs } from "@/lib/messaging/attachments"
import { ALLOWED_MIME_TYPES, MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/messaging/config"
import { EmojiPickerPopover } from "./EmojiPickerPopover"
import type { SendInput } from "./MessagingProvider"

interface PendingFile {
  id: string
  file: File
  progress: number
  storagePath: string | null
  error: string | null
  width?: number
  height?: number
  duration?: number
}

/** Read intrinsic dimensions so the bubble can reserve space before load. */
async function measure(file: File): Promise<{ width?: number; height?: number; duration?: number }> {
  const url = URL.createObjectURL(file)
  try {
    if (file.type.startsWith("image/")) {
      return await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = () => resolve({})
        img.src = url
      })
    }
    return await new Promise((resolve) => {
      const video = document.createElement("video")
      video.preload = "metadata"
      video.onloadedmetadata = () =>
        resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration })
      video.onerror = () => resolve({})
      video.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** PUT with progress. fetch() cannot report upload progress; XHR can. */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("Content-Type", file.type)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)))
    xhr.onerror = () => reject(new Error("Network error"))
    xhr.send(file)
  })
}

export function MessageComposer({
  conversationId,
  onSend,
  onTyping,
  disabled,
}: {
  conversationId: string
  onSend: (input: SendInput) => Promise<{ ok: boolean; error?: string }>
  onTyping?: () => void
  disabled?: boolean
}) {
  const [body, setBody] = useState("")
  const [pending, setPending] = useState<PendingFile[]>([])
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploading = pending.some((p) => p.storagePath === null && !p.error)
  const canSend = !sending && !uploading && (body.trim().length > 0 || pending.some((p) => p.storagePath))

  const addFiles = useCallback(
    async (files: FileList) => {
      const chosen = Array.from(files)
      if (chosen.length + pending.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        toast.error(`Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`)
        return
      }

      // Reject locally BEFORE any request — a 25 MB check that costs a round
      // trip is a worse experience for the exact case it exists to catch.
      const validation = validateAttachmentSpecs(
        chosen.map((f) => ({ mime_type: f.type, byte_size: f.size })),
      )
      if (!validation.ok) {
        toast.error(validation.error)
        return
      }

      const entries: PendingFile[] = chosen.map((file, i) => ({
        id: `${Date.now()}-${i}`,
        file,
        progress: 0,
        storagePath: null,
        error: null,
      }))
      setPending((current) => [...current, ...entries])

      try {
        const res = await fetch("/api/messaging/attachments/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            files: chosen.map((f) => ({ filename: f.name, mime_type: f.type, byte_size: f.size })),
          }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? "Could not start the upload.")
        }

        const { uploads } = await res.json()

        await Promise.all(
          entries.map(async (entry, index) => {
            const upload = uploads[index]
            try {
              const dimensions = await measure(entry.file)
              await putWithProgress(upload.upload_url, entry.file, (pct) =>
                setPending((current) => current.map((p) => (p.id === entry.id ? { ...p, progress: pct } : p))),
              )
              setPending((current) =>
                current.map((p) =>
                  p.id === entry.id
                    ? { ...p, storagePath: upload.storage_path, progress: 100, ...dimensions }
                    : p,
                ),
              )
            } catch (err) {
              const message = err instanceof Error ? err.message : "Upload failed"
              setPending((current) => current.map((p) => (p.id === entry.id ? { ...p, error: message } : p)))
            }
          }),
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed"
        toast.error(message)
        setPending((current) => current.filter((p) => !entries.some((e) => e.id === p.id)))
      }
    },
    [conversationId, pending.length],
  )

  const submit = useCallback(async () => {
    if (!canSend) return
    setSending(true)
    try {
      const result = await onSend({
        body: body.trim() || null,
        attachments: pending
          .filter((p) => p.storagePath)
          .map((p) => ({
            storage_path: p.storagePath as string,
            original_filename: p.file.name,
            width: p.width ?? null,
            height: p.height ?? null,
            duration_seconds: p.duration ?? null,
          })),
      })

      if (!result.ok) {
        toast.error(result.error ?? "That message did not send.")
        return
      }
      setBody("")
      setPending([])
    } finally {
      setSending(false)
    }
  }, [body, canSend, onSend, pending])

  return (
    <div className="border-t border-border p-3">
      {pending.length > 0 && (
        <ul className="mb-2 space-y-1">
          {pending.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="max-w-[55%] truncate">{item.file.name}</span>
              {item.error ? (
                <span className="text-error">{item.error}</span>
              ) : (
                <span className="h-1 flex-1 overflow-hidden rounded bg-surface">
                  <span
                    className="block h-full bg-primary transition-all"
                    style={{ width: `${item.progress}%` }}
                    data-testid="upload-progress"
                  />
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${item.file.name}`}
                onClick={() => setPending((current) => current.filter((p) => p.id !== item.id))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(event) => {
            setBody(event.target.value)
            onTyping?.()
          }}
          onKeyDown={(event) => {
            // Enter alone inserts a newline; the modifier sends. A chat that
            // sends half-typed messages on Enter is worse than one extra key.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder="Write a message…"
          rows={2}
          disabled={disabled}
          className="min-h-[44px] resize-none"
          aria-label="Message"
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_MIME_TYPES.join(",")}
          className="hidden"
          data-testid="file-input"
          onChange={(event) => {
            if (event.target.files?.length) void addFiles(event.target.files)
            event.target.value = ""
          }}
        />

        <div className="flex items-center gap-1 pb-1">
          <button
            type="button"
            aria-label="Attach a photo or video"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <Paperclip className="size-4" strokeWidth={1.5} />
          </button>

          <EmojiPickerPopover label="Insert emoji" onPick={(emoji) => setBody((current) => current + emoji)} />

          <Button type="button" size="sm" onClick={() => void submit()} disabled={!canSend} className={cn("gap-1")}>
            <Send className="size-3.5" strokeWidth={1.5} />
            {uploading ? "Uploading…" : "Send"}
          </Button>
        </div>
      </div>

      <p className="mt-1 text-[10px] text-muted-foreground">⌘/Ctrl + Enter to send · photos and video up to 25 MB</p>
    </div>
  )
}

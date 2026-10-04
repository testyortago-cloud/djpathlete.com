"use client"
// One clip slot on a quiz question: pick a video, it goes straight to
// Firebase through a signed url (Vercel caps request bodies at 4.5 MB), a
// poster is grabbed in the browser, and the two DURABLE urls come back to the
// editor. Nothing is written to the quiz until the editor's own Save.

import { useState } from "react"
import { grabPosterFrame } from "@/lib/quizzes/poster-frame"

const WARN_BYTES = 25 * 1024 * 1024

async function upload(quizId: string, body: Blob, filename: string, contentType: string): Promise<string> {
  const res = await fetch(`/api/admin/quizzes/${quizId}/media-upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType }),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(json?.error ?? "Could not start the upload.")
  }
  const { uploadUrl, publicUrl } = (await res.json()) as { uploadUrl: string; publicUrl: string }
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body })
  if (!put.ok) throw new Error(`Upload failed (${put.status}). Try again.`)
  return publicUrl
}

export function QuizClipPicker({
  quizId,
  label,
  url,
  onChange,
}: {
  quizId: string
  label: string
  url: string | null
  onChange: (next: { url: string | null; posterUrl: string | null }) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  async function pick(file: File) {
    setError(null)
    setWarning(
      file.size > WARN_BYTES
        ? `This file is ${Math.round(file.size / 1048576)} MB. Visitors on phones will wait for it to load — a shorter clip is better.`
        : null,
    )
    setBusy(true)
    try {
      const contentType = file.type || "video/mp4"
      const clipUrl = await upload(quizId, file, file.name, contentType)
      const poster = await grabPosterFrame(file)
      const posterUrl = poster ? await upload(quizId, poster, `${file.name}-poster.jpg`, "image/jpeg") : null
      onChange({ url: clipUrl, posterUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-foreground">
        {label}
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          aria-label={label}
          disabled={busy}
          className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) void pick(file)
          }}
        />
      </label>
      {busy ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
      {warning ? <p className="text-xs text-warning">{warning}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      ) : null}
      {url ? (
        <div className="flex items-start gap-2">
          <video src={url} controls muted preload="metadata" className="h-24 rounded-md border border-border" />
          <button
            type="button"
            aria-label={`Remove ${label}`}
            className="text-xs text-muted-foreground underline"
            onClick={() => onChange({ url: null, posterUrl: null })}
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  )
}

"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Upload, FileVideo, X, CheckCircle2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { uploadToSignedUrl } from "@/lib/firebase-client-upload"
import { toast } from "sonner"

const ALLOWED_MIME = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
] as const
const ACCEPT_ATTR = ALLOWED_MIME.join(",")
const MAX_BYTES = 5 * 1024 * 1024 * 1024 // 5 GB

type Phase =
  | { kind: "idle" }
  | { kind: "previewing"; file: File }
  | { kind: "uploading"; file: File; percent: number; loaded: number }
  | { kind: "finalizing"; file: File }
  | { kind: "done"; file: File }
  | { kind: "error"; file?: File; message: string }

interface Props {
  submissionId: string
  /** Renders the alert ribbon copy ("Darren requested a revision."). */
  showRevisionBanner?: boolean
}

export function RevisionUploadZone({ submissionId, showRevisionBanner = true }: Props) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function pickFile(f: File) {
    if (!ALLOWED_MIME.includes(f.type as (typeof ALLOWED_MIME)[number])) {
      setPhase({
        kind: "error",
        file: f,
        message: `Unsupported format (${f.type || "unknown"}). Allowed: MP4, MOV, WebM, MKV.`,
      })
      return
    }
    if (f.size > MAX_BYTES) {
      setPhase({
        kind: "error",
        file: f,
        message: `File is ${formatBytes(f.size)}. Max is 5 GB.`,
      })
      return
    }
    setPhase({ kind: "previewing", file: f })
  }

  function reset() {
    setPhase({ kind: "idle" })
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function startUpload(file: File) {
    setPhase({ kind: "uploading", file, percent: 0, loaded: 0 })
    try {
      const verRes = await fetch(
        `/api/editor/submissions/${submissionId}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        },
      )
      if (!verRes.ok) {
        const json = await verRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Failed to create version")
      }
      const { upload } = await verRes.json()

      await uploadToSignedUrl(upload.uploadUrl, file, (e) => {
        setPhase({
          kind: "uploading",
          file,
          percent: e.percent,
          loaded: e.loaded,
        })
      })

      setPhase({ kind: "finalizing", file })
      const finRes = await fetch(
        `/api/editor/submissions/${submissionId}/finalize`,
        { method: "POST" },
      )
      if (!finRes.ok) {
        const json = await finRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Finalize failed")
      }

      setPhase({ kind: "done", file })
      toast.success("New version submitted")
      // Brief pause so the user sees the success state, then refresh
      setTimeout(() => {
        reset()
        router.refresh()
      }, 1200)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed"
      setPhase({ kind: "error", file, message })
      toast.error(message)
    }
  }

  // ---- Render ----

  return (
    <div className="space-y-3">
      {showRevisionBanner && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <AlertTriangle className="size-4 text-warning shrink-0" strokeWidth={1.5} />
          <p className="text-sm font-medium text-warning">
            Darren requested a revision. Upload a new version to address the open comments.
          </p>
        </div>
      )}

      {phase.kind === "idle" && (
        <DropZone
          dragOver={dragOver}
          onDragOver={() => setDragOver(true)}
          onDragLeave={() => setDragOver(false)}
          onDrop={(f) => {
            setDragOver(false)
            pickFile(f)
          }}
          onPick={() => fileInputRef.current?.click()}
        />
      )}

      {phase.kind === "previewing" && (
        <FilePreviewCard
          file={phase.file}
          actionLabel="Confirm upload"
          actionTone="primary"
          onAction={() => startUpload(phase.file)}
          onSecondary={reset}
          secondaryLabel="Choose a different file"
        />
      )}

      {(phase.kind === "uploading" || phase.kind === "finalizing") && (
        <UploadProgressCard
          file={phase.file}
          percent={phase.kind === "uploading" ? phase.percent : 100}
          loaded={phase.kind === "uploading" ? phase.loaded : phase.file.size}
          finalizing={phase.kind === "finalizing"}
        />
      )}

      {phase.kind === "done" && (
        <SuccessCard file={phase.file} />
      )}

      {phase.kind === "error" && (
        <ErrorCard
          file={phase.file}
          message={phase.message}
          onRetry={phase.file ? () => startUpload(phase.file!) : undefined}
          onReset={reset}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) pickFile(f)
        }}
      />
    </div>
  )
}

// ---- Sub-pieces ----

function DropZone({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onPick,
}: {
  dragOver: boolean
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: (file: File) => void
  onPick: () => void
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        onDragLeave()
      }}
      onDrop={(e) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (file) onDrop(file)
      }}
      onClick={onPick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onPick()
        }
      }}
      className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 text-center transition-colors ${
        dragOver
          ? "border-accent bg-accent/10"
          : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/30"
      }`}
      aria-label="Drop a video file here, or click to browse"
    >
      <Upload
        className={`size-7 transition-colors ${
          dragOver ? "text-accent" : "text-muted-foreground group-hover:text-primary"
        }`}
        strokeWidth={1.5}
      />
      <p className="font-body text-sm text-primary">
        {dragOver ? "Drop to begin upload" : "Drag a video here, or click to browse"}
      </p>
      <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
        MP4 · MOV · WebM · MKV · up to 5 GB
      </p>
    </div>
  )
}

function FilePreviewCard({
  file,
  actionLabel,
  actionTone,
  onAction,
  onSecondary,
  secondaryLabel,
}: {
  file: File
  actionLabel: string
  actionTone: "primary"
  onAction: () => void
  onSecondary: () => void
  secondaryLabel: string
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center gap-3">
        <FileVideoBadge />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-primary" title={file.name}>
            {file.name}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {formatBytes(file.size)} · {file.type || "video"}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onSecondary}
          aria-label={secondaryLabel}
          title={secondaryLabel}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onSecondary}>
          {secondaryLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onAction}
          className={actionTone === "primary" ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}
        >
          <Upload className="mr-1.5 size-4" />
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

function UploadProgressCard({
  file,
  percent,
  loaded,
  finalizing,
}: {
  file: File
  percent: number
  loaded: number
  finalizing: boolean
}) {
  const stage = finalizing ? "Finalizing on server…" : "Uploading"
  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <FileVideoBadge spinning />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-primary" title={file.name}>
            {file.name}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {stage} · {formatBytes(loaded)} / {formatBytes(file.size)}
          </p>
        </div>
        <div className="font-mono text-base text-primary tabular-nums">
          {percent}%
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/10 ring-1 ring-inset ring-primary/10">
        <div
          className={`h-full rounded-full bg-accent transition-[width] duration-200 ${finalizing ? "animate-pulse" : ""}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function SuccessCard({ file }: { file: File }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-success/30 bg-success/10 p-4">
      <CheckCircle2 className="size-5 text-success shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-success">New version submitted</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={file.name}>
          {file.name} · {formatBytes(file.size)}
        </p>
      </div>
    </div>
  )
}

function ErrorCard({
  file,
  message,
  onRetry,
  onReset,
}: {
  file?: File
  message: string
  onRetry?: () => void
  onReset: () => void
}) {
  return (
    <div className="space-y-3 rounded-md border border-error/30 bg-error/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 text-error shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-error">Upload failed</p>
          <p className="text-xs text-muted-foreground">{message}</p>
          {file && (
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={file.name}>
              {file.name}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onReset}>
          Pick a different file
        </Button>
        {onRetry && (
          <Button type="button" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}

function FileVideoBadge({ spinning }: { spinning?: boolean }) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
      <FileVideo className={`size-4 ${spinning ? "animate-pulse" : ""}`} strokeWidth={1.5} />
    </div>
  )
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

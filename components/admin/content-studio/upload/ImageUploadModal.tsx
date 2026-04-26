"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, UploadCloud, X, AlertCircle, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { uploadImageFile } from "@/lib/firebase-client-upload"

const MAX_BYTES = 25 * 1024 * 1024
const MAX_MB = MAX_BYTES / 1024 / 1024
const ACCEPT = "image/jpeg,image/png,image/webp"

interface ImageUploadModalProps {
  open: boolean
  onClose: () => void
}

type ItemStatus = "queued" | "uploading" | "done" | "error"

interface UploadItem {
  id: string
  file: File
  previewUrl: string
  status: ItemStatus
  percent: number
  error: string | null
}

let itemSeq = 0
function nextItemId() {
  itemSeq += 1
  return `upload-${itemSeq}`
}

function validate(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Not an image file."
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return "Only JPG, PNG, or WebP."
  if (file.size > MAX_BYTES) return `Exceeds ${MAX_MB} MB.`
  return null
}

function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`
}

export function ImageUploadModal({ open, onClose }: ImageUploadModalProps) {
  const router = useRouter()
  const [items, setItems] = useState<UploadItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const seenKeysRef = useRef<Set<string>>(new Set())

  const doneCount = items.filter((i) => i.status === "done").length
  const activeCount = items.filter((i) => i.status === "uploading" || i.status === "queued").length

  useEffect(() => {
    if (!open) return
    return () => {
      items.forEach((i) => URL.revokeObjectURL(i.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const uploadOne = useCallback(async (itemId: string, file: File) => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status: "uploading", percent: 0 } : i)),
    )
    try {
      await uploadImageFile(file, {
        onProgress: (e) => {
          setItems((prev) =>
            prev.map((i) => (i.id === itemId ? { ...i, percent: e.percent } : i)),
          )
        },
      })
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, status: "done", percent: 100, error: null } : i,
        ),
      )
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? { ...i, status: "error", error: (err as Error).message || "Upload failed" }
            : i,
        ),
      )
    }
  }, [])

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files)
      if (arr.length === 0) return
      const newItems: UploadItem[] = []
      for (const file of arr) {
        const key = fileKey(file)
        if (seenKeysRef.current.has(key)) continue
        seenKeysRef.current.add(key)
        const validationError = validate(file)
        newItems.push({
          id: nextItemId(),
          file,
          previewUrl: URL.createObjectURL(file),
          status: validationError ? "error" : "queued",
          percent: 0,
          error: validationError,
        })
      }
      if (newItems.length === 0) return
      setItems((prev) => [...prev, ...newItems])
      newItems.forEach((item) => {
        if (item.status === "queued") void uploadOne(item.id, item.file)
      })
    },
    [uploadOne],
  )

  function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) {
      addFiles(event.target.files)
    }
    event.target.value = ""
  }

  function onDragEnter(event: React.DragEvent) {
    event.preventDefault()
    dragDepthRef.current += 1
    if (event.dataTransfer?.types.includes("Files")) {
      setIsDragOver(true)
    }
  }

  function onDragLeave(event: React.DragEvent) {
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragOver(false)
  }

  function onDragOver(event: React.DragEvent) {
    event.preventDefault()
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragOver(false)
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files)
    }
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id)
      if (target) {
        URL.revokeObjectURL(target.previewUrl)
        seenKeysRef.current.delete(fileKey(target.file))
      }
      return prev.filter((i) => i.id !== id)
    })
  }

  function retryItem(id: string) {
    const target = items.find((i) => i.id === id)
    if (!target) return
    const validationError = validate(target.file)
    if (validationError) {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, error: validationError } : i)),
      )
      return
    }
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "queued", error: null, percent: 0 } : i)),
    )
    void uploadOne(id, target.file)
  }

  function close() {
    if (activeCount > 0) {
      if (!confirm("Uploads still in progress. Close anyway?")) return
    }
    items.forEach((i) => URL.revokeObjectURL(i.previewUrl))
    seenKeysRef.current.clear()
    if (doneCount > 0) router.refresh()
    setItems([])
    onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={close}
    >
      <div
        className="relative w-full max-w-2xl bg-white rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <h3 className="font-heading text-base text-primary">Upload images</h3>
            <p className="text-xs text-muted-foreground">
              Add JPG, PNG, or WebP images to your library (up to {MAX_MB} MB each).
            </p>
          </div>
          <button
            type="button"
            aria-label="Close upload dialog"
            onClick={close}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Drop images here or click to browse"
            className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 cursor-pointer transition-colors ${
              isDragOver
                ? "border-primary bg-primary/5"
                : "border-border bg-surface/30 hover:border-primary/60 hover:bg-surface/60"
            }`}
          >
            <div
              className={`flex size-12 items-center justify-center rounded-full transition-colors ${
                isDragOver ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
              }`}
            >
              <UploadCloud className="size-6" />
            </div>
            <p className="text-sm font-medium text-primary">
              {isDragOver ? "Drop to upload" : "Drag images here or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">
              You can select multiple files · JPG, PNG, WebP · max {MAX_MB} MB each
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={onInputChange}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {items.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {items.length} {items.length === 1 ? "file" : "files"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {doneCount} done
                  {activeCount > 0 ? ` · ${activeCount} uploading` : ""}
                </p>
              </div>
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="relative group rounded-lg border border-border bg-white overflow-hidden"
                  >
                    <div className="relative aspect-square bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.previewUrl}
                        alt={item.file.name}
                        draggable={false}
                        className="absolute inset-0 size-full object-cover"
                      />
                      {item.status === "uploading" ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Loader2 className="size-6 text-white animate-spin" />
                        </div>
                      ) : null}
                      {item.status === "done" ? (
                        <div className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-success/90 text-white shadow">
                          <Check className="size-3.5" strokeWidth={3} />
                        </div>
                      ) : null}
                      {item.status === "error" ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-error/80 text-white p-2 text-center">
                          <AlertCircle className="size-5" />
                          <p className="text-[10px] leading-tight line-clamp-3">{item.error}</p>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeItem(item.id)
                        }}
                        aria-label={`Remove ${item.file.name}`}
                        className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                      >
                        <X className="size-3" strokeWidth={2.5} />
                      </button>
                    </div>
                    {item.status === "uploading" ? (
                      <div className="h-1 w-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    ) : (
                      <div className="h-1 w-full" />
                    )}
                    <div className="px-2 py-1.5 flex items-center justify-between gap-2">
                      <p
                        className="text-[11px] text-muted-foreground truncate flex-1"
                        title={item.file.name}
                      >
                        {item.file.name}
                      </p>
                      {item.status === "error" ? (
                        <button
                          type="button"
                          onClick={() => retryItem(item.id)}
                          className="text-[10px] font-medium text-primary hover:underline"
                        >
                          Retry
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border bg-surface/30">
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <p>
              For a carousel post, open <span className="font-medium">Calendar</span> → click a day
              → choose <span className="font-medium">Carousel</span>.
            </p>
            <p className="text-muted-foreground/80">
              Instagram caps published photos at 8 MB — larger originals stay in your library but
              may need resizing before posting there.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={activeCount > 0}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {activeCount > 0
              ? `Uploading… (${doneCount}/${items.length})`
              : doneCount > 0
                ? `Done · ${doneCount} added`
                : "Done"}
          </button>
        </footer>
      </div>
    </div>
  )
}

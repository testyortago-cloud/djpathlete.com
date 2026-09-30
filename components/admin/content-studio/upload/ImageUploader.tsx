"use client"

import { useState } from "react"
import { FolderOpen, Upload, X } from "lucide-react"
import { uploadImageFile } from "@/lib/firebase-client-upload"
import { AssetPickerModal, type PickedAsset } from "./AssetPickerModal"

const MAX_BYTES = 25 * 1024 * 1024

export interface ImageUploadedEvent {
  mediaAssetId: string
  storagePath: string
  kind: "image" | "video"
  /** Local object URL for playing a chosen video back; video only. The receiver revokes it. */
  previewUrl?: string
}

interface ImageUploaderProps {
  onUploaded: (event: ImageUploadedEvent) => void
  excludeIds?: string[]
  /** Lets the slot take an MP4 or MOV as well as a photo. Off by default. */
  allowVideo?: boolean
}

const VIDEO_TYPES = ["video/mp4", "video/quicktime"]

export function ImageUploader({ onUploaded, excludeIds, allowVideo = false }: ImageUploaderProps) {
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [source, setSource] = useState<"upload" | "library" | null>(null)

  async function handleFile(file: File) {
    setError(null)
    const isVideo = allowVideo && file.type.startsWith("video/")
    if (isVideo && !VIDEO_TYPES.includes(file.type)) {
      setError("Videos must be MP4 or MOV.")
      return
    }
    if (!isVideo && !file.type.startsWith("image/")) {
      setError("File must be an image (JPG, PNG, WebP).")
      return
    }
    if (!isVideo && file.size > MAX_BYTES) {
      setError(`Image exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit.`)
      return
    }
    setFileName(file.name)
    setSource("upload")
    setPercent(0)
    try {
      const result = await uploadImageFile(file, {
        onProgress: (e) => setPercent(e.percent),
      })
      setPercent(100)
      if (isVideo) {
        onUploaded({ ...result, kind: "video", previewUrl: URL.createObjectURL(file) })
      } else {
        onUploaded({ ...result, kind: "image" })
      }
    } catch (err) {
      setError((err as Error).message || "Upload failed")
      setPercent(null)
    }
  }

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) handleFile(file)
  }

  function handlePicked(asset: PickedAsset) {
    setError(null)
    setFileName(asset.filename)
    setSource("library")
    setPercent(100)
    onUploaded({ mediaAssetId: asset.id, storagePath: asset.filename, kind: "image" })
  }

  const filled = fileName !== null && percent === 100

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="flex-1 inline-flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-white hover:bg-surface/50 cursor-pointer text-sm">
          <Upload className="size-3.5" />
          <span className="text-sm">{filled && source === "upload"
              ? allowVideo
                ? "Replace"
                : "Replace photo"
              : allowVideo
                ? "Upload photo or video"
                : "Upload photo"}</span>
          <input
            type="file"
            accept={
              allowVideo
                ? "image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                : "image/jpeg,image/png,image/webp"
            }
            className="hidden"
            onChange={onChange}
            onClick={(e) => e.stopPropagation()}
          />
        </label>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-sm bg-white hover:bg-surface/50"
        >
          <FolderOpen className="size-3.5" /> Library
        </button>
      </div>

      {fileName ? (
        <p className="text-xs text-muted-foreground">
          {source === "library" ? "From library: " : ""}
          {fileName}
        </p>
      ) : null}
      {percent !== null && percent < 100 ? (
        <div className="h-1 w-full bg-muted rounded overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-error">
          <X className="size-3" /> {error}
        </p>
      ) : null}

      <AssetPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePicked}
        excludeIds={excludeIds}
        title="Pick photo from library"
      />
    </div>
  )
}

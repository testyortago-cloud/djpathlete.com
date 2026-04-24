"use client"

import { useState } from "react"
import { Upload, X } from "lucide-react"
import { uploadImageFile } from "@/lib/firebase-client-upload"

const MAX_BYTES = 8 * 1024 * 1024

export interface ImageUploadedEvent {
  mediaAssetId: string
  storagePath: string
}

interface ImageUploaderProps {
  onUploaded: (event: ImageUploadedEvent) => void
}

export function ImageUploader({ onUploaded }: ImageUploaderProps) {
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    if (!file.type.startsWith("image/")) {
      setError("File must be an image (JPG, PNG, WebP).")
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`Image exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit.`)
      return
    }
    setFileName(file.name)
    setPercent(0)
    try {
      const result = await uploadImageFile(file, {
        onProgress: (e) => setPercent(e.percent),
      })
      setPercent(100)
      onUploaded(result)
    } catch (err) {
      setError((err as Error).message || "Upload failed")
      setPercent(null)
    }
  }

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <Upload className="size-4" />
        <span className="text-sm">Photo</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onChange}
        />
      </label>
      {fileName ? <p className="text-xs text-muted-foreground">{fileName}</p> : null}
      {percent !== null ? (
        <div className="h-1 w-full bg-muted rounded overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-error">
          <X className="size-3" /> {error}
        </p>
      ) : null}
    </div>
  )
}

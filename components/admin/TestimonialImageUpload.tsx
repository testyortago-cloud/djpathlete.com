"use client"

import { useState } from "react"
import Image from "next/image"
import { Upload, X } from "lucide-react"

interface TestimonialImageUploadProps {
  value: string | null
  onChange: (url: string | null) => void
}

export function TestimonialImageUpload({ value, onChange }: TestimonialImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/upload/testimonial-image", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Upload failed")
      onChange(data.url)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {value ? (
        <div className="relative">
          <Image
            src={value}
            alt="Testimonial photo"
            width={56}
            height={56}
            className="size-14 rounded-full object-cover"
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -top-1 -right-1 rounded-full border bg-background p-0.5 shadow"
            aria-label="Remove photo"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <div className="flex size-14 items-center justify-center rounded-full border border-dashed border-border bg-surface text-muted-foreground">
          <Upload className="size-4" />
        </div>
      )}
      <label className="cursor-pointer text-sm text-primary hover:underline">
        {uploading ? "Uploading..." : value ? "Change photo" : "Upload photo"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
          disabled={uploading}
        />
      </label>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

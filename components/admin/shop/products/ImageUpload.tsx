"use client"

import { useRef, useState } from "react"
import { Upload, Loader2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface ImageUploadProps {
  onUploaded: (url: string) => void
  label?: string
  className?: string
}

export function ImageUpload({ onUploaded, label = "Upload image", className }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch("/api/uploads/shop", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Upload failed (${res.status})`)
      }

      const { url } = await res.json()
      onUploaded(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setLoading(false)
      // Reset so the same file can be re-uploaded if needed
      e.target.value = ""
    }
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border",
          "bg-surface hover:bg-surface/80 text-foreground transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Upload className="size-3.5" />
        )}
        {loading ? "Uploading…" : label}
      </button>

      {error && (
        <p className="flex items-center gap-1 text-xs text-error">
          <AlertCircle className="size-3.5 shrink-0" />
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}

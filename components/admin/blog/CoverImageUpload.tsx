"use client"

import { useRef, useState } from "react"
import NextImage from "next/image"
import { ImagePlus, X, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface CoverImageUploadProps {
  currentUrl?: string | null
  postId?: string
  onUploaded: (url: string | null) => void
}

export function CoverImageUpload({ currentUrl, postId, onUploaded }: CoverImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB")
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("type", "cover")
      if (postId) formData.append("postId", postId)

      const res = await fetch("/api/upload/blog-image", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? "Upload failed")
      }

      const { url } = await res.json()
      onUploaded(url)
      toast.success("Cover image uploaded")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  if (currentUrl) {
    return (
      <div className="relative aspect-[16/9] rounded-lg overflow-hidden border border-border">
        <NextImage src={currentUrl} alt="Cover image" fill className="object-cover" />
        <button
          type="button"
          onClick={() => onUploaded(null)}
          className="absolute top-2 right-2 p-1 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full aspect-[16/9] rounded-lg border-2 border-dashed border-border hover:border-primary/40 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {uploading ? (
          <Loader2 className="size-6 animate-spin" />
        ) : (
          <>
            <ImagePlus className="size-6" />
            <span className="text-xs">Upload cover image</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ""
        }}
      />
    </>
  )
}

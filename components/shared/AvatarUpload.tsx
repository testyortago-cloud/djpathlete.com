"use client"

import { useState, useRef, useCallback } from "react"
import { Camera, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"

interface AvatarUploadProps {
  /** Current avatar URL (if any) */
  currentUrl?: string | null
  /** User ID to upload for */
  userId: string
  /** Initials to show as fallback */
  initials: string
  /** Called after a successful upload with the new URL */
  onUploaded?: (url: string | null) => void
  /** Disable interactions */
  disabled?: boolean
}

const MAX_SIZE = 2 * 1024 * 1024 // 2 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export function AvatarUpload({ currentUrl, userId, initials, onUploaded, disabled }: AvatarUploadProps) {
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null)
  const [isUploading, setIsUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast.error("Invalid file type. Use JPEG, PNG, WebP, or GIF.")
        return
      }
      if (file.size > MAX_SIZE) {
        toast.error("File too large. Maximum size is 2 MB.")
        return
      }

      setIsUploading(true)
      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("userId", userId)

        const res = await fetch("/api/upload/avatar", {
          method: "POST",
          body: formData,
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Upload failed")
        }

        const { url } = await res.json()
        setPreview(url)
        onUploaded?.(url)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed")
      } finally {
        setIsUploading(false)
      }
    },
    [userId, onUploaded],
  )

  async function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    setIsUploading(true)
    try {
      const res = await fetch("/api/upload/avatar", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to remove")
      }

      setPreview(null)
      onUploaded?.(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove avatar")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative group cursor-pointer"
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
      >
        <Avatar className="size-16">
          {preview && <AvatarImage src={preview} alt="Avatar" />}
          <AvatarFallback className="bg-primary/10 text-primary text-lg font-medium">{initials}</AvatarFallback>
        </Avatar>

        {/* Overlay */}
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          {isUploading ? (
            <Loader2 className="size-5 text-white animate-spin" />
          ) : (
            <Camera className="size-5 text-white" />
          )}
        </div>

        {/* Remove button */}
        {preview && !isUploading && !disabled && (
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-1 -right-1 flex items-center justify-center size-5 rounded-full bg-destructive text-white shadow-sm hover:bg-destructive/90 transition-colors"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">Click to upload photo</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        disabled={disabled || isUploading}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = "" // allow re-selecting same file
        }}
      />
    </div>
  )
}

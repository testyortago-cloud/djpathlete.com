"use client"

import { useState, useRef, useCallback } from "react"
import Image from "next/image"
import { ImagePlus, Loader2, X } from "lucide-react"
import { toast } from "sonner"

const MAX_SIZE = 8 * 1024 * 1024 // 8 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

/**
 * Cover photo for the client's public test report. Admin-only surface — the
 * route rejects non-admins too, so this is convenience, not the access control.
 */
export function ReportPhotoUpload({
  clientUserId,
  currentUrl,
  clientName,
}: {
  clientUserId: string
  currentUrl: string | null
  clientName: string
}) {
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const [isUploading, setIsUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const first = clientName.split(" ")[0] || "this client"

  const handleFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast.error("Invalid file type. Use JPEG, PNG, or WebP.")
        return
      }
      if (file.size > MAX_SIZE) {
        toast.error("File too large. Maximum size is 8 MB.")
        return
      }
      setIsUploading(true)
      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("userId", clientUserId)
        const res = await fetch("/api/upload/report-photo", { method: "POST", body: formData })
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error || "Upload failed")
        const { url } = (await res.json()) as { url: string }
        setPreview(url)
        toast.success("Report photo updated")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed")
      } finally {
        setIsUploading(false)
      }
    },
    [clientUserId],
  )

  async function handleRemove() {
    setIsUploading(true)
    try {
      const res = await fetch("/api/upload/report-photo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: clientUserId }),
      })
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error || "Failed to remove")
      setPreview(null)
      toast.success("Report photo removed")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove photo")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="w-full rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-foreground">Report cover photo</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Shown on {first}&apos;s test report. Portrait action shots work best. Falls back to their avatar.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => !isUploading && inputRef.current?.click()}
          disabled={isUploading}
          className="relative flex h-24 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-surface/50 transition-colors hover:bg-surface disabled:opacity-60"
          aria-label="Upload report cover photo"
        >
          {preview ? (
            <Image src={preview} alt={`${first} report cover`} fill unoptimized className="object-cover" />
          ) : isUploading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <ImagePlus className="size-4 text-muted-foreground" />
          )}
          {preview && isUploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="size-4 animate-spin text-white" />
            </span>
          )}
        </button>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => !isUploading && inputRef.current?.click()}
            disabled={isUploading}
            className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
          >
            {preview ? "Replace photo" : "Upload photo"}
          </button>
          {preview && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isUploading}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <X className="size-3" />
              Remove
            </button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={isUploading}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = "" // allow re-selecting the same file
        }}
      />
    </div>
  )
}

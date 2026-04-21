"use client"

import { useState } from "react"
import { Upload, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { VideoUploader } from "@/components/admin/videos/VideoUploader"

export function UploadModal() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
      >
        <Upload className="size-4" /> Upload Video
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="relative w-full max-w-xl bg-white rounded-lg shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-heading text-sm text-primary">Upload video</h3>
              <button
                type="button"
                aria-label="Close upload dialog"
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="p-4">
              <VideoUploader
                onUploaded={() => {
                  setOpen(false)
                  router.refresh()
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

"use client"

import { useState } from "react"
import { ChevronDown, Film, Image as ImageIcon, Upload, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { VideoUploader } from "@/components/admin/videos/VideoUploader"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ImageUploadModal } from "./ImageUploadModal"

type Mode = "video" | "image" | null

export function UploadModal() {
  const [mode, setMode] = useState<Mode>(null)
  const router = useRouter()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <Upload className="size-4" /> Upload
            <ChevronDown className="size-3.5 opacity-80" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setMode("video")}>
            <Film className="size-4" /> Video
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode("image")}>
            <ImageIcon className="size-4" /> Image
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {mode === "video" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setMode(null)}
        >
          <div
            className="relative w-full max-w-xl bg-white rounded-lg shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-heading text-sm text-primary">Upload video</h3>
              <button
                type="button"
                aria-label="Close upload dialog"
                onClick={() => setMode(null)}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="p-4">
              <VideoUploader
                onUploaded={() => {
                  setMode(null)
                  router.refresh()
                }}
              />
            </div>
          </div>
        </div>
      )}

      <ImageUploadModal open={mode === "image"} onClose={() => setMode(null)} />
    </>
  )
}

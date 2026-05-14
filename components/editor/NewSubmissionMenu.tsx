"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, FileVideo, Image as ImageIcon, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PhotoSubmitDialog } from "@/components/editor/PhotoSubmitDialog"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"

export function NewSubmissionMenu() {
  const [open, setOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const photosEnabled = isTeamImagesEnabled()

  if (!photosEnabled) {
    return (
      <Button asChild size="sm" variant="secondary" className="bg-accent text-accent-foreground hover:bg-accent/90">
        <Link href="/editor/upload">
          <Upload className="mr-1.5 size-4" />
          Start upload
        </Link>
      </Button>
    )
  }

  return (
    <>
      <div className="relative">
        <Button
          size="sm"
          variant="secondary"
          className="bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={() => setOpen((v) => !v)}
        >
          <Upload className="mr-1.5 size-4" />
          New submission
          <ChevronDown className="ml-1 size-4" />
        </Button>
        {open && (
          <div className="absolute right-0 mt-2 w-56 rounded-md border bg-card shadow-md z-50">
            <Link
              href="/editor/upload"
              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40"
              onClick={() => setOpen(false)}
            >
              <FileVideo className="size-4" /> Video
            </Link>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 text-left"
              onClick={() => {
                setOpen(false)
                setDialogOpen(true)
              }}
            >
              <ImageIcon className="size-4" /> Photos
            </button>
          </div>
        )}
      </div>
      <PhotoSubmitDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  )
}

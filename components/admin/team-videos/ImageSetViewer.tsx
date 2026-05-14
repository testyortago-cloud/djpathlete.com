"use client"

import { useEffect } from "react"

export interface ViewerImage {
  id: string
  position: number
  signedUrl: string
  originalFilename: string
}

interface Props {
  images: ViewerImage[]
  activeIndex: number
  onActiveIndexChange: (next: number) => void
}

export function ImageSetViewer({ images, activeIndex, onActiveIndexChange }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        if (activeIndex < images.length - 1) onActiveIndexChange(activeIndex + 1)
      } else if (e.key === "ArrowLeft") {
        if (activeIndex > 0) onActiveIndexChange(activeIndex - 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeIndex, images.length, onActiveIndexChange])

  if (images.length === 0) {
    return (
      <div className="aspect-video rounded-md border bg-muted/30 grid place-items-center text-sm text-muted-foreground">
        No images on this version.
      </div>
    )
  }

  const active = images[activeIndex] ?? images[0]

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.signedUrl}
          alt={active.originalFilename}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
        />
        <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-mono tracking-wide text-white">
          {activeIndex + 1} of {images.length}
        </div>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {images.map((img, idx) => (
          <li key={img.id}>
            <button
              type="button"
              onClick={() => onActiveIndexChange(idx)}
              aria-label={`Go to image ${idx + 1}`}
              className={`size-16 shrink-0 overflow-hidden rounded-md border transition ${
                idx === activeIndex ? "border-accent ring-2 ring-accent" : "border-border opacity-80 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.signedUrl} alt="" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

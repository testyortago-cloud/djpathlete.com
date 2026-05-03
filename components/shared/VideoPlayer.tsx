"use client"

import { cn } from "@/lib/utils"

interface VideoPlayerProps {
  src: string
  className?: string
}

export function VideoPlayer({ src, className }: VideoPlayerProps) {
  return (
    <div className={cn("relative w-full rounded-xl overflow-hidden bg-black", className)}>
      <video src={src} controls playsInline preload="metadata" className="w-full max-h-[500px] object-contain">
        Your browser does not support the video tag.
      </video>
    </div>
  )
}

"use client"

import { cn } from "@/lib/utils"

interface YouTubeEmbedProps {
  url: string
  className?: string
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

export function YouTubeEmbed({ url, className }: YouTubeEmbedProps) {
  const videoId = extractVideoId(url)

  if (!videoId) {
    return (
      <div className={cn("rounded-xl bg-muted p-4 text-center text-sm text-muted-foreground", className)}>
        Invalid YouTube URL
      </div>
    )
  }

  return (
    <div className={cn("relative w-full rounded-xl overflow-hidden bg-black aspect-video", className)}>
      <iframe
        src={`https://www.youtube.com/embed/${videoId}`}
        title="YouTube video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full"
      />
    </div>
  )
}

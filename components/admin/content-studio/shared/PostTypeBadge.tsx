import { Film, Image as ImageIcon, Images } from "lucide-react"
import type { PostType } from "@/types/database"

interface PostTypeBadgeProps {
  postType: PostType
  className?: string
}

export function PostTypeBadge({ postType, className = "" }: PostTypeBadgeProps) {
  const base = "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent"
  if (postType === "image") {
    return (
      <span className={`${base} ${className}`.trim()}>
        <ImageIcon className="size-3" /> Photo
      </span>
    )
  }
  if (postType === "video") {
    return (
      <span className={`${base} ${className}`.trim()}>
        <Film className="size-3" /> Video
      </span>
    )
  }
  if (postType === "carousel") {
    return (
      <span className={`${base} ${className}`.trim()}>
        <Images className="size-3" /> Carousel
      </span>
    )
  }
  return null
}

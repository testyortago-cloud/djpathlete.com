"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useDraggable } from "@dnd-kit/core"
import { FileText, Mail, Lightbulb, Instagram, AlertCircle, Zap, ExternalLink, Film } from "lucide-react"
import { toast } from "sonner"
import type { CalendarChip } from "@/lib/content-studio/calendar-chips"
import type { SocialPlatform, CalendarEntryType } from "@/types/database"
import { PLATFORM_ICONS } from "@/lib/social/platform-ui"
import { cn } from "@/lib/utils"
import { PostTypeBadge } from "@/components/admin/content-studio/shared/PostTypeBadge"

function destinationFor(chip: CalendarChip): string {
  if (chip.kind === "post") return `/admin/content/post/${chip.id}`
  const refId = chip.raw.reference_id
  switch (chip.platformOrType) {
    case "blog_post":
      return refId ? `/admin/blog/${refId}/edit` : "/admin/blog"
    case "newsletter":
      return refId ? `/admin/newsletter/${refId}/edit` : "/admin/newsletter"
    case "topic_suggestion":
      return "/admin/topic-suggestions"
    default:
      return "/admin/content"
  }
}

const ENTRY_ICONS: Record<CalendarEntryType, typeof FileText> = {
  social_post: Instagram,
  blog_post: FileText,
  newsletter: Mail,
  topic_suggestion: Lightbulb,
}

// Platform brand hex codes — the one exception to the "no hardcoded hex"
// rule in CLAUDE.md because they denote external brands, not our theme.
const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  instagram: "bg-[#C13584]/10 text-[#C13584] border-[#C13584]/30",
  tiktok: "bg-black/10 text-black border-black/30",
  youtube: "bg-[#FF0000]/10 text-[#FF0000] border-[#FF0000]/30",
  youtube_shorts: "bg-[#FF0000]/10 text-[#FF0000] border-[#FF0000]/30",
  facebook: "bg-[#1877F2]/10 text-[#1877F2] border-[#1877F2]/30",
  linkedin: "bg-[#0A66C2]/10 text-[#0A66C2] border-[#0A66C2]/30",
}

interface PostChipProps {
  chip: CalendarChip
}

export function PostChip({ chip }: PostChipProps) {
  const router = useRouter()
  const [hovered, setHovered] = useState(false)
  const isLocked = chip.status === "published"
  const isFailed = chip.kind === "post" && chip.status === "failed"
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip-${chip.kind}-${chip.id}`,
    data: { chip },
    disabled: isLocked,
  })

  const Icon = chip.kind === "post" ? PLATFORM_ICONS[chip.platformOrType] : ENTRY_ICONS[chip.platformOrType]

  const colorClasses =
    chip.kind === "post" ? PLATFORM_COLORS[chip.platformOrType] : "bg-accent/10 text-accent border-accent/30"

  const drawerHref = destinationFor(chip)

  function handleClick(event: React.MouseEvent) {
    // Don't navigate if the click originated inside the hover tooltip
    // (which has its own Open/Retry buttons).
    if ((event.target as HTMLElement).closest("[role='tooltip']")) return
    if (isDragging) return
    if (event.metaKey || event.ctrlKey || event.shiftKey) return // let default link-open modifiers work elsewhere
    event.stopPropagation()
    router.push(drawerHref)
  }

  async function retry() {
    if (chip.kind !== "post") return
    try {
      const res = await fetch(`/api/admin/social/posts/${chip.id}/publish-now`, {
        method: "POST",
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Requeued for publishing")
    } catch (err) {
      toast.error((err as Error).message || "Retry failed")
    }
  }

  const ariaLabel =
    chip.status === "published"
      ? `Published ${chip.label}`
      : chip.status === "failed"
        ? `Failed ${chip.label}`
        : `Scheduled ${chip.label}`

  return (
    <div
      ref={setNodeRef}
      {...(isLocked ? {} : attributes)}
      {...(isLocked ? {} : listeners)}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          router.push(drawerHref)
        }
      }}
      className={cn(
        "relative rounded border px-1.5 py-1 text-[11px] truncate inline-flex items-center gap-1 cursor-pointer",
        colorClasses,
        !isLocked && "hover:brightness-95",
        isDragging && "opacity-40",
        isLocked && "opacity-70",
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{chip.label}</span>
      {isFailed && <AlertCircle className="size-3 shrink-0 text-error" />}
      {chip.kind === "post" && chip.sourceVideoId && <Film className="size-3 shrink-0 opacity-70" />}

      {hovered && (
        <div
          role="tooltip"
          className="absolute left-0 top-full mt-1 z-30 w-72 rounded-lg border border-border bg-white shadow-lg p-3 text-left cursor-auto"
        >
          <p className="text-xs font-semibold text-primary flex items-center gap-2">
            <Icon className="size-3.5" />
            {chip.platformOrType.replace("_", " ")}
            {chip.kind === "post" && <PostTypeBadge postType={chip.raw.post_type} />}
            <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">{chip.status}</span>
          </p>
          <p className="mt-2 text-sm text-primary line-clamp-4 break-words">
            {chip.kind === "post" ? chip.raw.content : chip.raw.title}
          </p>
          {chip.kind === "post" && chip.sourceVideoFilename && (
            <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Film className="size-3" />
              {chip.sourceVideoFilename}
            </p>
          )}
          {isFailed && chip.kind === "post" && chip.rejection_notes && (
            <p className="mt-2 text-[11px] text-error">{chip.rejection_notes}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Link
              href={drawerHref}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary/5 text-primary hover:bg-primary/10"
            >
              <ExternalLink className="size-3" /> Open
            </Link>
            {isFailed && (
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Zap className="size-3" /> Retry
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

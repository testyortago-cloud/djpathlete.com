"use client"

import { useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/lib/social/platform-ui"

type CarouselPlatform = "facebook" | "instagram" | "linkedin"

const PLATFORMS: CarouselPlatform[] = ["instagram", "facebook", "linkedin"]

interface GenerateQuoteCardsButtonProps {
  videoUploadId: string
  hasTranscript: boolean
  count?: number
}

export function GenerateQuoteCardsButton({
  videoUploadId,
  hasTranscript,
  count,
}: GenerateQuoteCardsButtonProps) {
  const router = useRouter()
  const [busyPlatform, setBusyPlatform] = useState<CarouselPlatform | null>(null)
  const busy = busyPlatform !== null
  const disabled = busy || !hasTranscript

  async function generate(platform: CarouselPlatform) {
    setBusyPlatform(platform)
    try {
      const res = await fetch("/api/admin/content-studio/quote-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId, count, platform }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Request failed (${res.status})`)
      }
      const data = (await res.json()) as { postId: string; mediaAssetIds: string[] }
      toast.success(`Draft carousel created with ${data.mediaAssetIds.length} quote cards`)
      router.push(`/admin/content/post/${data.postId}`)
    } catch (err) {
      toast.error((err as Error).message || "Failed to generate quote cards")
    } finally {
      setBusyPlatform(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={
            !hasTranscript
              ? "Transcript required — wait for transcription to finish"
              : "Use Claude to extract quotes from this video's transcript and render them as a slide carousel"
          }
          aria-label="Make post from transcript"
          className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Sparkles className="size-3.5" />
          {busy ? "Generating..." : "Make post from transcript"}
          <ChevronDown className="size-3.5 opacity-80" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        {PLATFORMS.map((p) => {
          const Icon = PLATFORM_ICONS[p]
          return (
            <DropdownMenuItem key={p} onSelect={() => generate(p)} disabled={disabled}>
              <Icon className="size-4" />
              <span>Quote carousel — {PLATFORM_LABELS[p]}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

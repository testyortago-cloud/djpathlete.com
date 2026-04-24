"use client"

import { useState } from "react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

type CarouselPlatform = "facebook" | "instagram" | "linkedin"

interface GenerateQuoteCardsButtonProps {
  videoUploadId: string
  hasTranscript: boolean
  count?: number
  platform?: CarouselPlatform
}

const PLATFORM_LABELS: Record<CarouselPlatform, string> = {
  facebook: "Generate FB quote carousel",
  instagram: "Generate IG quote carousel",
  linkedin: "Generate LinkedIn carousel",
}

const PLATFORM_TITLES: Record<CarouselPlatform, string> = {
  facebook:
    "Use Claude to extract quotes from this video's transcript and render them as a Facebook carousel",
  instagram:
    "Use Claude to extract quotes from this video's transcript and render them as an Instagram carousel (JPEG)",
  linkedin:
    "Use Claude to extract quotes from this video's transcript and render them as a LinkedIn carousel",
}

export function GenerateQuoteCardsButton({
  videoUploadId,
  hasTranscript,
  count,
  platform = "facebook",
}: GenerateQuoteCardsButtonProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function generate() {
    setBusy(true)
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
      setBusy(false)
    }
  }

  const disabled = busy || !hasTranscript
  const label = busy ? "Generating..." : PLATFORM_LABELS[platform]

  return (
    <button
      type="button"
      onClick={generate}
      disabled={disabled}
      title={
        !hasTranscript
          ? "Transcript required — wait for transcription to finish"
          : PLATFORM_TITLES[platform]
      }
      className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
    >
      <Sparkles className="size-3.5" />
      {label}
    </button>
  )
}

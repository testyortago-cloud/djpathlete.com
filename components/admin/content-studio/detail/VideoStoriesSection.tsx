"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Clapperboard, Quote } from "lucide-react"
import { toast } from "sonner"
import { PostsTabRow } from "@/components/admin/content-studio/drawer/PostsTabRow"
import { readApiError } from "@/lib/errors/humanize"
import type { PostSlide } from "@/lib/content-studio/drawer-data"
import type { SocialPost } from "@/types/database"

const BUTTON =
  "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold shadow-sm transition disabled:opacity-50"

interface VideoStoriesSectionProps {
  videoUploadId: string
  /** This video's own story plus the stories made from its quote cards. */
  stories: SocialPost[]
  mediaByPost: Record<string, PostSlide[]>
  hasTranscript: boolean
  /** Shown on the video story's row, e.g. "This video is 2:14 long…". */
  videoStoryWarning: string | null
}

export function VideoStoriesSection({
  videoUploadId,
  stories: initialStories,
  mediaByPost,
  hasTranscript,
  videoStoryWarning,
}: VideoStoriesSectionProps) {
  const router = useRouter()
  const [stories, setStories] = useState(initialStories)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<"video" | "quotes" | null>(null)
  useEffect(() => setStories(initialStories), [initialStories])

  const hasVideoStory = stories.some((s) => s.source_video_id === videoUploadId)

  async function addVideoStory() {
    setBusy("video")
    try {
      const res = await fetch("/api/admin/content-studio/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "instagram", postType: "story", caption: "", source_video_id: videoUploadId }),
      })
      if (!res.ok) throw new Error(await readApiError(res, "Could not add the story"))
      toast.success('Story added to "Needs review"')
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function makeQuoteStories() {
    setBusy("quotes")
    try {
      const res = await fetch("/api/admin/content-studio/quote-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId, format: "story", count: 3 }),
      })
      if (!res.ok) throw new Error(await readApiError(res, "Could not make quote stories"))
      const data = (await res.json()) as { postIds: string[] }
      toast.success(`Made ${data.postIds.length} quote stories from what was said`)
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!hasVideoStory && (
          <button
            type="button"
            onClick={addVideoStory}
            disabled={busy !== null}
            className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`}
          >
            <Clapperboard className="size-3.5" />
            {busy === "video" ? "Adding…" : "Add this video to the story"}
          </button>
        )}
        <button
          type="button"
          onClick={makeQuoteStories}
          disabled={busy !== null || !hasTranscript}
          title={hasTranscript ? undefined : "Needs the transcript first"}
          className={`${BUTTON} border border-border bg-white text-primary hover:bg-surface`}
        >
          <Quote className="size-3.5" />
          {busy === "quotes" ? "Writing quote cards… (about 30 seconds)" : "Make 3 quote stories"}
        </button>
      </div>

      {stories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No stories yet. Add the video, or make quote cards from what was said in it.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {stories.map((s) => (
            <PostsTabRow
              key={s.id}
              post={s}
              slides={mediaByPost[s.id] ?? []}
              isExpanded={expandedId === s.id}
              onToggle={(id) => setExpandedId((prev) => (prev === id ? null : id))}
              onMutate={(updated) => setStories((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
              warning={s.source_video_id === videoUploadId ? videoStoryWarning : null}
            />
          ))}
        </div>
      )}
    </div>
  )
}

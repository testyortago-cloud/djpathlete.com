"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { SocialPlatform, PostType } from "@/types/database"
import { defaultPublishTimeForPlatform } from "@/lib/content-studio/calendar-defaults"
import { isPlatformPostTypeSupported } from "@/lib/content-studio/post-type-support"
import { ImageUploader } from "@/components/admin/content-studio/upload/ImageUploader"
import { CarouselComposer } from "@/components/admin/content-studio/upload/CarouselComposer"
import { VideoUploader } from "@/components/admin/videos/VideoUploader"

interface ManualPostDialogProps {
  dayKey: string
  onClose: () => void
  onCreated: (postId: string) => void
  multimediaEnabled?: boolean
}

const PLATFORMS: SocialPlatform[] = ["instagram", "tiktok", "facebook", "youtube", "youtube_shorts", "linkedin"]

export function ManualPostDialog({ dayKey, onClose, onCreated, multimediaEnabled = false }: ManualPostDialogProps) {
  const [platform, setPlatform] = useState<SocialPlatform>("instagram")
  const [postType, setPostType] = useState<PostType>("video")
  const [caption, setCaption] = useState("")
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(null)
  const [mediaAssetIds, setMediaAssetIds] = useState<string[]>([])
  const [storyMediaType, setStoryMediaType] = useState<"image" | "video">("image")
  const [sourceVideoId, setSourceVideoId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canSubmit =
    !busy &&
    isPlatformPostTypeSupported(platform, postType) &&
    ((postType !== "image" && postType !== "story") ||
      (postType === "image" && mediaAssetId !== null) ||
      (postType === "story" &&
        ((storyMediaType === "image" && mediaAssetId !== null) ||
          (storyMediaType === "video" && sourceVideoId !== null)))) &&
    (postType !== "carousel" || mediaAssetIds.length >= 2)

  async function submit() {
    setBusy(true)
    try {
      const day = new Date(`${dayKey}T00:00:00Z`)
      const scheduled_at = defaultPublishTimeForPlatform(platform, day).toISOString()
      const res = await fetch("/api/admin/content-studio/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform,
          caption,
          scheduled_at,
          postType,
          mediaAssetId:
            postType === "image" || (postType === "story" && storyMediaType === "image")
              ? mediaAssetId
              : undefined,
          source_video_id:
            postType === "story" && storyMediaType === "video" ? sourceVideoId : undefined,
          mediaAssetIds: postType === "carousel" ? mediaAssetIds : undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Create failed")
      const data = (await res.json()) as { id: string }
      toast.success("Manual post scheduled")
      onCreated(data.id)
    } catch (err) {
      toast.error((err as Error).message || "Create failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="rounded-lg bg-white border border-border shadow-lg p-4 w-[28rem] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-heading text-sm text-primary mb-3">New manual post — {dayKey}</h3>

        {multimediaEnabled ? (
          <label className="block text-xs text-muted-foreground mb-3">
            Post type
            <select
              aria-label="Post type"
              value={postType}
              onChange={(e) => {
                setPostType(e.target.value as PostType)
                setMediaAssetId(null)
                setMediaAssetIds([])
                setStoryMediaType("image")
                setSourceVideoId(null)
              }}
              className="mt-1 block w-full rounded border border-border px-2 py-1 text-sm"
            >
              <option value="video">Video</option>
              <option value="image">Photo</option>
              <option value="carousel">Carousel</option>
              <option value="story">Story</option>
            </select>
          </label>
        ) : null}

        <label className="block text-xs text-muted-foreground mb-3">
          Platform
          <select
            aria-label="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
            className="mt-1 block w-full rounded border border-border px-2 py-1 text-sm"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        {postType === "image" && multimediaEnabled ? (
          <div className="mb-3">
            <ImageUploader onUploaded={(e) => setMediaAssetId(e.mediaAssetId)} />
            {!isPlatformPostTypeSupported(platform, "image") ? (
              <p className="mt-2 text-xs text-error">
                {platform} does not support image posts yet.
              </p>
            ) : null}
          </div>
        ) : null}

        {postType === "carousel" && multimediaEnabled ? (
          <div className="mb-3">
            <CarouselComposer onChange={setMediaAssetIds} />
            {!isPlatformPostTypeSupported(platform, "carousel") ? (
              <p className="mt-2 text-xs text-error">
                {platform} does not support carousels yet.
              </p>
            ) : null}
          </div>
        ) : null}

        {postType === "story" && multimediaEnabled ? (
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-2">
              Story media
              <select
                aria-label="Story media type"
                value={storyMediaType}
                onChange={(e) => {
                  setStoryMediaType(e.target.value as "image" | "video")
                  setMediaAssetId(null)
                  setSourceVideoId(null)
                }}
                className="mt-1 block w-full rounded border border-border px-2 py-1 text-sm"
              >
                <option value="image">Photo</option>
                <option value="video">Video</option>
              </select>
            </label>
            {storyMediaType === "image" ? (
              <ImageUploader onUploaded={(e) => setMediaAssetId(e.mediaAssetId)} />
            ) : (
              <VideoUploader onUploaded={(id) => setSourceVideoId(id)} />
            )}
            {!isPlatformPostTypeSupported(platform, "story") ? (
              <p className="mt-2 text-xs text-error">
                {platform} does not support stories.
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="block text-xs text-muted-foreground mb-3">
          Caption
          <textarea
            aria-label="Caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded border border-border px-2 py-1 text-sm"
          />
        </label>

        {postType === "story" && multimediaEnabled ? (
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">
            Captions are ignored on Instagram and Facebook stories.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  )
}

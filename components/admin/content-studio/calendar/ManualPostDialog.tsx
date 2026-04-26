"use client"

import { useMemo, useState } from "react"
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

const PLATFORMS: SocialPlatform[] = [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "youtube_shorts",
  "linkedin",
]

interface PostResult {
  platform: SocialPlatform
  ok: boolean
  id?: string
  error?: string
}

export function ManualPostDialog({
  dayKey,
  onClose,
  onCreated,
  multimediaEnabled = false,
}: ManualPostDialogProps) {
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatform[]>(["instagram"])
  const [postType, setPostType] = useState<PostType>("video")
  const [caption, setCaption] = useState("")
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(null)
  const [mediaAssetIds, setMediaAssetIds] = useState<string[]>([])
  const [storyMediaType, setStoryMediaType] = useState<"image" | "video">("image")
  const [sourceVideoId, setSourceVideoId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const supportedSelected = useMemo(
    () => selectedPlatforms.filter((p) => isPlatformPostTypeSupported(p, postType)),
    [selectedPlatforms, postType],
  )
  const unsupportedSelected = useMemo(
    () => selectedPlatforms.filter((p) => !isPlatformPostTypeSupported(p, postType)),
    [selectedPlatforms, postType],
  )

  const mediaReady =
    (postType !== "image" && postType !== "story" && postType !== "carousel") ||
    (postType === "image" && mediaAssetId !== null) ||
    (postType === "carousel" && mediaAssetIds.length >= 2) ||
    (postType === "story" &&
      ((storyMediaType === "image" && mediaAssetId !== null) ||
        (storyMediaType === "video" && sourceVideoId !== null)))

  const canSubmit = !busy && supportedSelected.length > 0 && mediaReady

  function togglePlatform(p: SocialPlatform) {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    )
  }

  async function createOne(platform: SocialPlatform): Promise<PostResult> {
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
      if (!res.ok) {
        const text = (await res.text()) || `HTTP ${res.status}`
        return { platform, ok: false, error: text }
      }
      const data = (await res.json()) as { id: string }
      return { platform, ok: true, id: data.id }
    } catch (err) {
      return { platform, ok: false, error: (err as Error).message || "Create failed" }
    }
  }

  async function submit() {
    if (supportedSelected.length === 0) return
    setBusy(true)
    try {
      const results = await Promise.all(supportedSelected.map(createOne))
      const successes = results.filter((r) => r.ok)
      const failures = results.filter((r) => !r.ok)

      if (successes.length > 0) {
        toast.success(
          successes.length === 1
            ? `Post scheduled to ${successes[0].platform}`
            : `Scheduled to ${successes.length} platforms`,
        )
      }
      if (failures.length > 0) {
        for (const f of failures) {
          toast.error(`${f.platform}: ${f.error}`)
        }
      }
      if (successes.length > 0) {
        onCreated(successes[0].id as string)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="rounded-lg bg-white border border-border shadow-lg p-4 w-[32rem] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
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

        <fieldset className="mb-3">
          <legend className="text-xs text-muted-foreground mb-1.5">
            Platforms{" "}
            <span className="text-muted-foreground/70">
              ({supportedSelected.length} selected)
            </span>
          </legend>
          <div className="grid grid-cols-2 gap-1.5">
            {PLATFORMS.map((p) => {
              const supported = isPlatformPostTypeSupported(p, postType)
              const checked = selectedPlatforms.includes(p)
              return (
                <label
                  key={p}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs cursor-pointer transition-colors ${
                    checked
                      ? supported
                        ? "border-primary bg-primary/5"
                        : "border-warning/60 bg-warning/5"
                      : "border-border hover:bg-surface/50"
                  } ${!supported ? "opacity-60" : ""}`}
                  title={supported ? "" : `${p} does not support ${postType} posts`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Post to ${p}`}
                    checked={checked}
                    onChange={() => togglePlatform(p)}
                    className="accent-primary"
                  />
                  <span className="capitalize">{p.replace(/_/g, " ")}</span>
                  {checked && !supported ? (
                    <span className="ml-auto text-[10px] text-warning">unsupported</span>
                  ) : null}
                </label>
              )
            })}
          </div>
          {unsupportedSelected.length > 0 ? (
            <p className="mt-1.5 text-[11px] text-warning">
              {unsupportedSelected.map((p) => p.replace(/_/g, " ")).join(", ")}{" "}
              {unsupportedSelected.length === 1 ? "doesn't" : "don't"} support {postType} posts and
              will be skipped.
            </p>
          ) : null}
        </fieldset>

        {postType === "image" && multimediaEnabled ? (
          <div className="mb-3">
            <ImageUploader onUploaded={(e) => setMediaAssetId(e.mediaAssetId)} />
          </div>
        ) : null}

        {postType === "carousel" && multimediaEnabled ? (
          <div className="mb-3">
            <CarouselComposer onChange={setMediaAssetIds} />
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
            {busy
              ? `Creating${supportedSelected.length > 1 ? ` (${supportedSelected.length})` : ""}…`
              : supportedSelected.length > 1
                ? `Create ${supportedSelected.length} posts`
                : "Create"}
          </button>
        </div>
      </div>
    </div>
  )
}

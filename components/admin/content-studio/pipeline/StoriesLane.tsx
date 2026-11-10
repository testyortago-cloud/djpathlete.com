"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarClock, ImagePlus } from "lucide-react"
import { toast } from "sonner"
import { PostsLane } from "./PostsLane"
import { uploadImageFile } from "@/lib/firebase-client-upload"
import { readApiError } from "@/lib/errors/humanize"
import { spreadableStories, spreadTimes } from "@/lib/content-studio/stories"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PipelinePostRow } from "@/lib/db/social-posts"

/** Story photo types the publish step can turn into Instagram's JPEG. */
const STORY_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"]
/** Same cap as the image uploader (ImageUploader MAX_BYTES). */
const MAX_PHOTO_BYTES = 25 * 1024 * 1024

const BUTTON =
  "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition disabled:opacity-50"

interface StoriesLaneProps {
  stories: PipelinePostRow[]
  selectedIds: Set<string>
  onToggleSelected: (postId: string, selected: boolean) => void
  thumbnailUrlsByVideo: Record<string, string>
  storyImageUrls: Record<string, string>
  /** Photo stories need the multimedia flag (the posts route refuses them without it). */
  canAddPhotos: boolean
}

export function StoriesLane({ stories, canAddPhotos, ...laneProps }: StoriesLaneProps) {
  return (
    <PostsLane
      {...laneProps}
      posts={stories}
      idPrefix="story-"
      title="Instagram Stories"
      subtitle="Each new video adds its own story. Add photos, approve the video stories, then spread them across a day."
      help="A story stays on Instagram for 24 hours. Stories have no caption. A video story posts the same edited cut as the Instagram reel, and must be 60 seconds or less."
      actions={
        <>
          <SpreadStoriesButton stories={stories} />
          {canAddPhotos && <AddStoryPhotosButton />}
        </>
      }
    />
  )
}

function AddStoryPhotosButton() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function addPhotos(files: File[]) {
    const problems: string[] = []
    const usable = files.filter((f) => {
      if (!STORY_PHOTO_TYPES.includes(f.type)) problems.push(`${f.name}: use a JPEG, PNG or WebP photo`)
      else if (f.size > MAX_PHOTO_BYTES) problems.push(`${f.name}: larger than 25 MB`)
      else return true
      return false
    })
    let added = 0
    setProgress({ done: 0, total: usable.length })
    for (const file of usable) {
      try {
        const { mediaAssetId } = await uploadImageFile(file)
        const res = await fetch("/api/admin/content-studio/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform: "instagram", postType: "story", caption: "", mediaAssetId }),
        })
        if (!res.ok) throw new Error(await readApiError(res, "Could not add the story"))
        added++
      } catch (err) {
        problems.push(`${file.name}: ${(err as Error).message}`)
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
    }
    setProgress(null)
    if (added > 0) toast.success(`Added ${added} photo ${added === 1 ? "story" : "stories"} to "Needs review"`)
    if (problems.length > 0) toast.error(problems.join("\n"))
    router.refresh()
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={STORY_PHOTO_TYPES.join(",")}
        className="hidden"
        aria-label="Choose story photos"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          if (files.length > 0) void addPhotos(files)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={progress !== null}
        className={`${BUTTON} bg-primary text-primary-foreground shadow-sm hover:bg-primary/90`}
      >
        <ImagePlus className="size-3.5" />
        {progress ? `Adding ${progress.done + 1} of ${progress.total}…` : "Add photos"}
      </button>
    </>
  )
}

function localDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function SpreadStoriesButton({ stories }: { stories: PipelinePostRow[] }) {
  const router = useRouter()
  const waiting = spreadableStories(stories)
  // Video stories still in "Needs review" are left alone (see spreadableStories).
  const heldBack = stories.filter(
    (s) => s.source_video_id && (s.approval_status === "draft" || s.approval_status === "edited"),
  ).length
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [day, setDay] = useState(() => localDateInput(new Date(Date.now() + 24 * 60 * 60 * 1000)))
  const [from, setFrom] = useState("09:00")
  const [to, setTo] = useState("21:00")

  const times = spreadTimes(new Date(`${day}T${from}`), new Date(`${day}T${to}`), waiting.length)
  const invalid = times.some((t) => Number.isNaN(t.getTime()))
  const backwards = waiting.length > 0 && (times.length === 0 || invalid)
  const startsInPast = !backwards && times.length > 0 && times[0].getTime() <= Date.now()

  async function schedule() {
    setBusy(true)
    let ok = 0
    const problems: string[] = []
    for (let i = 0; i < waiting.length; i++) {
      try {
        const res = await fetch(`/api/admin/social/posts/${waiting[i].id}/schedule`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scheduled_at: times[i].toISOString() }),
        })
        if (!res.ok) throw new Error(await readApiError(res, "Could not schedule"))
        ok++
      } catch (err) {
        problems.push((err as Error).message)
      }
    }
    setBusy(false)
    setOpen(false)
    if (ok > 0) toast.success(`Scheduled ${ok} ${ok === 1 ? "story" : "stories"} on ${day}`)
    if (problems.length > 0) toast.error(`${problems.length} not scheduled: ${problems[0]}`)
    router.refresh()
  }

  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={waiting.length === 0}
        title={
          waiting.length === 0
            ? heldBack > 0
              ? "Approve the video stories first"
              : "No stories are waiting for a time"
            : undefined
        }
        className={`${BUTTON} border border-border bg-white text-primary shadow-sm hover:bg-surface`}
      >
        <CalendarClock className="size-3.5" />
        Spread over a day ({waiting.length})
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Spread stories over a day</DialogTitle>
            <DialogDescription>
              {waiting.length} {waiting.length === 1 ? "story goes" : "stories go"} out one at a time, evenly spaced,
              oldest first: photo stories waiting for review, and approved stories.
              {heldBack > 0 &&
                ` ${heldBack} video ${heldBack === 1 ? "story waits" : "stories wait"} until you approve ${heldBack === 1 ? "it" : "them"}, so no unfinished video goes out.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <label className="col-span-3 flex flex-col gap-1 font-medium text-primary">
              Day
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="h-9 rounded-md border border-border px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 font-medium text-primary">
              First at
              <input
                type="time"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 rounded-md border border-border px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 font-medium text-primary">
              Last at
              <input
                type="time"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 rounded-md border border-border px-2 text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {backwards
              ? "Pick a day, and a last time after the first."
              : startsInPast
                ? "The first time has already passed. Pick a later time or another day."
                : `Times: ${times.map(fmt).join(", ")}`}
          </p>
          <DialogFooter>
            <button
              type="button"
              onClick={schedule}
              disabled={busy || backwards || startsInPast || waiting.length === 0}
              className={`${BUTTON} bg-primary text-primary-foreground shadow-sm hover:bg-primary/90`}
            >
              {busy ? "Scheduling…" : `Schedule ${waiting.length}`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

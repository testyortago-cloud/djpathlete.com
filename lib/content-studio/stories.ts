// lib/content-studio/stories.ts
// Pure helpers for Instagram Story posts. No I/O, safe on client and server.

/** Instagram's API refuses a story video longer than this. */
export const STORY_MAX_VIDEO_MS = 60_000

/**
 * video_uploads.duration_seconds from AssemblyAI's `audio_duration` (seconds,
 * may be fractional). Rounded UP so a 60.4 s video counts as too long for a
 * story rather than slipping under the cap. Null when absent or not a length.
 */
export function videoSecondsFromAudioDuration(audioDuration: unknown): number | null {
  return typeof audioDuration === "number" && Number.isFinite(audioDuration) && audioDuration > 0
    ? Math.ceil(audioDuration)
    : null
}

type SpreadCandidate = { approval_status: string; source_video_id: string | null; created_at: string }

/**
 * Stories "Spread over a day" may schedule, oldest first. Scheduling releases the
 * video's edit gate (schedule route → releaseSourceVideoForSend), so a VIDEO story
 * must be approved first — otherwise one click would mark every new video ready and
 * could post raw footage. Photo and quote-card stories (no source video) can go
 * straight from "Needs review".
 */
export function spreadableStories<T extends SpreadCandidate>(stories: T[]): T[] {
  return stories
    .filter(
      (s) =>
        s.approval_status === "approved" ||
        (!s.source_video_id && (s.approval_status === "draft" || s.approval_status === "edited")),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** "2:14" for 134 000 ms. */
export function formatClock(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function isStoryVideoTooLong(durationMs: number | null | undefined): boolean {
  return typeof durationMs === "number" && durationMs > STORY_MAX_VIDEO_MS
}

/** Plain words for the coach, shown on the story row and as the failure note. */
export function storyTooLongMessage(durationMs: number): string {
  return `This video is ${formatClock(durationMs)} long. Instagram stories can be 60 seconds at most. Make a short clip with "Split reel" first.`
}

/**
 * `count` times spread evenly from `start` to `end`, both included. One story
 * goes out at `start`. Returns [] when count < 1, end is before start, or several
 * stories would share one instant (end equal to start).
 */
export function spreadTimes(start: Date, end: Date, count: number): Date[] {
  if (count < 1 || end.getTime() < start.getTime()) return []
  if (count === 1) return [new Date(start)]
  if (end.getTime() === start.getTime()) return []
  const step = (end.getTime() - start.getTime()) / (count - 1)
  return Array.from({ length: count }, (_, i) => new Date(Math.round(start.getTime() + step * i)))
}

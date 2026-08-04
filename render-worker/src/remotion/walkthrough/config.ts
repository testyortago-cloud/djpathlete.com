// EDL for the AI Bookkeeper walkthrough.
//
// Chapter order and caption timings are NOT written here — they come from
// timeline.json, which the recorder emits with MEASURED boundaries. Eyeballed
// boundaries drift out of sync the moment a beat is retimed; measured ones
// cannot. This module only turns those milliseconds into frames.
import timelineJson from "../../../public/walkthrough/timeline.json"

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

/** Source takes are 1600x1000; fit to height leaves symmetric side bars. */
export const TAKE_W = 1600
export const TAKE_H = 1000

export interface Beat {
  text: string
  startMs: number
  endMs: number
  /** "<chapterId>/<NN>.wav" under public/walkthrough/audio — absent on takes
   *  recorded before narration existed, which then render captions-only. */
  audio?: string
  /** Encoded length of that WAV, probed at prepare time. The beat is held for
   *  audio + a breath, so the clip outlives the voice line; the edit MUST bound
   *  playback to this or the compositor is asked for samples past the file end. */
  audioMs?: number
}

export interface Chapter {
  id: string
  title: string
  durationMs: number
  /**
   * Playwright starts recording at context creation, i.e. BEFORE the login the
   * recorder performs. Beat timings are measured from AFTER login, so the clip
   * must be started this far in or every caption runs ahead of its footage.
   */
  leadInMs: number
  /** Encoded length of the staged mp4, probed at prepare time. */
  mediaMs?: number
  /** Frames the video stream ACTUALLY decodes to, counted at prepare time.
   *  Preferred over mediaMs: container duration overstates what is decodable
   *  (one chapter reported 53.3s and ran out 35 frames early). */
  mediaFrames?: number
  file: string
  beats: Beat[]
}

/**
 * Frames a chapter can actually show. The recorder's wall-clock duration
 * overruns the encoded media slightly, and asking the compositor for a frame
 * past the end of a clip is a hard render failure, not a dropped frame.
 */
/**
 * Frames held back from the end of every clip. Clamping to exactly the last
 * frame is not enough: `msToFrames` rounds, and the final frame of an h264 file
 * is frequently not decodable at the rounded position, so the compositor throws
 * "No frame found at position ..." and kills the render. Every chapter sat at
 * zero slack before this existed. Three frames is 100 ms off a tail the
 * narration has already finished speaking over.
 */
const TAIL_SAFETY_FRAMES = 3

export function chapterFrames(c: Chapter): number {
  const wanted = msToFrames(c.durationMs)
  // Counted frames when we have them; container duration is the fallback for
  // takes staged before frame counting existed.
  const total = c.mediaFrames ?? (c.mediaMs ? msToFrames(c.mediaMs) : null)
  if (!total) return wanted
  const available = total - msToFrames(c.leadInMs) - TAIL_SAFETY_FRAMES
  return Math.max(1, Math.min(wanted, available))
}

/** Playback order. Chapters missing from timeline.json are skipped, not faked. */
const ORDER = [
  "01-problem",
  "02-three-books",
  "03-income",
  "04-statements",
  "05-receipts",
  "06-categories",
  "07-payouts",
  "08-insights",
  "08b-duplicates",
  "09-close",
  "10-reports",
  "11-assets",
  "12-wrap",
] as const

const raw = timelineJson as unknown as Record<string, Chapter>

export const CHAPTERS: Chapter[] = ORDER.map((id) => raw[id]).filter(Boolean)

export const msToFrames = (ms: number) => Math.round((ms / 1000) * FPS)

/** Cumulative composition start frame for each chapter, in playback order. */
export function chapterStarts(): number[] {
  const starts: number[] = []
  let acc = 0
  for (const c of CHAPTERS) {
    starts.push(acc)
    acc += chapterFrames(c)
  }
  return starts
}

export const TOTAL_FRAMES = Math.max(
  1,
  CHAPTERS.reduce((a, c) => a + chapterFrames(c), 0),
)

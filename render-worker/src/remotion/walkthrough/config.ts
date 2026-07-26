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
  file: string
  beats: Beat[]
}

/**
 * Frames a chapter can actually show. The recorder's wall-clock duration
 * overruns the encoded media slightly, and asking the compositor for a frame
 * past the end of a clip is a hard render failure, not a dropped frame.
 */
export function chapterFrames(c: Chapter): number {
  const wanted = msToFrames(c.durationMs)
  if (!c.mediaMs) return wanted
  const available = msToFrames(c.mediaMs - c.leadInMs)
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

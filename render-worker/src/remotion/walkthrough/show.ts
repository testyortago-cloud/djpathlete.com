// Shared EDL machinery for every walkthrough show.
//
// Chapter order and caption timings are NOT written here — they come from each
// show's timeline.json, which the recorder emits with MEASURED boundaries.
// Eyeballed boundaries drift out of sync the moment a beat is retimed; measured
// ones cannot. This module only turns those milliseconds into frames and works
// out how the take sits in the frame.

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

export const msToFrames = (ms: number) => Math.round((ms / 1000) * FPS)

export interface Beat {
  text: string
  startMs: number
  endMs: number
  /** "<chapterId>/<NN>.wav" under the show's audio dir — absent on takes
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
  /** Playwright starts recording at context creation, i.e. BEFORE login. Zero
   *  on takes staged after prepare started cutting it at encode time. */
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

/** Where the take is drawn inside the 1920x1080 frame. */
export interface Geometry {
  left: number
  top: number
  width: number
  height: number
}

export interface ResolvedChapter extends Chapter {
  frames: number
  startFrame: number
}

export interface Show {
  /** Asset directory under render-worker/public. */
  dir: string
  chapters: ResolvedChapter[]
  totalFrames: number
  geometry: Geometry
}

/**
 * Frames held back from the end of every clip. Clamping to exactly the last
 * frame is not enough: msToFrames rounds, and the final frame of an h264 file
 * is frequently not decodable at the rounded position, so the compositor throws
 * "No frame found at position ..." and kills the render. Every chapter sat at
 * zero slack before this existed. Three frames is 100 ms off a tail the
 * narration has already finished speaking over.
 */
const TAIL_SAFETY_FRAMES = 3

function chapterFrames(c: Chapter): number {
  const wanted = msToFrames(c.durationMs)
  // Counted frames when we have them; container duration is the fallback for
  // takes staged before frame counting existed.
  const total = c.mediaFrames ?? (c.mediaMs ? msToFrames(c.mediaMs) : null)
  if (!total) return wanted
  const available = total - msToFrames(c.leadInMs) - TAIL_SAFETY_FRAMES
  return Math.max(1, Math.min(wanted, available))
}

/**
 * Fit a take into the 1920x1080 frame.
 *
 * `native` is the identity transform and is what a 16:9 capture wants: no
 * scale, no crop, one source pixel per output pixel. `fillCrop` exists for the
 * 1600x1000 bookkeeper take, which predates capturing at the output size — it
 * fills the width and biases the overflow crop to the top, taking two thirds
 * off the "Welcome back" chrome bar that the narration never refers to.
 */
export function nativeGeometry(): Geometry {
  return { left: 0, top: 0, width: WIDTH, height: HEIGHT }
}

export function fillCropGeometry(takeW: number, takeH: number, topBias = 0.66): Geometry {
  const filledH = Math.round(takeH * (WIDTH / takeW))
  return { left: 0, top: -Math.round((filledH - HEIGHT) * topBias), width: WIDTH, height: filledH }
}

/** Chapters missing from timeline.json are skipped, not faked. */
export function makeShow(input: {
  dir: string
  timeline: unknown
  order: readonly string[]
  geometry: Geometry
}): Show {
  const raw = input.timeline as Record<string, Chapter>
  const present = input.order.map((id) => raw[id]).filter(Boolean)

  let acc = 0
  const chapters: ResolvedChapter[] = present.map((c) => {
    const frames = chapterFrames(c)
    const resolved = { ...c, frames, startFrame: acc }
    acc += frames
    return resolved
  })

  return {
    dir: input.dir,
    chapters,
    totalFrames: Math.max(1, acc),
    geometry: input.geometry,
  }
}

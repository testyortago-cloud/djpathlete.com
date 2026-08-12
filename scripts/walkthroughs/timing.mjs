/**
 * Beat timing, shared by every walkthrough show.
 *
 * Timing is derived from the words, not guessed: the recorder holds each beat
 * for exactly as long as its narration runs, so the footage is precisely as
 * long as the script needs. The bookkeeper's first cut came out at 2.7 minutes
 * for a 12-minute script because the dwell times were invented instead.
 */
import { createRequire } from "node:module"

/** ~2.6 words/sec reading pace, with a floor so short lines still land. */
export function captionMs(text) {
  const words = text.trim().split(/\s+/).length
  return Math.max(2600, Math.round((words / 2.6) * 1000) + 700)
}

/** Silence after a line so the voice does not run straight into the next one. */
export const BREATH_MS = 450

/**
 * Load a show's measured narration lengths, written by
 * synth-walkthrough-narration.mjs.
 *
 * The manifest is PER SHOW, not shared. It is keyed `<chapterId>#<index>` and
 * every show numbers its chapters from 01, so a shared file would hand one
 * show another's hold times — silently, because a number is always a plausible
 * number. Absent until the synth has run once; the reading-pace estimate is the
 * fallback so a captions-only recording still works.
 */
export function loadTiming(showId) {
  let narration = {}
  try {
    narration = createRequire(import.meta.url)(`../narration/${showId}.json`)
  } catch {
    /* not synthesized yet */
  }

  return {
    hasNarration: () => Object.keys(narration).length > 0,
    /**
     * Keyed by POSITION, so re-wording a line re-synthesizes it rather than
     * silently keeping the old audio against the new caption.
     */
    beatMs(chapterId, index, text) {
      const measured = narration[`${chapterId}#${index}`]
      return measured ? measured + BREATH_MS : captionMs(text)
    },
  }
}

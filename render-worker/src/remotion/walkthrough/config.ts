// The two walkthrough shows.
//
// Everything structural lives in show.ts; these are just the per-show facts:
// which timeline, which chapter order, and how the take sits in the frame.

import bookkeeperTimeline from "../../../public/walkthrough/timeline.json"
import teamTimeline from "../../../public/walkthrough-team/timeline.json"
import { fillCropGeometry, makeShow, nativeGeometry } from "./show.js"

export { FPS, HEIGHT, WIDTH, msToFrames } from "./show.js"
export type { Beat, Chapter, ResolvedChapter, Show } from "./show.js"

/**
 * AI Bookkeeper — 13 chapters, captured 1600x1000.
 *
 * That capture predates recording at the output size, so it is scaled up to
 * fill the 1920 width. Left as it is: the video is finished and re-recording it
 * to gain sharpness is not worth invalidating a 10-minute take.
 */
export const BOOKKEEPER = makeShow({
  dir: "walkthrough",
  timeline: bookkeeperTimeline,
  geometry: fillCropGeometry(1600, 1000),
  order: [
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
  ],
})

/** Team permissions — 5 chapters, captured natively at 1920x1080, so 1:1. */
export const TEAM_PERMISSIONS = makeShow({
  dir: "walkthrough-team",
  timeline: teamTimeline,
  geometry: nativeGeometry(),
  order: ["01-where", "02-inviting", "03-permissions", "04-clients", "05-changing"],
})

/** Back-compat for callers that only ever knew about the bookkeeper. */
export const TOTAL_FRAMES = BOOKKEEPER.totalFrames

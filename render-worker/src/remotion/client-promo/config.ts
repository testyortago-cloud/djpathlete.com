// render-worker/src/remotion/client-promo/config.ts
//
// The edit decision list for the client-app promo.
//
// The take (public/client-take.mp4) is REAL footage of the client app driven by
// Playwright -- no mockups. Capture is deliberately separate from the edit, so
// re-cutting, re-captioning or re-framing costs a re-render, not a re-shoot.
// Change SEGMENTS/CAPTIONS here and BOTH aspect ratios follow.
//
// SEGMENTS come from the recorder's measured timeline.json, not from eyeballing
// frames: page-load time varies run to run (one take moved 79s -> 85s), so
// hand-read boundaries rot on every re-record.
//
// The take is TRUE 1080x1920 as of 2026-08-08. It used to be 540x960 upscaled
// 2x here, which is why the old cut looked soft: Playwright's video recorder
// captures the layout viewport in CSS pixels, and the phone layout only renders
// below the 640px `sm` breakpoint. `scripts/record-client-promo.mjs` captures
// 2x frames instead and documents every route that does NOT work.

export const FPS = 30
export const TAKE = "client-take.mp4"

/**
 * Usable stretches of the take, in SOURCE seconds.
 *
 * GENERATED -- do not hand-edit. `scripts/prepare-client-take.mjs` derives these
 * from the recorder's measured `timeline.json` and prints the block to paste.
 *
 * The gaps are the transitions between beats plus one deliberate exclusion: the
 * Watch dialog shows a BLACK player for ~6s while the YouTube iframe loads, so
 * only the confirmed-playing window is used.
 *
 * The DURATIONS are load-bearing and sum to 59.5s. CAPTIONS below are timed
 * against that total, so a segment that changes length silently moves every
 * later caption onto the wrong footage. prepare-client-take.mjs asserts both the
 * per-segment durations and the total, and fails rather than shortening a cut.
 */
export const SEGMENTS: { from: number; to: number; note: string }[] = [
  { from: 0.35, to: 8.55, note: "dashboard: Welcome back Jordan, Week 3 of 6, install banner" },
  { from: 9.77, to: 17.97, note: "workouts, Week 3 of 6, recovery slider dragged" },
  { from: 22.58, to: 26.18, note: "expand hero: sets/reps/weight prescription" },
  { from: 33.74, to: 39.74, note: "Darren's demo actually playing (black load skipped)" },
  { from: 42.08, to: 46.38, note: "upload-recording dialog" },
  { from: 47.57, to: 51.37, note: "typing 42.5kg over the recommended 40" },
  { from: 53.99, to: 63.99, note: "Save Workout -> NEW PERSONAL RECORD + confetti" },
  { from: 65.93, to: 68.13, note: "logged green row" },
  { from: 72, to: 74.6, note: "Reviewed - view feedback" },
  { from: 77.71, to: 83.71, note: "progress: Key Lifts chart at 42.5kg" },
  { from: 86.55, to: 91.15, note: "achievements grid" },
]

export const secToFrames = (s: number) => Math.round(s * FPS)

/** Cumulative composition start (in frames) for each segment. */
export const segmentStarts = (): number[] => {
  const starts: number[] = []
  let acc = 0
  for (const s of SEGMENTS) {
    starts.push(acc)
    acc += secToFrames(s.to - s.from)
  }
  return starts
}

export const FOOTAGE_FRAMES = SEGMENTS.reduce((a, s) => a + secToFrames(s.to - s.from), 0)
export const CTA_FRAMES = secToFrames(4.4)
export const TOTAL_FRAMES = FOOTAGE_FRAMES + CTA_FRAMES

/**
 * Captions, in COMPOSITION seconds (i.e. after the cut, not source time).
 *
 * Silent video with words on screen: feeds autoplay muted, so the words carry
 * the whole argument. Voice matches the /online page -- clipped and declarative,
 * no consumer-fitness chirp. No product or technical vocabulary anywhere.
 *
 * Segment boundaries land at: 0 / 8.2 / 16.4 / 20.0 / 26.0 / 30.3 / 34.1 / 44.1
 * / 48.9 / 54.9, with the CTA at 59.5.
 */
export const CAPTIONS: { from: number; to: number; text: string }[] = [
  { from: 0.2, to: 4.0, text: "Most coaching stops when the spreadsheet goes out." },
  { from: 4.2, to: 6.0, text: "This one doesn't." },
  { from: 6.2, to: 8.1, text: "Add it to your phone." },
  { from: 8.5, to: 12.2, text: "Week 3 of 6. Right where you left off." },
  { from: 12.5, to: 16.3, text: "It asks how recovered you are. Before you lift." },
  { from: 16.7, to: 19.9, text: "Sets, reps and weight. Already set for you." },
  { from: 20.2, to: 25.9, text: "Darren demos every single one." },
  { from: 26.2, to: 30.2, text: "Film your set. Send it to him." },
  { from: 30.5, to: 34.0, text: "42.5 kilos. Two and a half up." },
  { from: 34.3, to: 37.5, text: "Log it. One tap." },
  { from: 37.8, to: 44.0, text: "Your best ever — and it says so." },
  { from: 44.4, to: 48.8, text: "He watched it. Reviewed, with notes." },
  { from: 49.2, to: 54.8, text: "Every lift tracked. Watch it climb." },
  { from: 55.2, to: 59.4, text: "Proof you're getting stronger." },
]

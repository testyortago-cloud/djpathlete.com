/**
 * Turns the recorder's frame sequence into the take Remotion edits, and derives
 * the EDL from the MEASURED timeline.
 *
 * Two things this must get right, both learned the hard way on the walkthrough:
 *
 *  1. TRUE CFR with dense keyframes. The frames arrive at ~13fps with uneven
 *     spacing; resampling to a constant 30fps and staging ALL-INTRA (`-g 1`) is
 *     what stops Remotion dying mid-render with "No frame found at position N".
 *     A variable-frame-rate or sparse-keyframe source fails ~25 minutes in.
 *
 *  2. Segment windows come from timeline.json, never from eyeballing frames.
 *
 * The cut deliberately reproduces the ORIGINAL promo's segment durations, so
 * every caption in config.ts still lands on the footage it describes. If a beat
 * is too short to yield its window this script FAILS rather than quietly
 * shipping a short segment that shifts every later caption.
 *
 * Run: node scripts/prepare-client-take.mjs
 */

import { execFileSync } from "child_process"
import { createRequire } from "module"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TAKE = path.resolve(__dirname, "../.promo-take")
const DEST = path.resolve(__dirname, "../render-worker/public/client-take.mp4")

// Resolve ffmpeg from the package that owns it, then fall back to PATH.
function ffmpegBin() {
  try {
    const req = createRequire(path.resolve(__dirname, "../package.json"))
    const p = req("ffmpeg-static")
    if (p && fs.existsSync(p)) return p
  } catch {}
  return "ffmpeg"
}
const FFMPEG = ffmpegBin()
const FFPROBE = "ffprobe"

/**
 * The cut, in the original promo's shape. `seconds` values are the ORIGINAL
 * segment durations — holding them fixed is what keeps CAPTIONS untouched.
 */
const CUT = [
  { beats: ["dashboard", "install"], seconds: 8.2, note: "dashboard: Welcome back Jordan, Week 3 of 6, install banner" },
  { beats: ["workouts", "recovery"], seconds: 8.2, note: "workouts, Week 3 of 6, recovery slider dragged" },
  { beats: ["prescription"], seconds: 3.6, note: "expand hero: sets/reps/weight prescription" },
  { beats: ["demo-play"], seconds: 6.0, note: "Darren's demo actually playing (black load skipped)" },
  { beats: ["upload"], seconds: 4.3, note: "upload-recording dialog" },
  { beats: ["type-weight"], seconds: 3.8, note: "typing 42.5kg over the recommended 40" },
  { beats: ["save-pr"], seconds: 10.0, note: "Save Workout -> NEW PERSONAL RECORD + confetti" },
  // The original spent one 4.8s segment on "logged green row + Reviewed"; the
  // two screens are separate beats now, so split that same 4.8s between them.
  // The SUM is what keeps every later caption where it was.
  { beats: ["logged"], seconds: 2.2, note: "logged green row" },
  { beats: ["review"], seconds: 2.6, note: "Reviewed - view feedback" },
  { beats: ["progress"], seconds: 6.0, note: "progress: Key Lifts chart at 42.5kg" },
  { beats: ["achievements"], seconds: 4.6, note: "achievements grid" },
]

/** Frames right after a beat starts can still show the previous screen. */
const LEAD_IN = 0.35

function main() {
  const frames = JSON.parse(fs.readFileSync(path.join(TAKE, "frames.json"), "utf8"))
  const timeline = JSON.parse(fs.readFileSync(path.join(TAKE, "timeline.json"), "utf8"))
  if (!frames.length) throw new Error("no frames captured")

  // ─── Assemble: real per-frame durations -> constant 30fps ────────────────

  const listPath = path.join(TAKE, "concat.txt")
  const lines = []
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + 70
    lines.push(`file 'frames/${frames[i].file}'`)
    lines.push(`duration ${((next - frames[i].t) / 1000).toFixed(4)}`)
  }
  // concat demuxer ignores the final `duration` unless the file is repeated.
  lines.push(`file 'frames/${frames[frames.length - 1].file}'`)
  fs.writeFileSync(listPath, lines.join("\n"))

  const out = path.join(TAKE, "client-take.mp4")
  console.log("encoding CFR 30, all-intra…")
  execFileSync(
    FFMPEG,
    [
      "-y", "-v", "error",
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-vf", "fps=30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-pix_fmt", "yuv420p",
      // All-intra: Remotion reads frames out of order across threads, and a
      // sparse GOP makes those reads reconstruct — or fail outright.
      "-g", "1", "-keyint_min", "1", "-sc_threshold", "0",
      "-fps_mode", "cfr",
      "-movflags", "+faststart",
      out,
    ],
    { cwd: TAKE, stdio: "inherit" },
  )

  // ─── Verify the staged file before anything depends on it ────────────────

  const probe = JSON.parse(
    execFileSync(FFPROBE, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames",
      "-count_frames", "-of", "json", out,
    ]).toString(),
  ).streams[0]

  const problems = []
  if (probe.width !== 1080 || probe.height !== 1920) problems.push(`expected 1080x1920, got ${probe.width}x${probe.height}`)
  if (probe.r_frame_rate !== "30/1") problems.push(`r_frame_rate ${probe.r_frame_rate} != 30/1`)
  if (probe.avg_frame_rate !== "30/1") problems.push(`avg_frame_rate ${probe.avg_frame_rate} != 30/1 (not CFR)`)
  if (problems.length) throw new Error("staged take is unusable:\n  " + problems.join("\n  "))

  const countedFrames = Number(probe.nb_read_frames)
  const mediaSeconds = countedFrames / 30
  console.log(`staged: ${probe.width}x${probe.height}, ${countedFrames} counted frames, ${mediaSeconds.toFixed(2)}s CFR30`)

  // ─── Derive SEGMENTS from the measured beats ─────────────────────────────

  const beatById = Object.fromEntries(timeline.beats.map((b) => [b.id, b]))
  const segments = []
  for (const cut of CUT) {
    const first = beatById[cut.beats[0]]
    const last = beatById[cut.beats[cut.beats.length - 1]]
    if (!first || !last) throw new Error(`timeline is missing beat(s): ${cut.beats.join(", ")}`)

    const spanStart = first.start / 1000
    const spanEnd = last.end / 1000
    const available = spanEnd - spanStart - LEAD_IN

    if (available < cut.seconds) {
      throw new Error(
        `beat "${cut.beats.join("+")}" yields ${available.toFixed(2)}s but the cut needs ${cut.seconds}s.\n` +
        `Lengthen its dwell in scripts/record-client-promo.mjs and re-record — do NOT shorten the\n` +
        `segment, because every caption after it would shift.`,
      )
    }

    const from = spanStart + LEAD_IN
    segments.push({ from: +from.toFixed(2), to: +(from + cut.seconds).toFixed(2), note: cut.note })
  }

  const last = segments[segments.length - 1]
  if (last.to > mediaSeconds) throw new Error(`cut runs to ${last.to}s but the take is only ${mediaSeconds.toFixed(2)}s`)

  // The captions in config.ts are timed against a 59.5s cut. If the total moves,
  // every caption after the change lands on the wrong footage.
  const CAPTIONED_FOOTAGE_SECONDS = 59.5
  const cutTotal = CUT.reduce((a, c) => a + c.seconds, 0)
  if (Math.abs(cutTotal - CAPTIONED_FOOTAGE_SECONDS) > 0.001) {
    throw new Error(
      `CUT totals ${cutTotal.toFixed(2)}s but CAPTIONS are timed to ${CAPTIONED_FOOTAGE_SECONDS}s. ` +
      `Re-time CAPTIONS deliberately or keep the sum fixed.`,
    )
  }

  fs.copyFileSync(out, DEST)

  const total = segments.reduce((a, s) => a + (s.to - s.from), 0)
  console.log(`\ncopied -> ${DEST}\nfootage total ${total.toFixed(1)}s across ${segments.length} segments\n`)
  console.log("Paste into render-worker/src/remotion/client-promo/config.ts:\n")
  console.log("export const SEGMENTS: { from: number; to: number; note: string }[] = [")
  for (const s of segments) console.log(`  { from: ${s.from}, to: ${s.to}, note: ${JSON.stringify(s.note)} },`)
  console.log("]")

  fs.writeFileSync(path.join(TAKE, "segments.json"), JSON.stringify(segments, null, 2))
}

main()

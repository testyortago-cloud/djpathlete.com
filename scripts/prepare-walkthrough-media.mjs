/**
 * Convert the recorded chapter takes (VP8 .webm from Playwright) to .mp4 and
 * stage them, with the timeline, where Remotion's staticFile() can see them.
 *
 * Playwright only ever writes webm; Remotion is happier with h264. Uses the
 * ffmpeg-static binary already vendored for render-worker's face detection.
 *
 * Run: node scripts/prepare-walkthrough-media.mjs
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"

const execFileP = promisify(execFile)

/** Prefer the vendored binary; fall back to a system ffmpeg on PATH. */
function resolveFfmpeg() {
  try {
    const require = createRequire(path.join(process.cwd(), "render-worker", "package.json"))
    const p = require("ffmpeg-static")
    if (p && fs.existsSync(p)) return p
  } catch {
    /* fall through to PATH */
  }
  return "ffmpeg"
}
const ffmpegPath = resolveFfmpeg()

const SRC = path.join(process.cwd(), ".playwright-out", "walkthrough")
const DEST = path.join(process.cwd(), "render-worker", "public", "walkthrough")

async function main() {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found")
  const timelinePath = path.join(SRC, "timeline.json")
  if (!fs.existsSync(timelinePath)) throw new Error("timeline.json missing — record first")

  fs.mkdirSync(DEST, { recursive: true })
  const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"))

  for (const key of Object.keys(timeline)) {
    const webm = path.join(SRC, `${key}.webm`)
    if (!fs.existsSync(webm)) throw new Error(`missing take: ${key}.webm`)
    const mp4 = path.join(DEST, `${key}.mp4`)
    process.stdout.write(`${key} … `)
    await execFileP(ffmpegPath, [
      "-y",
      "-i", webm,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      // Playwright's webm can carry a variable frame rate; pin it so Remotion's
      // frame math and the measured beat timings stay in agreement.
      "-r", "30",
      "-an",
      mp4,
    ])
    const { size } = fs.statSync(mp4)

    // Record the ENCODED duration. The recorder's wall-clock measurement
    // overruns the actual media by ~0.1-0.2s (recording stops on context close,
    // and the tail fraction does not survive encoding), which made the
    // composition ask the compositor for a frame past the end of the clip:
    // "No frame found at position ...". The edit clamps to this.
    const { stdout } = await execFileP(ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace("ffmpeg", "ffprobe")), [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4,
    ]).catch(() => ({ stdout: "" }))
    const mediaMs = Math.floor(parseFloat(String(stdout).trim() || "0") * 1000)
    if (!mediaMs) throw new Error(`could not probe duration of ${key}.mp4`)
    timeline[key].mediaMs = mediaMs

    console.log(`${(size / 1e6).toFixed(1)} MB  (${(mediaMs / 1000).toFixed(1)}s)`)
  }

  fs.writeFileSync(path.join(DEST, "timeline.json"), JSON.stringify(timeline, null, 2))
  console.log(`\nstaged ${Object.keys(timeline).length} chapters -> ${DEST}`)
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})

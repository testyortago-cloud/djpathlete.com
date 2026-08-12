/**
 * Convert the recorded chapter takes (VP8 .webm from Playwright) to .mp4 and
 * stage them, with the timeline, where Remotion's staticFile() can see them.
 *
 * Playwright only ever writes webm; Remotion is happier with h264. Uses the
 * ffmpeg-static binary already vendored for render-worker's face detection.
 *
 * Run: node scripts/prepare-walkthrough-media.mjs [--show <id>]
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import { resolveShow, showArg } from "./walkthroughs/registry.mjs"

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

/** Duration in ms straight from the RIFF header — no probe needed for a format
 *  we wrote ourselves. Mirrors synth-walkthrough-narration.mjs. */
function wavDurationMs(file) {
  const buf = fs.readFileSync(file)
  let byteRate = 0
  let dataBytes = 0
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16)
    if (id === "data") {
      dataBytes = size
      break
    }
    off += 8 + size + (size % 2)
  }
  if (!byteRate || !dataBytes) throw new Error(`could not size ${file}`)
  return Math.round((dataBytes / byteRate) * 1000)
}

const show = await resolveShow(showArg(process.argv.slice(2)))
const SRC = path.join(process.cwd(), ".playwright-out", show.dir)
const DEST = path.join(process.cwd(), "render-worker", "public", show.dir)

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
    // Cut the pre-login lead-in HERE rather than seeking past it in the edit.
    // OffthreadVideo seeking deep into a CFR-transcoded VFR capture is what
    // produced "No frame found at position ..." over and over; a clip that
    // starts exactly where the beats start is read sequentially from frame 0,
    // which is the case the compositor handles reliably.
    // -ss AFTER -i is the accurate (decode-and-discard) seek. As an INPUT
    // option it seeks to the nearest keyframe instead, which left the first
    // frames of a chapter undecodable — the compositor then died on the HEAD
    // of the clip, not its tail. These takes are ≤2 min, so the slower seek
    // costs seconds and removes the whole failure mode.
    const leadInS = Math.max(0, (timeline[key].leadInMs ?? 0) / 1000)
    await execFileP(ffmpegPath, [
      "-y",
      "-i", webm,
      "-ss", leadInS.toFixed(3),
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      // Playwright writes VARIABLE-frame-rate webm. "-r 30" alone does not make
      // the result reliably seekable — Remotion's compositor then fails with
      // "No frame found at position ..." partway through a clip. Force true CFR
      // and put a keyframe every second so any seek lands on one.
      // Freeze the last frame for an extra second so the decoder always has
      // material past anything the edit asks for. This failed when combined
      // with a mid-file seek; with the lead-in already cut above, the clip is
      // read straight through and the padding is simply extra tail.
      "-vf", "tpad=stop_mode=clone:stop_duration=1",
      "-fps_mode", "cfr",
      "-r", "30",
      // ALL-INTRA. Narrow --frames probes at every head and tail passed while
      // full renders kept dying at varying positions in already-probed
      // chapters: that is many threads seeking the same file at once, not one
      // bad frame. With every frame a keyframe there is no seek to get wrong.
      // These staged clips are a build artefact, so the size is irrelevant.
      "-g", "1",
      "-keyint_min", "1",
      "-sc_threshold", "0",
      "-movflags", "+faststart",
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

    // Container duration OVERSTATES what can actually be decoded: 08b-duplicates
    // reported 53.3s but died 35 frames early. Count the video frames instead —
    // that is the only number the compositor can be held to.
    const { stdout: fc } = await execFileP(
      ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace("ffmpeg", "ffprobe")),
      ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", mp4],
    ).catch(() => ({ stdout: "" }))
    const mediaFrames = parseInt(String(fc).trim(), 10)
    if (!Number.isFinite(mediaFrames) || mediaFrames <= 0) throw new Error(`could not count frames of ${key}.mp4`)
    timeline[key].mediaFrames = mediaFrames
    // The lead-in is already gone from the file, so the edit must NOT skip it
    // again. Only the staged copy is rewritten; the recorder's timeline keeps
    // the measured value so re-staging from source stays correct.
    timeline[key].leadInMs = 0

    console.log(`${(size / 1e6).toFixed(1)} MB  (${(mediaMs / 1000).toFixed(1)}s, ${mediaFrames} frames)`)
  }

  // Narration: copy the per-beat WAVs where staticFile() can reach them. Left
  // as WAV deliberately — these are short, Remotion mixes them directly, and a
  // second lossy pass before the final encode buys nothing but artefacts.
  const audioSrc = path.join(SRC, "audio")
  const audioDest = path.join(DEST, "audio")
  fs.rmSync(audioDest, { recursive: true, force: true })
  let copied = 0
  if (fs.existsSync(audioSrc)) {
    for (const chapter of fs.readdirSync(audioSrc)) {
      const dir = path.join(audioSrc, chapter)
      if (!fs.statSync(dir).isDirectory()) continue
      fs.mkdirSync(path.join(audioDest, chapter), { recursive: true })
      for (const wav of fs.readdirSync(dir).filter((f) => f.endsWith(".wav"))) {
        fs.copyFileSync(path.join(dir, wav), path.join(audioDest, chapter, wav))
        copied++
      }
    }
  }

  // Stamp each beat with its narration length. A beat is held for
  // audio + BREATH_MS, so the clip is deliberately LONGER than its voice line;
  // without this the edit asks the compositor for samples past the end of the
  // WAV and the whole render dies with "No frame found at position ...".
  for (const key of Object.keys(timeline)) {
    for (const beat of timeline[key].beats ?? []) {
      if (!beat.audio) continue
      const wav = path.join(audioDest, beat.audio)
      if (fs.existsSync(wav)) beat.audioMs = wavDurationMs(wav)
    }
  }

  fs.writeFileSync(path.join(DEST, "timeline.json"), JSON.stringify(timeline, null, 2))
  console.log(`\nstaged ${Object.keys(timeline).length} chapters -> ${DEST}`)
  console.log(copied ? `narration: ${copied} beat clips` : "narration: none (captions only)")
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})

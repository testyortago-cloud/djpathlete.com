/**
 * Synthesize the walkthrough narration with the built-in Windows voice (SAPI),
 * one WAV per beat, then measure each one.
 *
 * Why per beat and not per chapter: the recorder holds each beat for exactly as
 * long as its narration takes, so the hold time IS the measured audio length.
 * A single chapter-long WAV would give us one number for five beats and the
 * footage would drift within the chapter — the same class of bug as the
 * caption/footage offset fixed on 2026-07-26.
 *
 * Emits walkthrough-narration.json: { "<chapterId>#<beatIndex>": ms }, which
 * walkthrough-script.mjs reads so the narration owns the clock. Beats are keyed
 * by position, not by a hash of the text, so editing a line's wording does not
 * silently orphan its audio — it just re-synthesizes on the next run.
 *
 * Free and offline: System.Speech ships with Windows, no API key, no network.
 *
 * Run: node scripts/synth-walkthrough-narration.mjs [--show <id>] [--voice "Microsoft Zira Desktop"] [--rate 0]
 */
import { execFile, execFileSync } from "node:child_process"
import { promisify } from "node:util"
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import { resolveShow, showArg } from "./walkthroughs/registry.mjs"

const execFileP = promisify(execFile)

const argv = process.argv.slice(2)
const show = await resolveShow(showArg(argv))
const CHAPTERS = show.CHAPTERS
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const VOICE = argOf("--voice", "Microsoft David Desktop")
const RATE = Number(argOf("--rate", "0")) // SAPI scale, -10..10

const OUT = path.join(process.cwd(), ".playwright-out", show.dir, "audio")
// Per show: the manifest is keyed "<chapterId>#<index>" and every show numbers
// its chapters from 01, so one shared file would hand a show another's hold
// times without anything looking wrong.
const MANIFEST = path.join(process.cwd(), "scripts", "narration", `${show.id}.json`)

function resolveFfprobe() {
  try {
    const require = createRequire(path.join(process.cwd(), "render-worker", "package.json"))
    const ffmpeg = require("ffmpeg-static")
    // ffprobe ships beside ffmpeg in some distributions; fall back to PATH.
    const guess = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, "ffprobe"))
    if (fs.existsSync(guess)) return guess
  } catch {
    /* fall through */
  }
  return "ffprobe"
}
const ffprobePath = resolveFfprobe()

/** Duration in ms, read from the WAV header — no ffprobe dependency needed. */
function wavDurationMs(file) {
  const buf = fs.readFileSync(file)
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`not a RIFF/WAVE file: ${file}`)
  }
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
    off += 8 + size + (size % 2) // chunks are word-aligned
  }
  if (!byteRate || !dataBytes) throw new Error(`could not size ${file}`)
  return Math.round((dataBytes / byteRate) * 1000)
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  // One PowerShell process synthesizes every beat: spinning up a synthesizer
  // per line costs more than the speech itself.
  const jobs = []
  for (const ch of CHAPTERS) {
    fs.mkdirSync(path.join(OUT, ch.id), { recursive: true })
    ch.beats.forEach((b, i) => {
      jobs.push({ key: `${ch.id}#${i}`, file: path.join(OUT, ch.id, `${String(i).padStart(2, "0")}.wav`), text: b.text })
    })
  }

  const jobsFile = path.join(OUT, "_jobs.json")
  fs.writeFileSync(jobsFile, JSON.stringify(jobs), "utf8")

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$jobs = Get-Content -Raw -LiteralPath '${jobsFile.replace(/'/g, "''")}' | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $synth.SelectVoice('${VOICE.replace(/'/g, "''")}') } catch { Write-Host "voice not found, using default" }
$synth.Rate = ${RATE}
foreach ($j in $jobs) {
  $synth.SetOutputToWaveFile($j.file)
  $synth.Speak($j.text)
}
$synth.SetOutputToNull()
$synth.Dispose()
Write-Host "synthesized $($jobs.Count) beats"
`.trim()

  const psFile = path.join(OUT, "_synth.ps1")
  fs.writeFileSync(psFile, ps, "utf8")
  console.log(`synthesizing ${jobs.length} beats with "${VOICE}" (rate ${RATE}) …`)
  const { stdout } = await execFileP("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    psFile,
  ])
  console.log(stdout.trim())

  const durations = {}
  let total = 0
  for (const j of jobs) {
    if (!fs.existsSync(j.file)) throw new Error(`missing audio for ${j.key}`)
    const ms = wavDurationMs(j.file)
    durations[j.key] = ms
    total += ms
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(durations, null, 2))

  console.log(`\n${Object.keys(durations).length} beats — ${(total / 1000 / 60).toFixed(1)} min of narration`)
  console.log(`manifest: ${MANIFEST}`)
  console.log(`audio:    ${OUT}`)
  void ffprobePath // kept for callers that want a container probe instead
  void execFileSync
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})

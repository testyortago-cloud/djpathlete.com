// functions/src/video-vision.ts
// Vision-based fallback handler for videos without usable audio/speech.
// Downloads the video from Firebase Storage, samples 8 evenly-spaced frames
// via ffmpeg, sends them to Claude Vision for a description, and writes the
// description to video_transcripts with source="vision" — downstream fanout
// then treats it like a normal transcript.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"
import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, createWriteStream } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Anthropic from "@anthropic-ai/sdk"
import ffmpegPath from "ffmpeg-static"
import { getSupabase } from "./lib/supabase.js"

const FRAME_COUNT = 8
const MODEL = "claude-sonnet-4-6"

const VISION_SYSTEM_PROMPT = `You are watching a training / coaching video and describing it for a content team who needs to write social-media captions about it. The video has no usable narration — you are the only source of information about what happens.

Given 8 evenly-spaced still frames, write a clear 4-8 sentence description of what is being demonstrated: exercise or drill name if identifiable, body positions, equipment, coaching cues you can infer. Be specific about fitness / S&C terminology (e.g. "scapular retraction", "hip hinge", "rotational medicine ball throw"). Do NOT guess at rep counts or exact angles. If multiple exercises appear, list them in order. If you cannot tell what the exercise is, describe what is visible ("athlete in plank position", "coach demonstrating band pull-apart") rather than inventing specifics.

Return only the description text, no preamble.`

export interface VideoVisionInput {
  videoUploadId: string
}

interface RunOpts {
  binary: string
  args: string[]
  cwd?: string
}

function runCommand({ binary, args, cwd }: RunOpts): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    const stderrChunks: Buffer[] = []
    child.stderr.on("data", (c) => stderrChunks.push(Buffer.from(c)))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) return resolve()
      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      reject(new Error(`${binary} exited ${code}: ${stderr.slice(0, 1000)}`))
    })
  })
}

async function downloadVideo(storagePath: string, destPath: string): Promise<void> {
  const bucket = getStorage().bucket()
  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(destPath)
    bucket
      .file(storagePath)
      .createReadStream()
      .on("error", reject)
      .pipe(writeStream)
      .on("finish", () => resolve())
      .on("error", reject)
  })
}

async function probeDuration(videoPath: string): Promise<number> {
  // Use ffmpeg to print duration (ffprobe isn't always bundled separately).
  // Fall back to a conservative 60s if we can't parse.
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath as string, ["-i", videoPath], { stdio: ["ignore", "ignore", "pipe"] })
    const chunks: Buffer[] = []
    child.stderr.on("data", (c) => chunks.push(Buffer.from(c)))
    child.on("close", () => {
      const out = Buffer.concat(chunks).toString("utf8")
      const match = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
      if (!match) return resolve(60)
      const [, h, m, s] = match
      resolve(parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s))
    })
  })
}

async function extractFrames(videoPath: string, framesDir: string): Promise<string[]> {
  mkdirSync(framesDir, { recursive: true })
  const duration = await probeDuration(videoPath)
  // Sample FRAME_COUNT evenly-spaced timestamps, avoiding the very start/end
  // which often contain title cards or black frames.
  const usableDuration = Math.max(duration - 1, 1)
  const interval = usableDuration / FRAME_COUNT
  const offsets = Array.from({ length: FRAME_COUNT }, (_, i) => 0.5 + interval * i)

  for (let i = 0; i < offsets.length; i++) {
    const out = join(framesDir, `frame_${String(i).padStart(2, "0")}.jpg`)
    await runCommand({
      binary: ffmpegPath as string,
      args: [
        "-ss",
        offsets[i].toFixed(2),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "4", // JPEG quality; 1=best, 31=worst. 4 is a good balance
        "-vf",
        "scale='min(960,iw)':'-2'", // cap width at 960px to keep tokens down
        "-y",
        out,
      ],
    })
  }

  return readdirSync(framesDir)
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f) => join(framesDir, f))
}

async function describeFrames(framePaths: string[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const client = new Anthropic({ apiKey })

  const content: Anthropic.ContentBlockParam[] = []
  for (const p of framePaths) {
    const b64 = readFileSync(p).toString("base64")
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: b64 },
    })
  }
  content.push({
    type: "text",
    text: "These are 8 evenly-spaced frames from a training video. Describe what is being demonstrated per the system instructions.",
  })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: VISION_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text block for vision description")
  }
  return textBlock.text.trim()
}

export async function handleVideoVision(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string, videoUploadId?: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (videoUploadId) {
      await supabase.from("video_uploads").update({ status: "failed" }).eq("id", videoUploadId)
    }
  }

  let videoUploadId: string | undefined
  let workDir: string | undefined

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) {
      await failJob("ai_jobs doc disappeared")
      return
    }
    videoUploadId = (data.input as VideoVisionInput)?.videoUploadId
    if (!videoUploadId) {
      await failJob("input.videoUploadId is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const { data: upload, error } = await supabase
      .from("video_uploads")
      .select("id, storage_path")
      .eq("id", videoUploadId)
      .single()
    if (error || !upload) {
      await failJob(`video_uploads row ${videoUploadId} not found`, videoUploadId)
      return
    }

    // Reset status to transcribing while the vision path runs — the UI shows a
    // spinner instead of a "failed" badge during the fallback.
    await supabase.from("video_uploads").update({ status: "transcribing" }).eq("id", videoUploadId)

    if (!ffmpegPath) throw new Error("ffmpeg-static binary path is null")

    workDir = mkdtempSync(join(tmpdir(), "vid-vision-"))
    const videoPath = join(workDir, "input.mp4")
    const framesDir = join(workDir, "frames")

    await downloadVideo(upload.storage_path, videoPath)
    const framePaths = await extractFrames(videoPath, framesDir)
    if (framePaths.length === 0) {
      await failJob("ffmpeg extracted zero frames", videoUploadId)
      return
    }

    const description = await describeFrames(framePaths)
    if (!description || description.length < 30) {
      await failJob("Claude vision returned empty description", videoUploadId)
      return
    }

    await supabase.from("video_transcripts").insert({
      video_upload_id: videoUploadId,
      transcript_text: `[VIDEO DESCRIPTION — no speech detected; generated from video frames]\n\n${description}`,
      language: "en",
      assemblyai_job_id: null,
      analysis: null,
      source: "vision",
    })
    await supabase.from("video_uploads").update({ status: "transcribed" }).eq("id", videoUploadId)

    await jobRef.update({
      status: "completed",
      result: { videoUploadId, source: "vision" },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await failJob((err as Error).message ?? "Unknown video-vision error", videoUploadId)
  } finally {
    if (workDir) {
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
    }
  }
}

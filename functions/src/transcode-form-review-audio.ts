// Server-side transcode for form-review voice messages.
//
// Why: Chrome on PC records via MediaRecorder as audio/webm;codecs=opus, which
// iOS Safari cannot decode (Apple ships no WebM/Opus codec on iOS). The coach
// records on PC, the client opens on their iPhone, and the <audio> element
// renders controls but plays nothing.
//
// Fix: When a *.webm lands in form-review-audio/, transcode to AAC in an mp4
// container (.m4a) — playable by every modern browser including iOS Safari —
// and rewrite the form_review_message_attachments row to point at the new
// file. The original webm is deleted to avoid double-storage cost.
//
// Race window: ~2-5s between upload and DB update. If the recipient opens the
// page during that window, they see the original webm path; a refresh after
// transcoding finishes gives them the m4a. For the typical coach → client
// async flow, the recipient is rarely staring at the page at the exact moment
// of upload.

import { spawn } from "node:child_process"
import { createWriteStream, readFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getStorage } from "firebase-admin/storage"
import ffmpegPath from "ffmpeg-static"
import { getSupabase } from "./lib/supabase.js"

interface RunOpts {
  binary: string
  args: string[]
}

function runFfmpeg({ binary, args }: RunOpts): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] })
    const stderrChunks: Buffer[] = []
    child.stderr.on("data", (c) => stderrChunks.push(Buffer.from(c)))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) return resolve()
      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 1000)}`))
    })
  })
}

async function downloadFromStorage(storagePath: string, destPath: string): Promise<void> {
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

async function uploadToStorage(localPath: string, storagePath: string, contentType: string): Promise<void> {
  const bucket = getStorage().bucket()
  await bucket.upload(localPath, {
    destination: storagePath,
    metadata: { contentType },
  })
}

export async function transcodeFormReviewAudio(storagePath: string, originalContentType: string): Promise<void> {
  // Only act on webm; everything else is already iOS-compatible (mp4, ogg fallback).
  if (!storagePath.endsWith(".webm") && !originalContentType.startsWith("audio/webm")) {
    return
  }

  if (!ffmpegPath) throw new Error("ffmpeg-static binary path is null")

  const baseName = storagePath.replace(/\.webm$/, "")
  const newStoragePath = `${baseName}.m4a`
  const newMimeType = "audio/mp4"

  const tmpInput = join(tmpdir(), `frv-${Date.now()}-in.webm`)
  const tmpOutput = join(tmpdir(), `frv-${Date.now()}-out.m4a`)

  try {
    await downloadFromStorage(storagePath, tmpInput)

    // Mono 22050Hz AAC at 64kbps — voice-quality, small file. Same parameters
    // give a ~30-second clip in ~250KB, comfortably under the 3MB cap.
    await runFfmpeg({
      binary: ffmpegPath,
      args: [
        "-i", tmpInput,
        "-vn", // discard any video track
        "-c:a", "aac",
        "-b:a", "64k",
        "-ar", "22050",
        "-ac", "1",
        "-movflags", "+faststart",
        "-y", // overwrite
        tmpOutput,
      ],
    })

    await uploadToStorage(tmpOutput, newStoragePath, newMimeType)

    const supabase = getSupabase()
    const { error } = await supabase
      .from("form_review_message_attachments")
      .update({ storage_path: newStoragePath, mime_type: newMimeType })
      .eq("storage_path", storagePath)
    if (error) {
      throw new Error(`Failed to update attachment row for ${storagePath}: ${error.message}`)
    }

    // Delete the original webm now that the row points at the m4a.
    try {
      await getStorage().bucket().file(storagePath).delete()
    } catch (err) {
      console.warn(`Failed to delete original webm ${storagePath}:`, (err as Error).message)
    }

    console.log(`[transcode-form-review-audio] ${storagePath} → ${newStoragePath} (${readFileSync(tmpOutput).length} bytes)`)
  } finally {
    for (const p of [tmpInput, tmpOutput]) {
      try {
        unlinkSync(p)
      } catch {
        // ignore — file may not exist if an earlier step failed
      }
    }
  }
}

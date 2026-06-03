// functions/src/split-reel-render-trigger.ts
// Handles ai_jobs docs of type "split_reel_render". Atomically claims the job
// (pending -> processing) to absorb at-least-once re-delivery, then launches the
// SAME render-worker Cloud Run Job with RENDER_MODE=split_reel so the worker takes
// the Split Reel path (face-detect -> load ready b-roll -> render SplitReel). The
// Job itself flips the doc to completed/failed when it finishes.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { JobsClient } from "@google-cloud/run"

const REGION = "us-central1"
const RENDER_JOB = "captioned-cut-render"

export async function handleSplitReelRender(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef)
    const data = snap.data()
    if (!data || data.status !== "pending") return false
    tx.update(jobRef, { status: "processing", updatedAt: FieldValue.serverTimestamp() })
    return true
  })
  if (!claimed) return // duplicate delivery — already claimed

  const data = (await jobRef.get()).data()!
  const videoUploadId = (data.input as { videoUploadId?: string })?.videoUploadId
  if (!videoUploadId) {
    await jobRef.update({
      status: "failed",
      error: "input.videoUploadId is required",
      updatedAt: FieldValue.serverTimestamp(),
    })
    return
  }

  try {
    const project = process.env.GCLOUD_PROJECT
    if (!project) throw new Error("GCLOUD_PROJECT not set")
    const client = new JobsClient()
    await client.runJob({
      name: `projects/${project}/locations/${REGION}/jobs/${RENDER_JOB}`,
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "AI_JOB_ID", value: jobId },
              { name: "VIDEO_UPLOAD_ID", value: videoUploadId },
              { name: "RENDER_MODE", value: "split_reel" },
            ],
          },
        ],
      },
    })
    // Do not await completion; the Job updates the doc when done.
  } catch (err) {
    await jobRef.update({
      status: "failed",
      error: `Failed to launch render job: ${(err as Error).message}`,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}

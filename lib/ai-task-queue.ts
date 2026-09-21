import { getFunctions } from "firebase-admin/functions"
import { getAdminApp } from "@/lib/firebase-admin"

/**
 * Cloud Tasks queues for the two long-running generation handlers.
 *
 * WHY THESE EXIST AT ALL: a Firestore `onDocumentCreated` trigger is capped at
 * 540s and the deploy rejects anything higher, so a generation that needs more
 * than 9 minutes cannot finish on that path — it gets hard-killed, the catch
 * never runs, and the job wedges in "processing" forever. Task-queue functions
 * get 1800s. The job doc is still the source of truth (in-flight dedup,
 * RTDB progress, the completion trigger all key on it); the task only carries
 * the id and triggers execution.
 *
 * The queue name is the exported function name in functions/src/index.ts, and
 * the queue is CREATED BY DEPLOYING that function. Enqueuing before that deploy
 * lands throws.
 */
export const GENERATION_QUEUES = {
  week: "weekGenerationTask",
  program: "programGenerationTask",
} as const

export type GenerationQueue = (typeof GENERATION_QUEUES)[keyof typeof GENERATION_QUEUES]

/**
 * Cloud Tasks cancels the request at its OWN deadline and marks the attempt
 * DEADLINE_EXCEEDED, regardless of the function's `timeoutSeconds` — and that
 * deadline DEFAULTS TO 600s. Leave it unset and a 25-minute budget quietly dies
 * at 10 minutes, which reads as the model hanging rather than a queue setting.
 * 1800s is the documented maximum (range: 15s to 30 minutes).
 *
 * Mirrors DISPATCH_DEADLINE_SECONDS in functions/src/lib/generation-budget.ts —
 * the twin exists because `functions/` has rootDir "src" and cannot import from
 * `lib/`. If you change one, change both.
 */
const DISPATCH_DEADLINE_SECONDS = 1800

/**
 * Hand a job to its queue.
 *
 * Throws on failure rather than swallowing: the caller has already written the
 * job doc, and a doc that no task will ever pick up is an invisible failure —
 * the coach watches a spinner that never resolves. Callers mark the job failed
 * and answer with an error instead.
 *
 * `FIREBASE_GENERATION_TASK_URI_BASE` is optional. When unset, the Admin SDK
 * resolves the function's URL through the Cloud Functions API, which needs
 * `cloudfunctions.functions.get` on the service account in addition to
 * `cloudtasks.tasks.create`. Set it (e.g.
 * "https://us-central1-<project>.cloudfunctions.net") to skip that lookup and
 * the extra permission.
 */
export async function enqueueGenerationTask(queue: GenerationQueue, jobId: string): Promise<void> {
  getAdminApp()
  const uriBase = process.env.FIREBASE_GENERATION_TASK_URI_BASE?.replace(/\/+$/, "")

  await getFunctions()
    .taskQueue<{ jobId: string }>(queue)
    .enqueue(
      { jobId },
      {
        dispatchDeadlineSeconds: DISPATCH_DEADLINE_SECONDS,
        ...(uriBase ? { uri: `${uriBase}/${queue}` } : {}),
      },
    )
}

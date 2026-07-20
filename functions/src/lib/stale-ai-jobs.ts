/**
 * Stale ai_jobs reaper — pure selection logic.
 *
 * A Cloud Function that is hard-killed (platform timeout, OOM, crash) never runs
 * its catch block, so the ai_jobs doc keeps whatever in-flight status it had.
 * The onDocumentCreated guard (`if (job.status !== "pending") return`) then makes
 * the job unrecoverable: any trigger retry sees "processing" and skips. Observed
 * in prod as a week_generation job sitting in "processing" for 13 hours with the
 * UI spinning on it.
 *
 * Handlers that own a wall-clock budget (see deadline.ts) now fail themselves
 * cleanly. This reaper is the safety net for everything else — and for the
 * failure modes no in-process guard can catch, like OOM.
 */

/** In-flight states. A job in any other state is settled and never reaped. */
const REAPABLE_STATUSES = new Set(["pending", "processing", "streaming"])

/**
 * Default grace for handlers that finish inside their own function invocation.
 * The longest such timeout is weekGeneration at 1500s (25 min), so 45 min leaves
 * a wide margin — the reaper must never race a job that is genuinely still running.
 */
export const DEFAULT_STALE_MS = 45 * 60_000

/**
 * Job types whose function only DISPATCHES work and returns; the doc is later
 * completed by an external worker (Cloud Run Job) or an inbound webhook. These
 * sit in "processing" with no heartbeat for as long as the external work takes,
 * so they get a much longer grace. They are still reaped eventually — a dropped
 * webhook is exactly the wedge worth clearing, just not at 45 minutes.
 */
export const EXTERNALLY_COMPLETED_TYPES = new Set([
  "split_reel_render", // Cloud Run Job updates the doc when done
  "video_caption_render", // Cloud Run Job updates the doc when done
  "broll_generation", // fal.ai webhook completes it
  "video_transcription", // AssemblyAI webhook completes it
])

/** Grace for the externally-completed types above. */
export const EXTERNAL_STALE_MS = 6 * 60 * 60_000

export interface StaleJobCandidate {
  id: string
  type?: string | null
  status?: string | null
  /** Millis. The liveness signal — a frozen updatedAt is what "wedged" looks like. */
  updatedAtMs?: number | null
  createdAtMs?: number | null
}

export interface StaleJobVerdict {
  id: string
  type: string
  /** How long the job sat untouched, for the log line and the error message. */
  staleForMs: number
  graceMs: number
  reason: string
}

export function graceMsForType(type: string | null | undefined): number {
  return type && EXTERNALLY_COMPLETED_TYPES.has(type) ? EXTERNAL_STALE_MS : DEFAULT_STALE_MS
}

/**
 * Pick the jobs that are provably dead. Conservative by construction: anything
 * ambiguous is left alone, because wrongly failing a live job destroys work
 * while leaving a wedged one merely delays cleanup to the next run.
 */
export function selectStaleJobs(candidates: StaleJobCandidate[], nowMs: number): StaleJobVerdict[] {
  const out: StaleJobVerdict[] = []

  for (const job of candidates) {
    if (!job.status || !REAPABLE_STATUSES.has(job.status)) continue

    // updatedAt is the liveness signal; fall back to createdAt for docs whose
    // handler never wrote anything at all.
    const lastTouchedMs = job.updatedAtMs ?? job.createdAtMs ?? null

    // No usable timestamp: a serverTimestamp that has not materialized yet reads
    // as null, and that is indistinguishable from a doc written seconds ago.
    // Skipping costs one cron cycle; guessing could kill a job mid-flight.
    if (lastTouchedMs == null) continue

    // Clock skew or a future-dated write — treat as fresh, never as stale.
    const staleForMs = nowMs - lastTouchedMs
    if (staleForMs <= 0) continue

    const graceMs = graceMsForType(job.type)
    if (staleForMs <= graceMs) continue

    const type = job.type ?? "unknown"
    out.push({
      id: job.id,
      type,
      staleForMs,
      graceMs,
      reason:
        `Job was left in "${job.status}" with no update for ${Math.round(staleForMs / 60_000)} min ` +
        `(grace ${Math.round(graceMs / 60_000)} min). The worker was terminated before it could report a result — ` +
        `no partial work was saved. Safe to retry.`,
    })
  }

  return out
}

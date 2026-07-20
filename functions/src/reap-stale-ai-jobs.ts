// Marks wedged ai_jobs docs as failed so the UI stops spinning on work that
// will never finish. See lib/stale-ai-jobs.ts for why they wedge and how the
// grace periods are chosen.

import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { selectStaleJobs, graceMsForType, type StaleJobCandidate } from "./lib/stale-ai-jobs.js"

/** In-flight statuses, mirrored from the pure module's REAPABLE_STATUSES. */
const IN_FLIGHT_STATUSES = ["pending", "processing", "streaming"]

/** Bounds a single run; far above any plausible backlog. */
const SCAN_LIMIT = 500

function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis()
  const maybe = value as { toMillis?: () => number } | null
  if (maybe && typeof maybe.toMillis === "function") return maybe.toMillis()
  if (typeof value === "number") return value
  return null
}

export interface ReapResult {
  scanned: number
  reaped: number
  skippedRaced: number
  byType: Record<string, number>
  ids: string[]
}

export async function reapStaleAiJobs(nowMs: number = Date.now()): Promise<ReapResult> {
  const db = getFirestore()

  const snap = await db.collection("ai_jobs").where("status", "in", IN_FLIGHT_STATUSES).limit(SCAN_LIMIT).get()

  const candidates: StaleJobCandidate[] = snap.docs.map((doc) => ({
    id: doc.id,
    type: doc.get("type") ?? null,
    status: doc.get("status") ?? null,
    updatedAtMs: toMillis(doc.get("updatedAt")),
    createdAtMs: toMillis(doc.get("createdAt")),
  }))

  const verdicts = selectStaleJobs(candidates, nowMs)

  const result: ReapResult = {
    scanned: candidates.length,
    reaped: 0,
    skippedRaced: 0,
    byType: {},
    ids: [],
  }

  for (const verdict of verdicts) {
    const ref = db.collection("ai_jobs").doc(verdict.id)

    // Re-check inside a transaction: between the scan and this write the real
    // handler may have finished. Overwriting a just-completed job with "failed"
    // would be a self-inflicted version of the bug being fixed.
    const wrote = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref)
      if (!fresh.exists) return false

      const status = fresh.get("status")
      if (typeof status !== "string" || !IN_FLIGHT_STATUSES.includes(status)) return false

      const lastTouchedMs = toMillis(fresh.get("updatedAt")) ?? toMillis(fresh.get("createdAt"))
      if (lastTouchedMs == null) return false
      if (nowMs - lastTouchedMs <= graceMsForType(fresh.get("type"))) return false

      tx.update(ref, {
        status: "failed",
        error: verdict.reason,
        reapedBy: "reapStaleAiJobsCron",
        updatedAt: FieldValue.serverTimestamp(),
      })
      return true
    })

    if (!wrote) {
      result.skippedRaced++
      continue
    }

    result.reaped++
    result.ids.push(verdict.id)
    result.byType[verdict.type] = (result.byType[verdict.type] ?? 0) + 1

    // Several handlers mirror status to RTDB for the live client listener.
    // Best-effort: a mirror failure must not abort the sweep.
    try {
      await getDatabase()
        .ref(`ai_jobs/${verdict.id}`)
        .update({ status: "failed", error: verdict.reason, updatedAt: Date.now() })
    } catch (err) {
      console.warn(`[reapStaleAiJobs] RTDB mirror failed for ${verdict.id}:`, (err as Error).message)
    }

    console.log(
      `[reapStaleAiJobs] Reaped ${verdict.id} (${verdict.type}) — stale ${Math.round(verdict.staleForMs / 60_000)} min`,
    )
  }

  return result
}

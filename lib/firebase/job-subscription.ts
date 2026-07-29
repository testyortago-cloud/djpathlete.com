"use client"

import { doc, getDoc, onSnapshot } from "firebase/firestore"
import { db } from "@/lib/firebase"

/**
 * Subscribe to an AI job's live state over **Firestore**.
 *
 * Deliberately not RTDB. `wss://*.firebaseio.com` silently fails to deliver
 * updates in some browser/network setups even when CSP allows it — the job
 * runs to completion server-side while the browser is told nothing, so any
 * dialog waiting on `onValue` hangs forever with no error to show. The jobs
 * dock hit this and moved to Firestore's long-poll; this is the same move,
 * packaged so the import dialogs can share it.
 *
 * Three delivery paths, because a stream alone is not enough:
 *  1. `getDoc` immediately — covers subscribing AFTER the job already ended,
 *     when the stream has no future event left to send.
 *  2. `onSnapshot` — the live updates.
 *  3. `getDoc` on tab re-focus — covers a backgrounded tab whose stream was
 *     paused while the job finished.
 */

export interface JobSnapshot {
  status?: "pending" | "processing" | "streaming" | "completed" | "failed" | "cancelled" | string
  progress?: {
    status?: string
    current_step?: number
    total_steps?: number
    detail?: string | null
  }
  result?: unknown
  error?: string | null
}

export function subscribeToJob(
  jobId: string,
  onData: (job: JobSnapshot) => void,
  onError?: (err: unknown) => void,
): () => void {
  const jobRef = doc(db, "ai_jobs", jobId)
  let stopped = false

  function deliver(data: JobSnapshot | undefined) {
    // Callers unsubscribe on terminal status; an in-flight getDoc must not
    // deliver after that and revive a settled dialog.
    if (stopped || !data) return
    onData(data)
  }

  function readOnce() {
    getDoc(jobRef)
      .then((snap) => {
        if (snap.exists()) deliver(snap.data() as JobSnapshot)
      })
      .catch(() => {
        // The live listener owns error reporting — a failed catch-up read is
        // not itself a reason to fail the dialog.
      })
  }

  readOnce()

  const unsubscribe = onSnapshot(
    jobRef,
    (snap) => {
      if (snap.exists()) deliver(snap.data() as JobSnapshot)
    },
    (err) => {
      if (!stopped) onError?.(err)
    },
  )

  function handleVisibility() {
    if (document.visibilityState === "visible") readOnce()
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility)
  }

  return () => {
    stopped = true
    unsubscribe()
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }
}

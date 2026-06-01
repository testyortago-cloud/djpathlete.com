"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

/**
 * Lightweight global store for the floating jobs dock. Holds a list of
 * currently-tracked AI generation jobs so the dock UI can render a card
 * per job, listen to RTDB per-jobId, and survive page navigation /
 * dialog close.
 *
 * Persists to sessionStorage so a hard refresh re-hydrates in-flight jobs
 * (the Firebase function keeps running regardless of the browser, so the
 * dock just needs to re-subscribe).
 */

export type AiJobKind = "full_program" | "week" | "day"

export interface DockedJob {
  /** Firestore doc id — same id used in RTDB path `ai_jobs/{jobId}`. */
  jobId: string
  /** Semantic kind drives the icon + default label in the card. */
  kind: AiJobKind
  /** Short label shown in the card header (e.g. "Week 6", "Full program"). */
  label: string
  /** Program id when known — used to deep-link the card's "Open" button. */
  programId?: string
  /** ISO timestamp the job was added to the dock. Sorted desc by this. */
  startedAt: string
  /** Sticky completion / failure state so the card lingers after the RTDB
   *  doc clears (useful for "View result" or "Retry"). Auto-cleared when
   *  the user dismisses or after a 30s grace. */
  resolvedState?: "completed" | "failed" | "cancelled"
}

interface DockContextValue {
  jobs: DockedJob[]
  addJob: (job: Omit<DockedJob, "startedAt" | "resolvedState"> & { startedAt?: string }) => void
  markResolved: (jobId: string, state: "completed" | "failed" | "cancelled") => void
  removeJob: (jobId: string) => void
  clearResolved: () => void
}

const STORAGE_KEY = "djpathlete:ai-jobs-dock:v1"

const DockContext = createContext<DockContextValue | null>(null)

function loadFromStorage(): DockedJob[] {
  if (typeof window === "undefined") return []
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DockedJob[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function saveToStorage(jobs: DockedJob[]) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
  } catch {
    // Quota exceeded / disabled storage — accept the loss; dock falls back
    // to in-memory only for this session.
  }
}

export function AiJobsDockProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<DockedJob[]>(() => loadFromStorage())

  // Persist on every change.
  useEffect(() => {
    saveToStorage(jobs)
  }, [jobs])

  const addJob = useCallback<DockContextValue["addJob"]>((job) => {
    setJobs((prev) => {
      // De-dupe by jobId — second add of same id replaces the existing entry.
      const filtered = prev.filter((j) => j.jobId !== job.jobId)
      return [
        {
          ...job,
          startedAt: job.startedAt ?? new Date().toISOString(),
          resolvedState: undefined,
        },
        ...filtered,
      ]
    })
  }, [])

  const markResolved = useCallback<DockContextValue["markResolved"]>((jobId, state) => {
    setJobs((prev) =>
      prev.map((j) => (j.jobId === jobId ? { ...j, resolvedState: state } : j)),
    )
  }, [])

  const removeJob = useCallback<DockContextValue["removeJob"]>((jobId) => {
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId))
  }, [])

  const clearResolved = useCallback<DockContextValue["clearResolved"]>(() => {
    setJobs((prev) => prev.filter((j) => !j.resolvedState))
  }, [])

  const value = useMemo<DockContextValue>(
    () => ({ jobs, addJob, markResolved, removeJob, clearResolved }),
    [jobs, addJob, markResolved, removeJob, clearResolved],
  )

  return <DockContext.Provider value={value}>{children}</DockContext.Provider>
}

export function useAiJobsDock(): DockContextValue {
  const ctx = useContext(DockContext)
  if (!ctx) {
    // Provider missing — return a no-op so callers don't crash outside the
    // admin tree. The dock simply doesn't show up.
    return {
      jobs: [],
      addJob: () => {},
      markResolved: () => {},
      removeJob: () => {},
      clearResolved: () => {},
    }
  }
  return ctx
}

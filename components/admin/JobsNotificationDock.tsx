"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ref, onValue, get } from "firebase/database"
import { Loader2, CheckCircle2, XCircle, X, Sparkles, ChevronDown, ChevronUp } from "lucide-react"
import { rtdb } from "@/lib/firebase"
import { useAiJobsDock, type DockedJob } from "@/hooks/use-ai-jobs-dock"

/**
 * Floating bottom-right notification dock for AI generation jobs.
 * Persists across admin pages (mounted in app/(admin)/admin/layout.tsx) so
 * an admin can fire off a generation, close the dialog, and watch progress
 * here without staying on one page.
 *
 * Each card subscribes to its own RTDB node so realtime updates land
 * instantly. When a job resolves, the card lingers for 30s with a
 * success/failure state so the admin can click through to the result.
 */

const AUTO_DISMISS_AFTER_MS = 30_000

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  return `${hr}h ago`
}

interface RtdbJobState {
  status?: "pending" | "processing" | "completed" | "failed" | "cancelled"
  progress?: { status?: string; current_step?: number; total_steps?: number }
  result?: Record<string, unknown> | null
  error?: string | null
}

function JobCard({ job }: { job: DockedJob }) {
  const { markResolved, removeJob } = useAiJobsDock()
  const [state, setState] = useState<RtdbJobState>({ status: "pending" })
  const [tick, setTick] = useState(0)

  // Re-render every 5s so relativeTime updates while card is mounted.
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 5_000)
    return () => clearInterval(i)
  }, [])
  void tick

  // RTDB subscription. Only active while the dock entry hasn't resolved —
  // once resolved=true, the card displays the sticky outcome from the store.
  //
  // Belt-and-braces design: onValue gives realtime updates while the tab
  // stays connected, but Firebase's websocket can miss updates if the tab
  // was backgrounded or the connection dropped mid-job. So on mount AND
  // whenever the tab regains visibility, we also run a one-shot get() to
  // reconcile against the current server value. Without this, a job that
  // completes while the tab is asleep stays stuck in "Working" forever.
  useEffect(() => {
    if (job.resolvedState) return
    const jobRef = ref(rtdb, `ai_jobs/${job.jobId}`)

    const applyVal = (val: RtdbJobState | null) => {
      if (!val) return
      setState(val)
      if (val.status === "completed" || val.status === "failed" || val.status === "cancelled") {
        markResolved(job.jobId, val.status)
      }
    }

    // Realtime subscription. onValue returns the unsubscribe fn — call it
    // directly on cleanup. (Earlier code passed it to off() which was a
    // no-op and leaked the listener.)
    const unsubscribe = onValue(jobRef, (snap) => {
      applyVal((snap.val() ?? null) as RtdbJobState | null)
    })

    // Safety-net one-shot fetch. Catches the case where the websocket
    // missed an update before onValue attached.
    get(jobRef)
      .then((snap) => applyVal((snap.val() ?? null) as RtdbJobState | null))
      .catch(() => {})

    // Re-sync on tab visibility restore — handles the "I left the tab
    // backgrounded while the job finished" case.
    const onVisible = () => {
      if (typeof document === "undefined" || document.hidden) return
      get(jobRef)
        .then((snap) => applyVal((snap.val() ?? null) as RtdbJobState | null))
        .catch(() => {})
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible)
    }

    return () => {
      unsubscribe()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible)
      }
    }
  }, [job.jobId, job.resolvedState, markResolved])

  // Auto-dismiss after grace period once resolved.
  useEffect(() => {
    if (!job.resolvedState) return
    const t = setTimeout(() => removeJob(job.jobId), AUTO_DISMISS_AFTER_MS)
    return () => clearTimeout(t)
  }, [job.resolvedState, job.jobId, removeJob])

  const effectiveStatus = job.resolvedState ?? state.status ?? "pending"
  const isRunning = effectiveStatus === "pending" || effectiveStatus === "processing"
  const isDone = effectiveStatus === "completed"
  const isFailed = effectiveStatus === "failed"

  const result = state.result as { program_id?: string; new_week_number?: number } | null
  const programId = result?.program_id ?? job.programId

  const linkHref = programId ? `/admin/programs/${programId}` : null

  const tone = isDone
    ? "border-success/40 bg-success/5"
    : isFailed
      ? "border-error/40 bg-error/5"
      : "border-border bg-card"

  return (
    <div
      className={`relative rounded-xl border ${tone} p-3 shadow-sm transition-all`}
    >
      <button
        type="button"
        onClick={() => removeJob(job.jobId)}
        className="absolute top-1.5 right-1.5 rounded-md p-0.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-2.5 pr-5">
        <div className="mt-0.5 shrink-0">
          {isRunning ? (
            <Loader2 className="size-4 animate-spin text-accent" />
          ) : isDone ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : (
            <XCircle className="size-4 text-error" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground leading-snug">
            {job.label}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
            {isRunning ? (
              <>
                {state.progress?.status ?? "Working"}
                {state.progress?.current_step != null && state.progress?.total_steps
                  ? ` · step ${state.progress.current_step}/${state.progress.total_steps}`
                  : ""}
                {" · "}
                {relativeTime(job.startedAt)}
              </>
            ) : isDone ? (
              <>Ready · {relativeTime(job.startedAt)}</>
            ) : (
              <span className="text-error">
                Failed
                {state.error ? ` · ${state.error.slice(0, 60)}` : ""}
              </span>
            )}
          </p>

          {(isDone || isFailed) && linkHref ? (
            <Link
              href={linkHref}
              onClick={() => removeJob(job.jobId)}
              className="mt-1.5 inline-flex items-center text-[11px] font-medium text-accent hover:underline"
            >
              {isDone ? "Open →" : "View →"}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function JobsNotificationDock() {
  const { jobs, clearResolved } = useAiJobsDock()
  const [collapsed, setCollapsed] = useState(false)

  if (jobs.length === 0) return null

  const runningCount = jobs.filter((j) => !j.resolvedState).length
  const resolvedCount = jobs.length - runningCount

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[320px] max-w-[calc(100vw-2rem)] space-y-2 pointer-events-none"
      role="region"
      aria-label="AI generation status"
    >
      <div className="pointer-events-auto rounded-xl border border-border bg-card/95 backdrop-blur-sm px-3 py-2 shadow-sm flex items-center gap-2">
        <Sparkles className="size-3.5 text-accent" />
        <span className="text-xs font-medium text-foreground">
          {runningCount > 0
            ? `${runningCount} generating${resolvedCount > 0 ? ` · ${resolvedCount} done` : ""}`
            : `${jobs.length} done`}
        </span>
        <div className="flex-1" />
        {resolvedCount > 0 ? (
          <button
            type="button"
            onClick={clearResolved}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear done
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-md p-0.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {!collapsed ? (
        <div className="pointer-events-auto space-y-2 max-h-[60vh] overflow-y-auto">
          {jobs.map((job) => (
            <JobCard key={job.jobId} job={job} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

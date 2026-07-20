"use client"

import { useEffect, useState } from "react"

/**
 * Discovers a week/day generation that is ALREADY running for this
 * program/week/day when the dialog opens.
 *
 * Why: the dialogs gate their form on `isGenerating`, which is component state.
 * Close the dialog or reload the page and that state is gone, so the form comes
 * back and the coach can queue a second generation over a running one. This asks
 * the server instead, so a reopened dialog re-attaches to the live job.
 *
 * This is the UX half; the server route also refuses to create a duplicate and
 * returns the existing job. That one is authoritative — this just prevents the
 * coach from filling out a form whose submission would be deduped anyway.
 */
export function useInFlightWeekGeneration(params: {
  open: boolean
  programId: string
  targetWeekNumber: number | null
  targetDayOfWeek: number | null
}): { inFlightJobId: string | null; checking: boolean } {
  const { open, programId, targetWeekNumber, targetDayOfWeek } = params
  const [inFlightJobId, setInFlightJobId] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!open) {
      // Drop the previous answer so a reopen re-checks rather than showing a
      // stale "still running" for a job that has since finished.
      setInFlightJobId(null)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    async function check() {
      setChecking(true)
      try {
        const qs = new URLSearchParams()
        if (targetWeekNumber !== null) qs.set("target_week_number", String(targetWeekNumber))
        if (targetDayOfWeek !== null) qs.set("target_day_of_week", String(targetDayOfWeek))

        const res = await fetch(`/api/admin/programs/${programId}/generate-week?${qs.toString()}`, {
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setInFlightJobId(data?.inFlight?.jobId ?? null)
      } catch {
        // Fail open — never block the coach because a lookup failed.
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    void check()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, programId, targetWeekNumber, targetDayOfWeek])

  return { inFlightJobId, checking }
}

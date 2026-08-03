"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BOOKS_TOUR_STEPS } from "@/lib/bookkeeping/tour-steps"

const STORAGE_KEY = "books_tour_state"
const CHANGED_EVENT = "books-tour-changed"

export function startBooksTour(): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stepIndex: 0 }))
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

function readState(): { stepIndex: number } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { stepIndex?: unknown }
    return typeof parsed.stepIndex === "number" &&
      parsed.stepIndex >= 0 && parsed.stepIndex < BOOKS_TOUR_STEPS.length
      ? { stepIndex: parsed.stepIndex }
      : null
  } catch {
    return null
  }
}

export interface PageTourState {
  step: (typeof BOOKS_TOUR_STEPS)[number]
  stepIndex: number
  total: number
  targetRect: DOMRect | null
  next: () => void
  prev: () => void
  close: (opts?: { completed?: boolean }) => void
}

/** Active tour state for THIS page, or null (inactive / step lives elsewhere). */
export function usePageTour(pathname: string): PageTourState | null {
  const router = useRouter()
  const [stepIndex, setStepIndex] = useState<number | null>(null)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const rafRef = useRef(0)

  const sync = useCallback(() => setStepIndex(readState()?.stepIndex ?? null), [])
  useEffect(() => {
    sync()
    window.addEventListener(CHANGED_EVENT, sync)
    return () => window.removeEventListener(CHANGED_EVENT, sync)
  }, [sync])

  const step = stepIndex !== null ? BOOKS_TOUR_STEPS[stepIndex] : null
  const onThisPage = step !== null && step.page === pathname

  const measure = useCallback(() => {
    if (!step || !onThisPage) return
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`)
    setTargetRect(el ? el.getBoundingClientRect() : null)
  }, [step, onThisPage])

  // Scroll the target into view, then measure; skip a missing target so
  // markup drift can never hard-block the tour.
  useEffect(() => {
    if (!step || !onThisPage) return
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`)
    if (!el) {
      console.warn(`books tour: target "${step.id}" missing — skipping`)
      const nextIndex = (stepIndex ?? 0) + 1
      if (nextIndex < BOOKS_TOUR_STEPS.length) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stepIndex: nextIndex }))
        window.dispatchEvent(new Event(CHANGED_EVENT))
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
        window.dispatchEvent(new Event(CHANGED_EVENT))
      }
      return
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    const t = setTimeout(measure, 300)
    return () => clearTimeout(t)
  }, [step, onThisPage, stepIndex, measure])

  useEffect(() => {
    if (!onThisPage) return
    function onScrollResize() {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(measure)
    }
    window.addEventListener("scroll", onScrollResize, { passive: true })
    window.addEventListener("resize", onScrollResize)
    return () => {
      window.removeEventListener("scroll", onScrollResize)
      window.removeEventListener("resize", onScrollResize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [onThisPage, measure])

  const go = useCallback(
    (index: number) => {
      const target = BOOKS_TOUR_STEPS[index]
      if (!target) return
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stepIndex: index }))
      window.dispatchEvent(new Event(CHANGED_EVENT))
      if (target.page !== pathname) router.push(target.page)
    },
    [pathname, router],
  )

  const close = useCallback((opts?: { completed?: boolean }) => {
    sessionStorage.removeItem(STORAGE_KEY)
    window.dispatchEvent(new Event(CHANGED_EVENT))
    setTargetRect(null)
    if (opts?.completed) {
      void fetch("/api/admin/bookkeeping/setup-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tour_completed: true }),
      }).catch(() => {})
    }
  }, [])

  if (stepIndex === null || !step || !onThisPage) return null
  return {
    step,
    stepIndex,
    total: BOOKS_TOUR_STEPS.length,
    targetRect,
    next: () => (stepIndex < BOOKS_TOUR_STEPS.length - 1 ? go(stepIndex + 1) : close({ completed: true })),
    prev: () => stepIndex > 0 && go(stepIndex - 1),
    close,
  }
}

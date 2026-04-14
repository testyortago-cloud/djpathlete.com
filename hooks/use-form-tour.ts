"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import type { TourStep } from "@/types/tour"

export interface FormTourState {
  isActive: boolean
  currentIndex: number
  steps: TourStep[]
  targetRect: DOMRect | null
  containerRect: DOMRect | null
  start: () => void
  next: () => void
  prev: () => void
  close: () => void
}

interface UseFormTourOptions {
  steps: TourStep[]
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export function useFormTour({ steps, scrollContainerRef }: UseFormTourOptions): FormTourState {
  const [isActive, setIsActive] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null)
  const rafRef = useRef<number>(0)

  const measure = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || !isActive) return

    const step = steps[currentIndex]
    if (!step) return

    const targetEl = container.querySelector<HTMLElement>(`#${step.target}`)
    if (!targetEl) {
      // Target may be absent during a wizard step transition — don't skip here.
      // showStep handles retries and skipping. measure is for re-positioning only.
      return
    }

    const cRect = container.getBoundingClientRect()
    const tRect = targetEl.getBoundingClientRect()

    // Compute rect relative to the container's content (add scrollTop so
    // the absolutely-positioned highlight scrolls with the content)
    const relativeRect = new DOMRect(
      tRect.left - cRect.left,
      tRect.top - cRect.top + container.scrollTop,
      tRect.width,
      tRect.height,
    )

    setContainerRect(cRect)
    setTargetRect(relativeRect)
  }, [isActive, currentIndex, steps, scrollContainerRef])

  // Scroll target into view and measure after beforeShow
  const showStep = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current
      if (!container) return

      const step = steps[index]
      if (!step) return

      const hadBeforeShow = !!step.beforeShow

      // Run beforeShow (e.g. expand collapsible, navigate wizard step)
      step.beforeShow?.()

      // If beforeShow was called (e.g. wizard step change), the DOM needs time
      // for React re-render + AnimatePresence animation (~200-400ms).
      // Retry a few times before giving up.
      function findTarget(retriesLeft: number) {
        requestAnimationFrame(() => {
          if (!container) return
          const targetEl = container.querySelector<HTMLElement>(`#${step.target}`)
          if (!targetEl) {
            if (retriesLeft > 0) {
              // Retry after a short delay to allow animations to complete
              setTimeout(() => findTarget(retriesLeft - 1), 200)
              return
            }
            // Skip to next if target still doesn't exist
            if (index < steps.length - 1) {
              setCurrentIndex(index + 1)
            } else {
              setIsActive(false)
            }
            return
          }

          // Scroll target toward the top of the container so the tooltip
          // (which renders below) has room to display without being clipped.
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" })

          // Measure after scroll settles
          setTimeout(() => measure(), 300)
        })
      }

      // Allow retries when beforeShow was called (wizard transitions, collapsibles)
      findTarget(hadBeforeShow ? 3 : 0)
    },
    [steps, scrollContainerRef, measure],
  )

  // Re-measure on scroll and resize
  useEffect(() => {
    if (!isActive) return

    const container = scrollContainerRef.current
    if (!container) return

    function onScrollResize() {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(measure)
    }

    container.addEventListener("scroll", onScrollResize, { passive: true })
    window.addEventListener("resize", onScrollResize)

    return () => {
      container.removeEventListener("scroll", onScrollResize)
      window.removeEventListener("resize", onScrollResize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [isActive, measure, scrollContainerRef])

  // When currentIndex changes, show the step
  useEffect(() => {
    if (isActive) {
      showStep(currentIndex)
    }
  }, [isActive, currentIndex, showStep])

  const start = useCallback(() => {
    setCurrentIndex(0)
    setIsActive(true)
  }, [])

  const next = useCallback(() => {
    if (currentIndex < steps.length - 1) {
      setCurrentIndex((i) => i + 1)
    } else {
      setIsActive(false)
    }
  }, [currentIndex, steps.length])

  const prev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1)
    }
  }, [currentIndex])

  const close = useCallback(() => {
    setIsActive(false)
    setCurrentIndex(0)
    setTargetRect(null)
  }, [])

  return {
    isActive,
    currentIndex,
    steps,
    targetRect,
    containerRect,
    start,
    next,
    prev,
    close,
  }
}

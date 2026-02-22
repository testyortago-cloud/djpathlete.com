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
      // If target doesn't exist (conditional field), skip forward
      if (currentIndex < steps.length - 1) {
        setCurrentIndex((i) => i + 1)
      } else {
        setIsActive(false)
      }
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
      tRect.height
    )

    setContainerRect(cRect)
    setTargetRect(relativeRect)
  }, [isActive, currentIndex, steps, scrollContainerRef])

  // Scroll target into view and measure after beforeShow
  const showStep = useCallback((index: number) => {
    const container = scrollContainerRef.current
    if (!container) return

    const step = steps[index]
    if (!step) return

    // Run beforeShow (e.g. expand collapsible)
    step.beforeShow?.()

    // Wait a tick for DOM to update after beforeShow
    requestAnimationFrame(() => {
      const targetEl = container.querySelector<HTMLElement>(`#${step.target}`)
      if (!targetEl) {
        // Skip to next if target doesn't exist
        if (index < steps.length - 1) {
          setCurrentIndex(index + 1)
        } else {
          setIsActive(false)
        }
        return
      }

      targetEl.scrollIntoView({ behavior: "smooth", block: "center" })

      // Measure after scroll settles
      setTimeout(() => measure(), 300)
    })
  }, [steps, scrollContainerRef, measure])

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

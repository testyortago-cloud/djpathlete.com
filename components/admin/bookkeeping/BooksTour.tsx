"use client"

import { usePathname } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ChevronLeft, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePageTour } from "@/hooks/use-page-tour"

const spring = { type: "spring", stiffness: 350, damping: 30 } as const

export function BooksTour() {
  const pathname = usePathname()
  const tour = usePageTour(pathname ?? "")
  const reducedMotion = useReducedMotion()
  if (!tour || !tour.targetRect) return null
  const { step, stepIndex, total, targetRect, next, prev, close } = tour

  const hlTop = targetRect.top - 4
  const hlLeft = targetRect.left - 4
  const hlWidth = targetRect.width + 8
  const hlHeight = targetRect.height + 8
  // Tooltip below the highlight; clamp into the viewport.
  const tooltipTop = Math.min(hlTop + hlHeight + 8, window.innerHeight - 220)
  const tooltipLeft = Math.max(8, Math.min(hlLeft, window.innerWidth - 340))
  const transition = reducedMotion ? { duration: 0 } : spring

  return (
    <AnimatePresence>
      <motion.div key="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/30" onClick={() => close()} />
      <motion.div key="highlight" animate={{ top: hlTop, left: hlLeft, width: hlWidth, height: hlHeight }}
        transition={transition}
        className="fixed z-[61] rounded-md ring-2 ring-primary/70 bg-background/10 pointer-events-none" />
      <div key="tooltip" className="fixed z-[62] w-[min(330px,calc(100vw-2rem))]" style={{ top: tooltipTop, left: tooltipLeft }}>
        <motion.div key={stepIndex} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.18, delay: 0.08 }}
          className="rounded-lg border border-border bg-background shadow-lg p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{step.title}</p>
            <button aria-label="Close tour" onClick={() => close()} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">{step.body}</p>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground tabular-nums">{stepIndex + 1} of {total}</span>
            <div className="flex gap-1.5">
              {stepIndex > 0 && (
                <Button size="sm" variant="outline" onClick={prev}>
                  <ChevronLeft className="size-3.5" /> Back
                </Button>
              )}
              <Button size="sm" onClick={next}>{stepIndex === total - 1 ? "Done" : "Next"}</Button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

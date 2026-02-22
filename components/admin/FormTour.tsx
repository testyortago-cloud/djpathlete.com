"use client"

import { AnimatePresence, motion } from "framer-motion"
import { ChevronLeft, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { FormTourState } from "@/hooks/use-form-tour"

type FormTourProps = Pick<
  FormTourState,
  "isActive" | "currentIndex" | "steps" | "targetRect" | "containerRect" | "next" | "prev" | "close"
>

const spring = { type: "spring", stiffness: 350, damping: 30 } as const

export function FormTour({
  isActive,
  currentIndex,
  steps,
  targetRect,
  containerRect,
  next,
  prev,
  close,
}: FormTourProps) {
  const step = steps[currentIndex]
  if (!step || !targetRect) return null

  const containerHeight = containerRect?.height ?? 600
  const containerWidth = containerRect?.width ?? 400
  const scrollTop = containerRect ? 0 : 0 // rect already includes scrollTop from hook

  // Highlight bounds with padding
  const hlTop = targetRect.y - 4
  const hlLeft = targetRect.x - 4
  const hlWidth = targetRect.width + 8
  const hlHeight = targetRect.height + 8

  // Determine tooltip placement: above if target is in the lower 60% of visible area
  // We need the visual position (without scrollTop) to decide placement
  const visualTop = targetRect.y - (containerRect ? 0 : 0)
  const placeAbove = (hlTop + hlHeight) > containerHeight * 0.6

  const tooltipTop = placeAbove
    ? hlTop - 8 // tooltip bottom-anchored above the highlight
    : hlTop + hlHeight + 8

  const tooltipLeft = Math.max(8, Math.min(hlLeft, containerWidth - 308))

  return (
    <AnimatePresence>
      {isActive && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[60] pointer-events-auto"
            style={{ height: "200%" }} // cover full scroll height
            onClick={close}
          >
            <div className="absolute inset-0 bg-black/20 rounded-lg" />
          </motion.div>

          {/* Highlight ring — no key, smoothly animated between positions */}
          <motion.div
            animate={{
              top: hlTop,
              left: hlLeft,
              width: hlWidth,
              height: hlHeight,
            }}
            transition={spring}
            className="absolute z-[61] ring-2 ring-primary/60 bg-background rounded-md pointer-events-none"
          />

          {/* Tooltip — smoothly slides to follow the highlight */}
          <motion.div
            animate={{
              top: placeAbove ? undefined : tooltipTop,
              bottom: placeAbove ? containerHeight - hlTop + 8 : undefined,
              left: tooltipLeft,
              opacity: 1,
            }}
            initial={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
            className="absolute z-[62] w-[min(300px,calc(100%-2rem))] pointer-events-auto"
            style={placeAbove ? { top: "auto" } : { bottom: "auto" }}
          >
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, y: placeAbove ? 6 : -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: 0.08 }}
              className="rounded-lg border border-border bg-background shadow-lg p-3 space-y-2"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold text-foreground leading-tight">
                  {step.title}
                </h4>
                <button
                  type="button"
                  onClick={close}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {/* Description */}
              <p className="text-xs text-muted-foreground leading-relaxed">
                {step.description}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">
                  {currentIndex + 1} / {steps.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={prev}
                    disabled={currentIndex === 0}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={next}
                  >
                    {currentIndex === steps.length - 1 ? "Done" : "Next"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

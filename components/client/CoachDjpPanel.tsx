"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Brain,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Activity,
  Target,
  Zap,
  RotateCcw,
  Check,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useWeightUnit } from "@/hooks/use-weight-unit"

// ─── Types ──────────────────────────────────────────────────────────────────

interface CoachMetadata {
  plateau_detected: boolean
  suggested_weight_kg: number | null
  deload_recommended: boolean
  key_observations: string[]
}

interface CoachDjpPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  exerciseId: string
  exerciseName: string
  exerciseEquipment?: string | null
  onApplyWeight?: (weightKg: number) => void
  currentSets?: Array<{
    set_number: number
    weight_kg: number | null
    reps: number
    rpe: number | null
  }>
}

// ─── Loading phase config ───────────────────────────────────────────────────

const LOADING_PHASES = [
  { progress: 35, label: "Scanning training data..." },
  { progress: 65, label: "Identifying patterns..." },
  { progress: 90, label: "Generating recommendation..." },
] as const

const PHASE_DURATION = 1500 // ms per phase

const INSIGHT_ICONS = [TrendingUp, Activity, Target, Zap]

// ─── Streaming cursor ───────────────────────────────────────────────────────

function StreamingCursor() {
  return (
    <motion.span
      className="inline-block w-1.5 h-4 bg-primary/70 ml-0.5 align-middle rounded-[1px]"
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
    />
  )
}

// ─── Loading state ──────────────────────────────────────────────────────────

function AnalysisLoader({ phase }: { phase: number }) {
  const currentPhase = LOADING_PHASES[Math.min(phase, LOADING_PHASES.length - 1)]
  const showSkeletons = phase >= 1

  return (
    <div className="space-y-5 py-2">
      {/* Brain icon with orbiting dot */}
      <div className="flex justify-center">
        <div className="relative size-14">
          <motion.div
            className="size-14 rounded-full bg-primary/10 flex items-center justify-center"
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Brain className="size-7 text-primary" />
          </motion.div>
          <motion.div
            className="absolute size-2.5 rounded-full bg-accent"
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            style={{ top: -2, left: "50%", marginLeft: -5, transformOrigin: "5px 33px" }}
          />
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: "0%" }}
            animate={{
              width: `${currentPhase.progress}%`,
              ...(phase >= 2 ? { opacity: [1, 0.7, 1] } : {}),
            }}
            transition={{
              width: { duration: 0.8, ease: "easeOut" },
              opacity: { duration: 1.5, repeat: Infinity },
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{currentPhase.label}</p>
          <p className="text-xs font-medium text-muted-foreground">{currentPhase.progress}%</p>
        </div>
      </div>

      {/* Skeleton metric cards */}
      <AnimatePresence>
        {showSkeletons && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-3 gap-2"
          >
            {[TrendingUp, Activity, Target].map((Icon, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1, duration: 0.2 }}
                className="rounded-lg border border-border/50 p-3 space-y-2"
              >
                <Icon className="size-4 text-muted-foreground/50" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2 w-2/3" />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Alert card ─────────────────────────────────────────────────────────────

function AlertCard({
  type,
  delay = 0,
}: {
  type: "plateau" | "deload"
  delay?: number
}) {
  const config = {
    plateau: {
      icon: AlertTriangle,
      title: "PLATEAU DETECTED",
      description: "Stuck at same weight for 3+ sessions",
      borderColor: "border-l-warning",
      bgColor: "bg-warning/5",
      iconColor: "text-warning",
    },
    deload: {
      icon: TrendingDown,
      title: "DELOAD RECOMMENDED",
      description: "Performance declining or RPE consistently high",
      borderColor: "border-l-error",
      bgColor: "bg-error/5",
      iconColor: "text-error",
    },
  }[type]

  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay }}
      className={`rounded-lg p-3 border-l-[3px] ${config.borderColor} ${config.bgColor}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`size-4 shrink-0 mt-0.5 ${config.iconColor}`} />
        <div>
          <p className="text-xs font-semibold tracking-wide">{config.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Insight card ───────────────────────────────────────────────────────────

function InsightCard({
  observation,
  index,
}: {
  observation: string
  index: number
}) {
  const Icon = INSIGHT_ICONS[index % INSIGHT_ICONS.length]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.1 }}
      className="rounded-lg bg-white border border-border/50 p-3 flex items-start gap-2.5"
    >
      <div className="size-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="size-3.5 text-primary" />
      </div>
      <p className="text-sm text-foreground leading-relaxed">{observation}</p>
    </motion.div>
  )
}

// ─── Weight CTA ─────────────────────────────────────────────────────────────

function WeightCta({
  weightKg,
  onApply,
  remainingSets,
}: {
  weightKg: number
  onApply: () => void
  remainingSets: number
}) {
  const [applied, setApplied] = useState(false)
  const { formatWeight, formatWeightCompact } = useWeightUnit()

  function handleClick() {
    setApplied(true)
    setTimeout(() => onApply(), 600)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-3"
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {remainingSets > 0 ? "Recommended Weight" : "Weight for Next Session"}
        </p>
        <p className="text-2xl font-heading font-bold text-primary">
          {formatWeight(weightKg)}
        </p>
      </div>
      {remainingSets > 0 ? (
        <Button
          className="w-full gap-2"
          onClick={handleClick}
          disabled={applied}
        >
          <AnimatePresence mode="wait">
            {applied ? (
              <motion.span
                key="check"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-2"
              >
                <Check className="size-4" />
                Applied!
              </motion.span>
            ) : (
              <motion.span key="label" className="flex items-center gap-2">
                Apply {formatWeightCompact(weightKg)} to {remainingSets === 1 ? "Last Set" : `${remainingSets} Remaining Sets`}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          All sets completed — use this weight next session.
        </p>
      )}
    </motion.div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export function CoachDjpPanel({
  open,
  onOpenChange,
  exerciseId,
  exerciseName,
  exerciseEquipment,
  onApplyWeight,
  currentSets,
}: CoachDjpPanelProps) {
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState("")
  const [recommendation, setRecommendation] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<CoachMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingPhase, setLoadingPhase] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Advance loading phases while streaming hasn't started producing text
  useEffect(() => {
    if (streaming && !streamingText) {
      setLoadingPhase(0)
      phaseTimerRef.current = setInterval(() => {
        setLoadingPhase((prev) => Math.min(prev + 1, LOADING_PHASES.length - 1))
      }, PHASE_DURATION)
    }
    return () => {
      if (phaseTimerRef.current) clearInterval(phaseTimerRef.current)
    }
  }, [streaming, streamingText])

  const fetchAnalysis = useCallback(async () => {
    setStreaming(true)
    setStreamingText("")
    setRecommendation(null)
    setMetadata(null)
    setError(null)
    setLoadingPhase(0)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch("/api/client/workouts/ai-coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: exerciseId,
          ...(currentSets && currentSets.some((s) => s.reps > 0)
            ? { current_session: currentSets.filter((s) => s.reps > 0) }
            : {}),
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to get analysis")
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error("No response stream")

      const decoder = new TextDecoder()
      let accumulated = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const json = line.slice(6)

          try {
            const event = JSON.parse(json)

            if (event.type === "delta") {
              accumulated += event.text
              setStreamingText(accumulated)
            } else if (event.type === "done") {
              const separatorIndex = accumulated.indexOf("\n---\n")
              if (separatorIndex !== -1) {
                const recText = accumulated.slice(0, separatorIndex).trim()
                const jsonText = accumulated.slice(separatorIndex + 5).trim()
                setRecommendation(recText)
                try {
                  const parsed = JSON.parse(jsonText)
                  setMetadata({
                    plateau_detected: !!parsed.plateau_detected,
                    suggested_weight_kg: parsed.suggested_weight_kg ?? null,
                    deload_recommended: !!parsed.deload_recommended,
                    key_observations: Array.isArray(parsed.key_observations)
                      ? parsed.key_observations
                      : [],
                  })
                } catch {
                  setMetadata(null)
                }
              } else {
                setRecommendation(accumulated.trim())
              }
              setStreaming(false)
            } else if (event.type === "error") {
              throw new Error(event.message || "Stream error")
            }
          } catch (parseErr) {
            if (parseErr instanceof Error) {
              const msg = parseErr.message
              if (
                msg !== "Unexpected end of JSON input" &&
                !msg.startsWith("Unexpected token")
              ) {
                throw parseErr
              }
            }
          }
        }
      }

      // If stream ended without a done event
      if (!recommendation && accumulated.trim()) {
        const separatorIndex = accumulated.indexOf("\n---\n")
        if (separatorIndex !== -1) {
          setRecommendation(accumulated.slice(0, separatorIndex).trim())
          try {
            const parsed = JSON.parse(accumulated.slice(separatorIndex + 5).trim())
            setMetadata({
              plateau_detected: !!parsed.plateau_detected,
              suggested_weight_kg: parsed.suggested_weight_kg ?? null,
              deload_recommended: !!parsed.deload_recommended,
              key_observations: Array.isArray(parsed.key_observations)
                ? parsed.key_observations
                : [],
            })
          } catch {
            setMetadata(null)
          }
        } else {
          setRecommendation(accumulated.trim())
        }
      }

      setStreaming(false)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setError(err instanceof Error ? err.message : "An error occurred")
      setStreaming(false)
    }
  }, [exerciseId, recommendation, currentSets])

  useEffect(() => {
    if (open && !recommendation && !streaming && !error) {
      fetchAnalysis()
    }
  }, [open, recommendation, streaming, error, fetchAnalysis])

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      abortRef.current?.abort()
      abortRef.current = null
      if (phaseTimerRef.current) clearInterval(phaseTimerRef.current)
      setStreamingText("")
      setRecommendation(null)
      setMetadata(null)
      setError(null)
      setStreaming(false)
      setLoadingPhase(0)
    }
    onOpenChange(newOpen)
  }

  const isComplete = recommendation !== null
  const isLoading = streaming && !streamingText
  const isStreaming = streaming && !!streamingText

  // Strip metadata JSON from displayed streaming text
  const displayText = isComplete
    ? recommendation
    : streamingText.includes("\n---\n")
      ? streamingText.slice(0, streamingText.indexOf("\n---\n")).trim()
      : streamingText

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl max-h-[85dvh] overflow-y-auto px-0"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>

        <SheetHeader className="px-5 pb-2">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Brain className="size-5 text-primary" />
            </div>
            <div>
              <SheetTitle className="text-base font-heading">Coach DJP</SheetTitle>
              <SheetDescription className="text-xs">{exerciseName}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="px-5 pb-6">
          {/* Error state */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-destructive">Analysis Failed</p>
                <p className="text-xs text-destructive/80 mt-1">{error}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={fetchAnalysis}
                className="gap-1.5"
              >
                <RotateCcw className="size-3" />
                Try Again
              </Button>
            </div>
          )}

          {/* Loading animation */}
          <AnimatePresence mode="wait">
            {!error && isLoading && (
              <motion.div
                key="loader"
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <AnalysisLoader phase={loadingPhase} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Streaming + complete content */}
          <AnimatePresence>
            {!error && (isStreaming || isComplete) && (
              <motion.div
                key="content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                {/* Alert cards — only after complete */}
                {isComplete && metadata && (
                  <div className="space-y-2">
                    {metadata.plateau_detected && <AlertCard type="plateau" />}
                    {metadata.deload_recommended && (
                      <AlertCard type="deload" delay={0.1} />
                    )}
                  </div>
                )}

                {/* Recommendation text */}
                <div className="rounded-lg bg-surface/50 border border-border p-4">
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {displayText}
                    {isStreaming && <StreamingCursor />}
                  </p>
                </div>

                {/* Key insights — only after complete */}
                {isComplete && metadata && metadata.key_observations.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                        Key Insights
                      </p>
                      <Separator className="flex-1" />
                    </div>
                    <div className="space-y-2">
                      {metadata.key_observations.map((obs, idx) => (
                        <InsightCard key={idx} observation={obs} index={idx} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Weight CTA — only after complete with a suggested weight */}
                {isComplete &&
                  metadata?.suggested_weight_kg != null &&
                  onApplyWeight && (() => {
                    const remaining = currentSets
                      ? currentSets.filter((s) => s.reps === 0).length
                      : 0
                    return (
                      <WeightCta
                        weightKg={metadata.suggested_weight_kg!}
                        remainingSets={remaining}
                        onApply={() => {
                          onApplyWeight(metadata.suggested_weight_kg!)
                          handleOpenChange(false)
                        }}
                      />
                    )
                  })()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  )
}

"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { rtdb } from "@/lib/firebase"
import { ref, onValue, off } from "firebase/database"
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Clock,
  Brain,
  Globe,
  Lock,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Target,
  ClipboardList,
  Info,
  UserPlus,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { SPLIT_TYPES, PERIODIZATION_TYPES, PROGRAM_TIERS } from "@/lib/validators/program"
import {
  FITNESS_GOALS,
  GOAL_LABELS,
  SESSION_DURATIONS,
  EQUIPMENT_LABELS,
  LEVEL_LABELS,
  DAY_NAMES,
  TIME_EFFICIENCY_LABELS,
  TECHNIQUE_LABELS,
  GENDER_LABELS,
  MOVEMENT_CONFIDENCE_LABELS,
  SLEEP_LABELS,
  STRESS_LABELS,
  OCCUPATION_LABELS,
} from "@/lib/validators/questionnaire"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { parseProfileSummary, hasQuestionnaireData, type ProfileSummary } from "@/lib/profile-utils"
import { useFormTour } from "@/hooks/use-form-tour"
import { FormTour } from "@/components/admin/FormTour"
import { TourButton } from "@/components/admin/TourButton"
import { getAiGenerateTourSteps } from "@/lib/tour-steps"
import { AssignProgramDialog } from "@/components/admin/AssignProgramDialog"
import { TemplateSelector } from "@/components/admin/TemplateSelector"
import type { User, ClientProfile } from "@/types/database"
import { summarizeApiError } from "@/lib/errors/humanize"

// ─── Constants ───────────────────────────────────────────────────────────────

const SPLIT_TYPE_LABELS: Record<string, string> = {
  full_body: "Full Body",
  upper_lower: "Upper/Lower",
  push_pull_legs: "Push/Pull/Legs",
  push_pull: "Push/Pull",
  body_part: "Body Part",
  movement_pattern: "Movement Pattern",
  custom: "Custom",
}

const PERIODIZATION_LABELS: Record<string, string> = {
  linear: "Linear",
  undulating: "Undulating",
  block: "Block",
  reverse_linear: "Reverse Linear",
  none: "None",
}

const TIER_LABELS: Record<string, string> = {
  generalize: "Standard",
  premium: "Premium",
}

const TIER_DESCRIPTIONS: Record<string, string> = {
  generalize: "Client can log workouts and track progress",
  premium: "Everything in Standard, plus personalized AI coaching feedback",
}

const GENERATION_STEPS = [
  { key: "analyzing_profile", label: "Analyzing client profile", icon: Brain },
  { key: "profile_complete", label: "Profile analysis complete", icon: CheckCircle2 },
  { key: "designing_structure", label: "Designing program structure", icon: Sparkles },
  { key: "structure_complete", label: "Program structure ready", icon: CheckCircle2 },
  { key: "selecting_exercises", label: "Selecting exercises", icon: Zap },
  { key: "validated", label: "Exercises validated", icon: Target },
  { key: "saving_program", label: "Saving program", icon: Dumbbell },
]

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

const STEPS = [
  { label: "Client", number: 1 },
  { label: "Goals", number: 2 },
  { label: "Settings", number: 3 },
] as const

const stepVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
}

/**
 * Make validation issue messages more human-readable:
 * - "w3d2s4" → "Week 3, Day 2, Exercise 4"
 * - "leg_curl_machine" → "Leg Curl Machine"
 */
function formatIssueMessage(message: string): string {
  let formatted = message.replace(
    /\b(?:slot\s+)?w(\d+)d(\d+)s(\d+)\b/gi,
    (_match, week, day, slot) => `Week ${week}, Day ${day}, Exercise ${slot}`,
  )
  formatted = formatted.replace(
    /\b(?:requires\s+)(\w+(?:_\w+)+)\b/g,
    (_match, name: string) =>
      `requires ${name
        .split("_")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")}`,
  )
  return formatted
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

interface AiGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface GenerationResult {
  program_id: string
  validation: {
    pass: boolean
    issues: Array<{ type: string; category: string; message: string }>
    summary: string
  }
  token_usage: {
    agent1: number
    agent2: number
    agent3: number
    agent4: number
    total: number
  }
  duration_ms: number
  retries: number
}

export function AiGenerateDialog({ open, onOpenChange }: AiGenerateDialogProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [clients, setClients] = useState<User[]>([])
  const [loadingClients, setLoadingClients] = useState(false)

  // Wizard state
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)

  // Form state
  const [clientId, setClientId] = useState("")
  const [goals, setGoals] = useState<string[]>([])
  const [durationWeeks, setDurationWeeks] = useState(4)
  const [sessionsPerWeek, setSessionsPerWeek] = useState(3)
  const [sessionMinutes, setSessionMinutes] = useState(60)
  const [splitType, setSplitType] = useState("")
  const [periodization, setPeriodization] = useState("")
  const [additionalInstructions, setAdditionalInstructions] = useState("")
  const [ignoreProfile, setIgnoreProfile] = useState(false)
  const [selectedTier, setSelectedTier] = useState<string>("generalize")
  const [audience, setAudience] = useState<"private" | "public">("private")
  const [priceDollars, setPriceDollars] = useState("")

  // Profile state
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null)
  const [profileStatus, setProfileStatus] = useState<"idle" | "loading" | "found" | "not_found">("idle")
  const [summaryExpanded, setSummaryExpanded] = useState(false)

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [progressStep, setProgressStep] = useState(0)
  const [progressDetail, setProgressDetail] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const staleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastRtdbUpdateRef = useRef<number>(Date.now())
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAssign, setShowAssign] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  // Tour
  const stepRef = useRef(step)
  stepRef.current = step

  const tourGoToStep = useCallback((target: number) => {
    setDirection(target > stepRef.current ? 1 : -1)
    setStep(target)
  }, [])

  const tourSteps = useMemo(() => getAiGenerateTourSteps(tourGoToStep), [tourGoToStep])

  const tour = useFormTour({ steps: tourSteps, scrollContainerRef: dialogRef })

  // ─── Data fetching ────────────────────────────────────────────────────────

  const fetchClients = useCallback(async () => {
    setLoadingClients(true)
    try {
      const response = await fetch("/api/admin/users?role=client")
      if (response.ok) {
        const data = await response.json()
        setClients(data.users ?? data ?? [])
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingClients(false)
    }
  }, [])

  useEffect(() => {
    if (open) fetchClients()
  }, [open, fetchClients])

  // Fetch profile when client is selected
  useEffect(() => {
    if (!clientId) {
      setProfileSummary(null)
      setProfileStatus("idle")
      setSummaryExpanded(false)
      return
    }

    let cancelled = false

    async function fetchProfile() {
      setProfileStatus("loading")
      setProfileSummary(null)
      try {
        const response = await fetch(`/api/admin/questionnaires/${clientId}`)
        if (cancelled) return

        if (!response.ok) {
          setProfileStatus("not_found")
          return
        }

        const data = (await response.json()) as { profile: ClientProfile }
        if (cancelled) return

        const summary = parseProfileSummary(data.profile)

        if (!hasQuestionnaireData(data.profile)) {
          setProfileStatus("not_found")
          setProfileSummary(summary)
          return
        }

        setProfileSummary(summary)
        setProfileStatus("found")
        setSummaryExpanded(true)

        if (summary.goals.length > 0) setGoals(summary.goals)
        if (summary.preferredTrainingDays !== null) setSessionsPerWeek(summary.preferredTrainingDays)
        if (summary.preferredSessionMinutes !== null) setSessionMinutes(summary.preferredSessionMinutes)
      } catch {
        if (!cancelled) setProfileStatus("not_found")
      }
    }

    fetchProfile()
    return () => {
      cancelled = true
    }
  }, [clientId])

  useEffect(() => {
    return () => {
      stopListening()
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  // ─── Navigation ───────────────────────────────────────────────────────────

  function validateStep(s: number): boolean {
    if (s === 0) {
      if (clientId && profileStatus === "loading") {
        toast.error("Still loading questionnaire...")
        return false
      }
    }
    if (s === 1) {
      if (goals.length === 0) {
        toast.error("Please select at least one goal")
        return false
      }
      if (!durationWeeks || durationWeeks < 1) {
        toast.error("Duration must be at least 1 week")
        return false
      }
      if (!sessionsPerWeek || sessionsPerWeek < 1) {
        toast.error("Sessions per week must be at least 1")
        return false
      }
    }
    return true
  }

  function scrollToTop() {
    dialogRef.current?.scrollTo({ top: 0 })
  }

  function handleNext() {
    if (!validateStep(step)) return
    setDirection(1)
    setStep((s) => Math.min(s + 1, 2))
    scrollToTop()
  }

  function handleBack() {
    setDirection(-1)
    setStep((s) => Math.max(s - 1, 0))
    scrollToTop()
  }

  function goToStep(target: number) {
    if (target >= step) return
    setDirection(-1)
    setStep(target)
    scrollToTop()
  }

  // ─── Form helpers ─────────────────────────────────────────────────────────

  function resetForm() {
    stopListening()
    setStep(0)
    setDirection(1)
    setClientId("")
    setGoals([])
    setDurationWeeks(4)
    setSessionsPerWeek(3)
    setSessionMinutes(60)
    setSplitType("")
    setPeriodization("")
    setAdditionalInstructions("")
    setIgnoreProfile(false)
    setSelectedTier("generalize")
    setAudience("private")
    setPriceDollars("")
    setProfileSummary(null)
    setProfileStatus("idle")
    setSummaryExpanded(false)
    setResult(null)
    setError(null)
    setShowAssign(false)
    setIsGenerating(false)
    setIsCancelling(false)
    setActiveJobId(null)
    setProgressStep(0)
    setProgressDetail(null)
    setElapsedSeconds(0)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    tour.close()
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen && !isGenerating) resetForm()
    if (!isGenerating) onOpenChange(newOpen)
  }

  async function handleCancel() {
    if (!activeJobId || isCancelling) return
    setIsCancelling(true)
    try {
      const res = await fetch("/api/admin/programs/generate/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId }),
      })
      if (res.ok) {
        stopListening()
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setIsGenerating(false)
        setError(null)
        toast.info("Program generation cancelled")
        resetForm()
      } else {
        const data = await res.json()
        toast.error(data.error || "Failed to cancel")
      }
    } catch {
      toast.error("Failed to cancel generation")
    } finally {
      setIsCancelling(false)
    }
  }

  function toggleGoal(goal: string) {
    setGoals((prev) => (prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]))
  }

  const jobRefRef = useRef<ReturnType<typeof ref> | null>(null)

  function stopListening() {
    if (jobRefRef.current) {
      off(jobRefRef.current)
      jobRefRef.current = null
    }
    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }
    if (staleCheckRef.current) {
      clearInterval(staleCheckRef.current)
      staleCheckRef.current = null
    }
  }

  /** Firebase RTDB drops empty arrays, so issues/summary may be undefined after round-trip */
  function safeValidation(v: unknown): {
    pass: boolean
    issues: { type: string; category: string; message: string }[]
    summary: string
  } {
    const fallback = {
      pass: true,
      issues: [] as { type: string; category: string; message: string }[],
      summary: "Program generated successfully.",
    }
    if (!v || typeof v !== "object") return fallback
    const obj = v as Record<string, unknown>
    return {
      pass: typeof obj.pass === "boolean" ? obj.pass : true,
      issues: Array.isArray(obj.issues)
        ? obj.issues.map((i: Record<string, unknown>) => ({
            type: String(i.type ?? "warning"),
            category: String(i.category ?? "unknown"),
            message: String(i.message ?? ""),
          }))
        : [],
      summary: typeof obj.summary === "string" ? obj.summary : fallback.summary,
    }
  }

  function mapProgressToStep(progress?: {
    status: string
    current_step: number
    total_steps: number
    detail?: string
  }): { step: number; detail: string | null } {
    if (!progress) return { step: 0, detail: null }
    const idx = GENERATION_STEPS.findIndex((s) => s.key === progress.status)
    return { step: idx >= 0 ? idx + 1 : progress.current_step, detail: progress.detail ?? null }
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (goals.length === 0) {
      toast.error("Please select at least one goal")
      return
    }

    setIsGenerating(true)
    setError(null)
    setResult(null)
    setProgressStep(0)

    try {
      const body: Record<string, unknown> = {
        client_id: clientId || null,
        goals,
        duration_weeks: durationWeeks,
        sessions_per_week: sessionsPerWeek,
        session_minutes: sessionMinutes,
      }

      body.is_public = audience === "public"
      body.tier = selectedTier
      if (priceDollars) {
        const cents = Math.round(parseFloat(priceDollars) * 100)
        if (cents > 0) body.price_cents = cents
      }
      if (splitType) body.split_type = splitType
      if (periodization) body.periodization = periodization
      if (additionalInstructions.trim()) {
        body.additional_instructions = additionalInstructions.trim()
      }
      if (ignoreProfile) body.ignore_profile = true
      if (profileSummary && profileSummary.availableEquipment.length > 0 && !ignoreProfile) {
        body.equipment_override = profileSummary.availableEquipment
      }

      const response = await fetch("/api/admin/programs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const { message } = summarizeApiError(response, data, "Failed to generate program")
        throw new Error(message)
      }

      if (response.status === 202 && data.jobId) {
        // Store jobId for cancellation
        setActiveJobId(data.jobId)
        // Start elapsed timer
        setElapsedSeconds(0)
        timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)

        // Listen to RTDB job node for real-time progress
        const jobRef = ref(rtdb, `ai_jobs/${data.jobId}`)
        jobRefRef.current = jobRef
        lastRtdbUpdateRef.current = Date.now()

        const stopTimer = () => {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
        }

        // Stale check: if no RTDB update for 2 minutes, poll Firestore API
        staleCheckRef.current = setInterval(async () => {
          const staleSec = (Date.now() - lastRtdbUpdateRef.current) / 1000
          if (staleSec < 120) return
          try {
            const res = await fetch(`/api/ai-jobs/${data.jobId}`)
            if (!res.ok) return
            const jobStatus = await res.json()
            if (jobStatus.status === "completed" && jobStatus.result) {
              stopListening()
              stopTimer()
              setResult({
                program_id: jobStatus.result.program_id,
                validation: safeValidation(jobStatus.result.validation),
                token_usage: jobStatus.result.token_usage ?? { agent1: 0, agent2: 0, agent3: 0, agent4: 0, total: 0 },
                duration_ms: jobStatus.result.duration_ms ?? 0,
                retries: jobStatus.result.retries ?? 0,
              })
              setIsGenerating(false)
              toast.success("Program generated successfully!")
              router.refresh()
            } else if (jobStatus.status === "failed") {
              stopListening()
              stopTimer()
              setError(
                jobStatus.error || "Program generation failed — the server may have timed out. Please try again.",
              )
              setIsGenerating(false)
              toast.error("Program generation failed")
            } else if (staleSec >= 600) {
              // 10 minute hard timeout — function definitely timed out
              stopListening()
              stopTimer()
              setError("Program generation timed out. The server stopped responding. Please try again.")
              setIsGenerating(false)
              toast.error("Generation timed out")
            }
          } catch {
            // Polling failed, will retry next interval
          }
        }, 15000)

        onValue(
          jobRef,
          (snapshot) => {
            const jobData = snapshot.val()
            if (!jobData) return

            lastRtdbUpdateRef.current = Date.now()

            // Update step progress from orchestrator
            if (jobData.progress) {
              const { step, detail } = mapProgressToStep(jobData.progress)
              setProgressStep(step)
              setProgressDetail(detail)
            }

            if (jobData.status === "completed" && jobData.result) {
              stopListening()
              stopTimer()
              setResult({
                program_id: jobData.result.program_id,
                validation: safeValidation(jobData.result.validation),
                token_usage: jobData.result.token_usage ?? { agent1: 0, agent2: 0, agent3: 0, agent4: 0, total: 0 },
                duration_ms: jobData.result.duration_ms ?? 0,
                retries: jobData.result.retries ?? 0,
              })
              setIsGenerating(false)
              toast.success("Program generated successfully!")
              router.refresh()
            } else if (jobData.status === "failed") {
              stopListening()
              stopTimer()
              setError(jobData.error || "Program generation failed")
              setIsGenerating(false)
              toast.error("Program generation failed")
            } else if (jobData.status === "cancelled") {
              stopListening()
              stopTimer()
              setIsGenerating(false)
              toast.info("Program generation cancelled")
            }
          },
          (err) => {
            console.error("[AiGenerateDialog] RTDB listener error:", err)
            stopListening()
            stopTimer()
            setError("Lost connection to generation updates")
            setIsGenerating(false)
            toast.error("Connection lost")
          },
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred"
      setError(message)
      setIsGenerating(false)
      toast.error("Program generation failed")
      stopListening()
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  // Success — assign step
  if (result && showAssign) {
    return (
      <AssignProgramDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setShowAssign(false)
            handleOpenChange(false)
          }
        }}
        programId={result.program_id}
        priceCents={priceDollars ? Math.round(parseFloat(priceDollars) * 100) : null}
        clients={clients as User[]}
        assignedUserIds={[]}
      />
    )
  }

  // Success result view
  if (result) {
    const warningCount = result.validation.issues.filter((i) => i.type === "warning").length
    const errorCount = result.validation.issues.filter((i) => i.type === "error").length

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" />
              Program Generated
            </DialogTitle>
            <DialogDescription>{result.validation.summary}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {result.validation.pass ? (
                <Badge className="bg-success/10 text-success border-success/20">Validation Passed</Badge>
              ) : (
                <Badge variant="destructive">Validation Failed</Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="outline" className="gap-1">
                  <AlertTriangle className="size-3" />
                  {warningCount} warning{warningCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {errorCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="size-3" />
                  {errorCount} error{errorCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {result.validation.issues.length > 0 && (
              <div className="rounded-lg border border-border p-3 space-y-2 max-h-40 overflow-y-auto">
                {result.validation.issues.map((issue, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    {issue.type === "error" ? (
                      <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
                    )}
                    <span className="text-muted-foreground">{formatIssueMessage(issue.message)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-surface/50 border border-border p-3">
                <div className="text-xs text-muted-foreground">Tokens Used</div>
                <div className="text-sm font-medium font-heading">{result.token_usage.total.toLocaleString()}</div>
              </div>
              <div className="rounded-lg bg-surface/50 border border-border p-3">
                <div className="text-xs text-muted-foreground">Duration</div>
                <div className="text-sm font-medium font-heading">{Math.round(result.duration_ms / 1000)}s</div>
              </div>
              <div className="rounded-lg bg-surface/50 border border-border p-3">
                <div className="text-xs text-muted-foreground">Retries</div>
                <div className="text-sm font-medium font-heading">{result.retries}</div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
            <Button variant="outline" onClick={() => setShowAssign(true)}>
              <UserPlus className="size-4" />
              Assign to Clients
            </Button>
            <Link href={`/admin/programs/${result.program_id}`}>
              <Button>View Program</Button>
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Loading / generating view
  if (isGenerating) {
    const progressPercent = Math.round((progressStep / GENERATION_STEPS.length) * 100)
    const minutes = Math.floor(elapsedSeconds / 60)
    const seconds = elapsedSeconds % 60
    const timeDisplay = minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col py-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="size-4 text-primary animate-pulse" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-sm text-foreground">Generating Program</h3>
                  <p className="text-xs text-muted-foreground">
                    Step {progressStep} of {GENERATION_STEPS.length}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                <Clock className="size-3" />
                {timeDisplay}
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{progressPercent}%</p>
                {progressDetail && (
                  <p className="text-xs text-muted-foreground truncate max-w-[70%] text-right">{progressDetail}</p>
                )}
              </div>
            </div>

            {/* Step checklist */}
            <div className="space-y-1">
              {GENERATION_STEPS.map((s, idx) => {
                const stepNum = idx + 1
                const isComplete = progressStep > stepNum
                const isActive = progressStep === stepNum
                const isPending = progressStep < stepNum
                const StepIcon = s.icon

                return (
                  <div
                    key={s.key}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                      isActive && "bg-primary/5",
                      isPending && "opacity-40",
                    )}
                  >
                    {isComplete ? (
                      <CheckCircle2 className="size-4 text-primary shrink-0" />
                    ) : isActive ? (
                      <Loader2 className="size-4 text-primary animate-spin shrink-0" />
                    ) : (
                      <div className="size-4 rounded-full border border-muted-foreground/30 shrink-0" />
                    )}
                    <span
                      className={cn(
                        "text-sm",
                        isComplete && "text-muted-foreground",
                        isActive && "text-foreground font-medium",
                        isPending && "text-muted-foreground",
                      )}
                    >
                      {s.label}
                    </span>
                    {isActive && <StepIcon className="size-3.5 text-primary/60 ml-auto shrink-0" />}
                  </div>
                )
              })}
            </div>

            {/* Cancel button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={isCancelling}
              className="w-full text-muted-foreground hover:text-destructive hover:border-destructive/30"
            >
              {isCancelling ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <XCircle className="size-3.5 mr-1.5" />
              )}
              {isCancelling ? "Cancelling..." : "Cancel Generation"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // ─── Wizard form ──────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={dialogRef}
        className={cn("sm:max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden", tour.isActive && "pb-48")}
      >
        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <DialogTitle className="flex items-center gap-2 text-lg font-heading font-semibold text-foreground">
              <Sparkles className="size-5 text-accent" />
              AI Program Generator
            </DialogTitle>
            <TourButton onClick={tour.start} />
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {STEPS.map((s, idx) => (
              <button
                key={s.label}
                type="button"
                onClick={() => goToStep(idx)}
                disabled={idx > step}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  idx === step
                    ? "bg-primary text-primary-foreground"
                    : idx < step
                      ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                      : "bg-muted text-muted-foreground cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center size-4 rounded-full text-[10px] font-bold",
                    idx === step
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : idx < step
                        ? "bg-primary/20 text-primary"
                        : "bg-muted-foreground/20 text-muted-foreground",
                  )}
                >
                  {idx < step ? "\u2713" : s.number}
                </span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="min-h-[360px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeInOut" }}
            >
              {step === 0 && (
                <Step1Client
                  clients={clients}
                  loadingClients={loadingClients}
                  clientId={clientId}
                  setClientId={setClientId}
                  profileStatus={profileStatus}
                  profileSummary={profileSummary}
                  summaryExpanded={summaryExpanded}
                  setSummaryExpanded={setSummaryExpanded}
                  ignoreProfile={ignoreProfile}
                  onIgnoreProfileChange={(v) => {
                    setIgnoreProfile(v)
                    if (v) {
                      // Reset auto-filled values when ignoring profile
                      setGoals([])
                      setSessionsPerWeek(3)
                      setSessionMinutes(60)
                      setSummaryExpanded(false)
                    } else if (profileSummary) {
                      // Re-apply profile values when toggling back
                      if (profileSummary.goals.length > 0) setGoals(profileSummary.goals)
                      if (profileSummary.preferredTrainingDays !== null)
                        setSessionsPerWeek(profileSummary.preferredTrainingDays)
                      if (profileSummary.preferredSessionMinutes !== null)
                        setSessionMinutes(profileSummary.preferredSessionMinutes)
                      setSummaryExpanded(true)
                    }
                  }}
                />
              )}
              {step === 1 && (
                <Step2GoalsSchedule
                  goals={goals}
                  toggleGoal={toggleGoal}
                  profileStatus={profileStatus}
                  profileSummary={profileSummary}
                  durationWeeks={durationWeeks}
                  setDurationWeeks={setDurationWeeks}
                  sessionsPerWeek={sessionsPerWeek}
                  setSessionsPerWeek={setSessionsPerWeek}
                  sessionMinutes={sessionMinutes}
                  setSessionMinutes={setSessionMinutes}
                />
              )}
              {step === 2 && (
                <Step3Settings
                  splitType={splitType}
                  setSplitType={setSplitType}
                  periodization={periodization}
                  setPeriodization={setPeriodization}
                  selectedTier={selectedTier}
                  setSelectedTier={setSelectedTier}
                  audience={audience}
                  setAudience={setAudience}
                  priceDollars={priceDollars}
                  setPriceDollars={setPriceDollars}
                  additionalInstructions={additionalInstructions}
                  setAdditionalInstructions={setAdditionalInstructions}
                  ignoreProfile={ignoreProfile}
                  hasClient={!!clientId}
                  error={error}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Field guide tour */}
        <FormTour {...tour} />

        {/* Footer */}
        <DialogFooter>
          {step > 0 ? (
            <Button type="button" variant="outline" onClick={handleBack}>
              <ChevronLeft className="size-4" />
              Back
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          )}

          {step < 2 ? (
            <Button type="button" onClick={handleNext}>
              Next
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={goals.length === 0}>
              <Sparkles className="size-4" />
              Generate Program
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Step 1: Client ──────────────────────────────────────────────────────────

function Step1Client({
  clients,
  loadingClients,
  clientId,
  setClientId,
  profileStatus,
  profileSummary,
  summaryExpanded,
  setSummaryExpanded,
  ignoreProfile,
  onIgnoreProfileChange,
}: {
  clients: User[]
  loadingClients: boolean
  clientId: string
  setClientId: (v: string) => void
  profileStatus: "idle" | "loading" | "found" | "not_found"
  profileSummary: ProfileSummary | null
  summaryExpanded: boolean
  setSummaryExpanded: React.Dispatch<React.SetStateAction<boolean>>
  ignoreProfile: boolean
  onIgnoreProfileChange: (v: boolean) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Optionally select a client to personalize the program with their questionnaire data, or skip to create a generic
        program.
      </p>

      {/* Client select */}
      <div className="space-y-2">
        <Label htmlFor="ai-client">Client (optional)</Label>
        <select
          id="ai-client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={loadingClients}
          className={selectClass}
        >
          <option value="">{loadingClients ? "Loading clients..." : "No client (generic program)"}</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.first_name} {client.last_name} ({client.email})
            </option>
          ))}
        </select>
      </div>

      {/* Profile status banners */}
      {profileStatus === "loading" && (
        <div className="rounded-lg bg-surface/50 border border-border p-3 flex items-center gap-2">
          <Loader2 className="size-4 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Loading questionnaire data...</p>
        </div>
      )}

      {profileStatus === "not_found" && (
        <div className="rounded-lg bg-warning/10 border border-warning/20 p-3 flex items-start gap-2">
          <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-warning">No questionnaire data</p>
            <p className="text-xs text-warning/80">
              This client hasn&apos;t completed their questionnaire. You&apos;ll need to configure all fields manually.
            </p>
          </div>
        </div>
      )}

      {/* Ignore profile toggle */}
      {clientId && profileStatus !== "loading" && (
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="ai-ignore-profile" className="text-sm font-medium cursor-pointer">
              Ignore athlete profile
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Skip the client&apos;s questionnaire data and create a program from scratch
            </p>
          </div>
          <Switch id="ai-ignore-profile" checked={ignoreProfile} onCheckedChange={onIgnoreProfileChange} />
        </div>
      )}

      {/* Questionnaire summary panel */}
      {profileStatus === "found" && profileSummary && !ignoreProfile && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">
          <button
            type="button"
            onClick={() => setSummaryExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <span className="flex items-center gap-2">
              <ClipboardList className="size-4" />
              Questionnaire Summary
              <Badge variant="outline" className="text-xs px-1.5 py-0 border-primary/30 text-primary">
                Auto-filled
              </Badge>
            </span>
            {summaryExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>

          {summaryExpanded && (
            <div className="px-3 pb-3 border-t border-primary/10">
              <Tabs defaultValue="profile" className="pt-2">
                <TabsList className="w-full">
                  <TabsTrigger value="profile" className="text-xs">
                    Profile
                  </TabsTrigger>
                  <TabsTrigger value="training" className="text-xs">
                    Training
                  </TabsTrigger>
                  <TabsTrigger value="schedule" className="text-xs">
                    Schedule
                  </TabsTrigger>
                  <TabsTrigger value="preferences" className="text-xs">
                    Preferences
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="space-y-2 pt-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {profileSummary.dateOfBirth && (
                      <SummaryField label="Birth Year" value={profileSummary.dateOfBirth.slice(0, 4)} />
                    )}
                    {profileSummary.gender && (
                      <SummaryField
                        label="Gender"
                        value={GENDER_LABELS[profileSummary.gender] ?? profileSummary.gender}
                      />
                    )}
                    {profileSummary.sport && <SummaryField label="Sport" value={profileSummary.sport} />}
                    {profileSummary.position && <SummaryField label="Position" value={profileSummary.position} />}
                  </div>
                  {(profileSummary.sleepHours ||
                    profileSummary.stressLevel ||
                    profileSummary.occupationActivityLevel) && (
                    <>
                      <p className="text-xs font-medium text-muted-foreground pt-1">Recovery & Lifestyle</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {profileSummary.sleepHours && (
                          <SummaryField
                            label="Sleep"
                            value={SLEEP_LABELS[profileSummary.sleepHours] ?? profileSummary.sleepHours}
                          />
                        )}
                        {profileSummary.stressLevel && (
                          <SummaryField
                            label="Stress"
                            value={STRESS_LABELS[profileSummary.stressLevel] ?? profileSummary.stressLevel}
                          />
                        )}
                        {profileSummary.occupationActivityLevel && (
                          <SummaryField
                            label="Occupation"
                            value={
                              OCCUPATION_LABELS[profileSummary.occupationActivityLevel] ??
                              profileSummary.occupationActivityLevel
                            }
                          />
                        )}
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="training" className="space-y-2 pt-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {profileSummary.experienceLevel && (
                      <SummaryField
                        label="Experience"
                        value={LEVEL_LABELS[profileSummary.experienceLevel] ?? profileSummary.experienceLevel}
                      />
                    )}
                    {profileSummary.movementConfidence && (
                      <SummaryField
                        label="Movement Confidence"
                        value={
                          MOVEMENT_CONFIDENCE_LABELS[profileSummary.movementConfidence] ??
                          profileSummary.movementConfidence
                        }
                      />
                    )}
                    {profileSummary.trainingYears !== null && (
                      <SummaryField
                        label="Training Years"
                        value={`${profileSummary.trainingYears} year${profileSummary.trainingYears !== 1 ? "s" : ""}`}
                      />
                    )}
                  </div>
                  {profileSummary.trainingBackground && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Training Background</p>
                      <p className="text-sm">{profileSummary.trainingBackground}</p>
                    </div>
                  )}
                  {(profileSummary.injuries || profileSummary.injuryDetails.length > 0) && (
                    <div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                        <AlertTriangle className="size-3" />
                        Injuries & Limitations
                      </p>
                      {profileSummary.injuries && <p className="text-sm">{profileSummary.injuries}</p>}
                      {profileSummary.injuryDetails.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {profileSummary.injuryDetails.map((injury, i) => (
                            <Badge key={i} variant="outline" className="text-xs gap-1 border-warning/30 text-warning">
                              {injury.area}
                              {injury.side ? ` (${injury.side})` : ""}
                              {injury.severity ? ` - ${injury.severity}` : ""}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {profileSummary.availableEquipment.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                        <Dumbbell className="size-3" />
                        Available Equipment
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {profileSummary.availableEquipment.map((eq) => (
                          <Badge key={eq} variant="outline" className="text-xs border-border">
                            {EQUIPMENT_LABELS[eq] ?? eq}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="schedule" className="space-y-2 pt-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {profileSummary.preferredTrainingDays !== null && (
                      <SummaryField label="Sessions/Week" value={String(profileSummary.preferredTrainingDays)} />
                    )}
                    {profileSummary.preferredSessionMinutes !== null && (
                      <SummaryField label="Session Length" value={`${profileSummary.preferredSessionMinutes} min`} />
                    )}
                  </div>
                  {profileSummary.preferredDayNames.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Preferred Days</p>
                      <div className="flex flex-wrap gap-1">
                        {profileSummary.preferredDayNames.map((dayNum) => (
                          <Badge key={dayNum} variant="outline" className="text-xs border-border">
                            {DAY_NAMES[dayNum - 1] ?? `Day ${dayNum}`}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {profileSummary.timeEfficiencyPreference && (
                    <SummaryField
                      label="Time Efficiency"
                      value={
                        TIME_EFFICIENCY_LABELS[profileSummary.timeEfficiencyPreference] ??
                        profileSummary.timeEfficiencyPreference
                      }
                    />
                  )}
                </TabsContent>

                <TabsContent value="preferences" className="space-y-2 pt-2">
                  {profileSummary.preferredTechniques.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Preferred Techniques</p>
                      <div className="flex flex-wrap gap-1">
                        {profileSummary.preferredTechniques.map((t) => (
                          <Badge key={t} variant="outline" className="text-xs border-border">
                            {TECHNIQUE_LABELS[t] ?? t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {profileSummary.likes && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Likes</p>
                      <p className="text-sm">{profileSummary.likes}</p>
                    </div>
                  )}
                  {profileSummary.dislikes && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Dislikes</p>
                      <p className="text-sm">{profileSummary.dislikes}</p>
                    </div>
                  )}
                  {profileSummary.notes && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Additional Notes</p>
                      <p className="text-sm">{profileSummary.notes}</p>
                    </div>
                  )}
                  {!profileSummary.preferredTechniques.length &&
                    !profileSummary.likes &&
                    !profileSummary.dislikes &&
                    !profileSummary.notes && (
                      <p className="text-xs text-muted-foreground italic">No preferences provided.</p>
                    )}
                </TabsContent>
              </Tabs>

              <p className="text-xs text-muted-foreground flex items-center gap-1 pt-2 mt-2 border-t border-primary/10">
                <Info className="size-3" />
                Goals, sessions/week, and session length were auto-filled. You can override them in the next step.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Step 2: Goals & Schedule ────────────────────────────────────────────────

function Step2GoalsSchedule({
  goals,
  toggleGoal,
  profileStatus,
  profileSummary,
  durationWeeks,
  setDurationWeeks,
  sessionsPerWeek,
  setSessionsPerWeek,
  sessionMinutes,
  setSessionMinutes,
}: {
  goals: string[]
  toggleGoal: (goal: string) => void
  profileStatus: "idle" | "loading" | "found" | "not_found"
  profileSummary: ProfileSummary | null
  durationWeeks: number
  setDurationWeeks: (v: number) => void
  sessionsPerWeek: number
  setSessionsPerWeek: (v: number) => void
  sessionMinutes: number
  setSessionMinutes: (v: number) => void
}) {
  return (
    <div className="space-y-4">
      {/* Goals */}
      <div className="space-y-2">
        <Label>
          Goals *
          {profileStatus === "found" && profileSummary && profileSummary.goals.length > 0 && (
            <Badge variant="outline" className="ml-2 text-xs px-1.5 py-0 border-primary/30 text-primary font-normal">
              from questionnaire
            </Badge>
          )}
        </Label>
        <div id="ai-goals" className="grid grid-cols-2 gap-2">
          {FITNESS_GOALS.map((goalValue) => (
            <label
              key={goalValue}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm cursor-pointer hover:bg-surface/50 transition-colors has-[:checked]:bg-primary/5 has-[:checked]:border-primary/30"
            >
              <Checkbox checked={goals.includes(goalValue)} onCheckedChange={() => toggleGoal(goalValue)} />
              <span>{GOAL_LABELS[goalValue] ?? goalValue}</span>
            </label>
          ))}
        </div>
        {goals.length === 0 && <p className="text-xs text-muted-foreground">Select at least one goal</p>}
      </div>

      {/* Duration & Sessions */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ai-duration">Duration (weeks) *</Label>
          <Input
            id="ai-duration"
            type="number"
            min={1}
            max={52}
            value={durationWeeks}
            onChange={(e) => setDurationWeeks(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ai-sessions">
            Sessions/Week *
            {profileStatus === "found" && profileSummary?.preferredTrainingDays !== null && (
              <Badge variant="outline" className="ml-2 text-xs px-1.5 py-0 border-primary/30 text-primary font-normal">
                from questionnaire
              </Badge>
            )}
          </Label>
          <Input
            id="ai-sessions"
            type="number"
            min={1}
            max={7}
            value={sessionsPerWeek}
            onChange={(e) => setSessionsPerWeek(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Session minutes */}
      <div className="space-y-2">
        <Label htmlFor="ai-minutes">
          Session Length
          {profileStatus === "found" && profileSummary?.preferredSessionMinutes !== null && (
            <Badge variant="outline" className="ml-2 text-xs px-1.5 py-0 border-primary/30 text-primary font-normal">
              from questionnaire
            </Badge>
          )}
        </Label>
        <select
          id="ai-minutes"
          value={sessionMinutes}
          onChange={(e) => setSessionMinutes(Number(e.target.value))}
          className={selectClass}
        >
          {SESSION_DURATIONS.map((mins) => (
            <option key={mins} value={mins}>
              {mins} minutes
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ─── Step 3: Settings ────────────────────────────────────────────────────────

function Step3Settings({
  splitType,
  setSplitType,
  periodization,
  setPeriodization,
  selectedTier,
  setSelectedTier,
  audience,
  setAudience,
  priceDollars,
  setPriceDollars,
  additionalInstructions,
  setAdditionalInstructions,
  ignoreProfile,
  hasClient,
  error,
}: {
  splitType: string
  setSplitType: (v: string) => void
  periodization: string
  setPeriodization: (v: string) => void
  selectedTier: string
  setSelectedTier: (v: string) => void
  audience: "private" | "public"
  setAudience: (v: "private" | "public") => void
  priceDollars: string
  setPriceDollars: (v: string) => void
  additionalInstructions: string
  setAdditionalInstructions: (v: string) => void
  ignoreProfile: boolean
  hasClient: boolean
  error: string | null
}) {
  return (
    <div className="space-y-4">
      {/* Error banner */}
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
          <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">Generation Failed</p>
            <p className="text-xs text-destructive/80">{error}</p>
          </div>
        </div>
      )}

      {/* Split Type & Periodization */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ai-split">Split Type</Label>
          <select
            id="ai-split"
            value={splitType}
            onChange={(e) => setSplitType(e.target.value)}
            className={selectClass}
          >
            <option value="">Auto (AI decides)</option>
            {SPLIT_TYPES.map((st) => (
              <option key={st} value={st}>
                {SPLIT_TYPE_LABELS[st]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ai-periodization">Periodization</Label>
          <select
            id="ai-periodization"
            value={periodization}
            onChange={(e) => setPeriodization(e.target.value)}
            className={selectClass}
          >
            <option value="">Auto (AI decides)</option>
            {PERIODIZATION_TYPES.map((p) => (
              <option key={p} value={p}>
                {PERIODIZATION_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tier */}
      <div className="space-y-2">
        <Label htmlFor="ai-tier">Tier</Label>
        <select
          id="ai-tier"
          value={selectedTier}
          onChange={(e) => setSelectedTier(e.target.value)}
          className={selectClass}
        >
          {PROGRAM_TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">{TIER_DESCRIPTIONS[selectedTier]}</p>
      </div>

      {/* Audience */}
      <div className="space-y-2">
        <Label>Audience</Label>
        <div className="grid gap-2">
          {/* Public */}
          <button
            type="button"
            onClick={() => setAudience("public")}
            className={cn(
              "flex items-start gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors",
              audience === "public" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30",
            )}
          >
            <Globe
              className={cn("size-4 shrink-0 mt-0.5", audience === "public" ? "text-primary" : "text-muted-foreground")}
            />
            <div>
              <p className={cn("text-sm font-medium", audience === "public" ? "text-primary" : "text-foreground")}>
                Public
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Available in the store for any client to purchase
              </p>
            </div>
          </button>

          {/* Private */}
          <button
            type="button"
            onClick={() => setAudience("private")}
            className={cn(
              "flex items-start gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors",
              audience === "private" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30",
            )}
          >
            <Lock
              className={cn(
                "size-4 shrink-0 mt-0.5",
                audience === "private" ? "text-primary" : "text-muted-foreground",
              )}
            />
            <div>
              <p className={cn("text-sm font-medium", audience === "private" ? "text-primary" : "text-foreground")}>
                Private
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Only visible to assigned clients — assign them from the program detail page
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Price */}
      {audience === "public" && (
        <div className="space-y-2">
          <Label htmlFor="ai-price">
            Price
            <span className="text-muted-foreground font-normal ml-1">(leave empty for free)</span>
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              id="ai-price"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              className="pl-7"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {priceDollars && parseFloat(priceDollars) > 0
              ? `Client pays $${parseFloat(priceDollars).toFixed(2)} USD via Stripe checkout.`
              : "No payment required — client gets access for free."}
          </p>
        </div>
      )}

      {/* Additional Instructions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="ai-instructions">
            {ignoreProfile && hasClient ? "Coach Instructions" : "Additional Instructions"}
            <span className="text-muted-foreground font-normal ml-1">
              {ignoreProfile && hasClient ? "(recommended)" : "(optional)"}
            </span>
          </Label>
          <TemplateSelector
            scope="week"
            currentText={additionalInstructions}
            onSelect={(prompt) =>
              setAdditionalInstructions(additionalInstructions ? `${additionalInstructions}\n\n${prompt}` : prompt)
            }
          />
        </div>
        <Textarea
          id="ai-instructions"
          value={additionalInstructions}
          onChange={(e) => setAdditionalInstructions(e.target.value)}
          placeholder={
            ignoreProfile && hasClient
              ? "Describe the program you want — goals, structure, focus areas, techniques..."
              : "e.g. Focus on posterior chain, include sprint work on lower body days..."
          }
          rows={ignoreProfile && hasClient ? 10 : 8}
          maxLength={2000}
          className="field-sizing-fixed resize-none"
        />
      </div>
    </div>
  )
}

"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Globe,
  Lock,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Gift,
  CreditCard,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  programFormSchema,
  PROGRAM_CATEGORIES,
  PROGRAM_DIFFICULTIES,
  PROGRAM_TIERS,
  SPLIT_TYPES,
  PERIODIZATION_TYPES,
  BILLING_INTERVALS,
  type ProgramFormData,
} from "@/lib/validators/program"
import type { PaymentType } from "@/types/database"
import { useFormTour } from "@/hooks/use-form-tour"
import { FormTour } from "@/components/admin/FormTour"
import { TourButton } from "@/components/admin/TourButton"
import { getProgramTourSteps } from "@/lib/tour-steps"
import type { Program } from "@/types/database"

interface ProgramFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  program?: Program | null
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  conditioning: "Conditioning",
  sport_specific: "Sport Specific",
  recovery: "Recovery",
  nutrition: "Nutrition",
  hybrid: "Hybrid",
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
}

const TIER_LABELS: Record<string, string> = {
  generalize: "Generalize",
  premium: "Premium",
}

const TIER_DESCRIPTIONS: Record<string, string> = {
  generalize: "Workout logging only, no coach interaction",
  premium: "Includes AI coaching feedback from DJP",
}

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

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  category: "Category",
  difficulty: "Difficulty",
  duration_weeks: "Duration (weeks)",
  sessions_per_week: "Sessions per week",
  payment_type: "Payment type",
  billing_interval: "Billing interval",
  price_cents: "Price",
  split_type: "Split type",
  periodization: "Periodization",
  tier: "Tier",
}

const BILLING_INTERVAL_LABELS: Record<string, string> = {
  week: "Weekly",
  month: "Monthly",
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

const STEPS = [
  { label: "Info", number: 1 },
  { label: "Schedule", number: 2 },
  { label: "Audience", number: 3 },
] as const

type AudienceMode = "public" | "private"

const stepVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ProgramFormDialog({
  open,
  onOpenChange,
  program,
}: ProgramFormDialogProps) {
  const router = useRouter()
  const isEditing = !!program
  const dialogRef = useRef<HTMLDivElement>(null)

  // Wizard state
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof ProgramFormData, string[]>>>({})
  const [name, setName] = useState(program?.name ?? "")
  const [description, setDescription] = useState(program?.description ?? "")
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    Array.isArray(program?.category) ? program.category : program?.category ? [program.category] : []
  )
  const [difficulty, setDifficulty] = useState(program?.difficulty ?? "")
  const [selectedTier, setSelectedTier] = useState<string>(program?.tier ?? "generalize")
  const [splitType, setSplitType] = useState(program?.split_type ?? "")
  const [periodization, setPeriodization] = useState(program?.periodization ?? "")
  const [durationWeeks, setDurationWeeks] = useState(program?.duration_weeks?.toString() ?? "")
  const [sessionsPerWeek, setSessionsPerWeek] = useState(program?.sessions_per_week?.toString() ?? "")
  const [priceDollars, setPriceDollars] = useState(
    program?.price_cents != null ? (program.price_cents / 100).toFixed(2) : ""
  )
  const [paymentType, setPaymentType] = useState<PaymentType>(program?.payment_type ?? "one_time")
  const [billingInterval, setBillingInterval] = useState<string>(program?.billing_interval ?? "month")

  // Audience state
  const [audience, setAudience] = useState<AudienceMode>(() => {
    if (program?.is_public) return "public"
    return "private"
  })

  // Post-save state
  const [savedProgramId, setSavedProgramId] = useState<string | null>(null)

  // Sync state when switching between create/edit
  useEffect(() => {
    setName(program?.name ?? "")
    setDescription(program?.description ?? "")
    setSelectedCategories(
      Array.isArray(program?.category) ? program.category : program?.category ? [program.category] : []
    )
    setDifficulty(program?.difficulty ?? "")
    setSelectedTier(program?.tier ?? "generalize")
    setSplitType(program?.split_type ?? "")
    setPeriodization(program?.periodization ?? "")
    setDurationWeeks(program?.duration_weeks?.toString() ?? "")
    setSessionsPerWeek(program?.sessions_per_week?.toString() ?? "")
    setPriceDollars(program?.price_cents != null ? (program.price_cents / 100).toFixed(2) : "")
    setPaymentType(program?.payment_type ?? "one_time")
    setBillingInterval(program?.billing_interval ?? "month")
    setAudience(program?.is_public ? "public" : "private")
    setStep(0)
    setDirection(1)
  }, [program])

  // ─── Navigation ──────────────────────────────────────────────────────────

  function validateStep(s: number): boolean {
    if (s === 0) {
      if (!name.trim()) { toast.error("Name is required"); return false }
      if (selectedCategories.length === 0) { toast.error("Select at least one category"); return false }
      if (!difficulty) { toast.error("Difficulty is required"); return false }
      if (!selectedTier) { toast.error("Tier is required"); return false }
    }
    if (s === 1) {
      const weeks = parseInt(durationWeeks)
      const sessions = parseInt(sessionsPerWeek)
      if (!weeks || weeks < 1) { toast.error("Duration must be at least 1 week"); return false }
      if (!sessions || sessions < 1) { toast.error("Sessions per week must be at least 1"); return false }
      if (paymentType !== "free" && (!priceDollars || parseFloat(priceDollars) <= 0)) {
        toast.error("Price is required for paid programs"); return false
      }
      if (paymentType === "subscription" && !billingInterval) {
        toast.error("Billing interval is required for subscriptions"); return false
      }
    }
    if (s === 2) {
      // No additional validation needed — just public or private
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
    if (target >= step) return // only allow going back
    setDirection(-1)
    setStep(target)
    scrollToTop()
  }

  // Tour navigation — goes forward or backward without validation (used by field guide)
  const stepRef = useRef(step)
  stepRef.current = step

  const tourGoToStep = useCallback((target: number) => {
    setDirection(target > stepRef.current ? 1 : -1)
    setStep(target)
  }, [])

  const tourSteps = useMemo(() => getProgramTourSteps(tourGoToStep), [tourGoToStep])

  const tour = useFormTour({
    steps: tourSteps,
    scrollContainerRef: dialogRef,
  })

  // ─── Submit ──────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!validateStep(2)) return
    setErrors({})

    const priceCents = priceDollars && priceDollars !== ""
      ? Math.round(parseFloat(priceDollars) * 100)
      : null

    const data = {
      name: name.trim(),
      description: description.trim() || null,
      category: selectedCategories,
      difficulty,
      tier: selectedTier,
      duration_weeks: durationWeeks,
      sessions_per_week: sessionsPerWeek,
      payment_type: paymentType,
      billing_interval: paymentType === "subscription" ? billingInterval : null,
      price_cents: paymentType === "free" ? null : priceCents,
      split_type: splitType || null,
      periodization: periodization || null,
      is_public: audience === "public",
    }

    const result = programFormSchema.safeParse(data)
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors
      setErrors(fieldErrors)
      const firstError = Object.entries(fieldErrors).find(([, v]) => v && v.length > 0)
      if (firstError) {
        const label = FIELD_LABELS[firstError[0]] ?? firstError[0]
        toast.error(`${label}: ${firstError[1]?.[0]}`)
      }
      return
    }

    setIsSubmitting(true)

    try {
      const url = isEditing
        ? `/api/admin/programs/${program.id}`
        : "/api/admin/programs"
      const method = isEditing ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      })

      if (!response.ok) {
        const errorData = await response.json()
        if (errorData.details) {
          const fieldErrors = errorData.details as Partial<Record<keyof ProgramFormData, string[]>>
          setErrors(fieldErrors)
          const firstError = Object.entries(fieldErrors).find(([, v]) => v && v.length > 0)
          if (firstError) {
            const label = FIELD_LABELS[firstError[0]] ?? firstError[0]
            toast.error(`${label}: ${firstError[1]?.[0]}`)
          } else {
            toast.error(errorData.error || "Request failed")
          }
          return
        }
        throw new Error(errorData.error || "Request failed")
      }

      const responseData = await response.json()
      toast.success(isEditing ? "Program updated successfully" : "Program created successfully")
      setSavedProgramId(isEditing ? program.id : responseData.id)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (isEditing ? "Failed to update program" : "Failed to create program"))
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Dialog close ────────────────────────────────────────────────────────

  function handleDialogClose(o: boolean) {
    if (!o) {
      setSavedProgramId(null)
      setStep(0)
      setDirection(1)
      tour.close()
    }
    onOpenChange(o)
  }

  function handleDone() {
    handleDialogClose(false)
  }

  // ─── Success view ───────────────────────────────────────────────────────

  if (savedProgramId) {
    return (
      <Dialog open={open} onOpenChange={handleDialogClose}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="size-14 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="size-7 text-success" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-heading font-semibold text-foreground">
                {isEditing ? "Program Updated" : "Program Created"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {audience === "private"
                  ? "Head to the program detail page to assign clients."
                  : "The program is now live in the store."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleDone}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // ─── Wizard form ────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className={cn("sm:max-w-lg max-h-[90vh] overflow-y-auto", tour.isActive && "pb-48")} ref={dialogRef}>
        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <DialogTitle className="text-lg font-heading font-semibold text-foreground">
              {isEditing ? "Edit Program" : "Add Program"}
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
                      : "bg-muted text-muted-foreground cursor-default"
                )}
              >
                <span className={cn(
                  "flex items-center justify-center size-4 rounded-full text-[10px] font-bold",
                  idx === step
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : idx < step
                      ? "bg-primary/20 text-primary"
                      : "bg-muted-foreground/20 text-muted-foreground"
                )}>
                  {idx < step ? "\u2713" : s.number}
                </span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="min-h-[280px]">
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
                <Step1Info
                  name={name}
                  setName={setName}
                  description={description}
                  setDescription={setDescription}
                  selectedCategories={selectedCategories}
                  setSelectedCategories={setSelectedCategories}
                  difficulty={difficulty}
                  setDifficulty={setDifficulty}
                  selectedTier={selectedTier}
                  setSelectedTier={setSelectedTier}
                  splitType={splitType}
                  setSplitType={setSplitType}
                  periodization={periodization}
                  setPeriodization={setPeriodization}
                  errors={errors}
                  disabled={isSubmitting}
                />
              )}
              {step === 1 && (
                <Step2Schedule
                  durationWeeks={durationWeeks}
                  setDurationWeeks={setDurationWeeks}
                  sessionsPerWeek={sessionsPerWeek}
                  setSessionsPerWeek={setSessionsPerWeek}
                  paymentType={paymentType}
                  setPaymentType={setPaymentType}
                  billingInterval={billingInterval}
                  setBillingInterval={setBillingInterval}
                  priceDollars={priceDollars}
                  setPriceDollars={setPriceDollars}
                  errors={errors}
                  disabled={isSubmitting}
                />
              )}
              {step === 2 && (
                <Step3Audience
                  audience={audience}
                  setAudience={setAudience}
                  disabled={isSubmitting}
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
            <Button type="button" variant="outline" onClick={handleBack} disabled={isSubmitting}>
              <ChevronLeft className="size-4" />
              Back
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={handleDone} disabled={isSubmitting}>
              Cancel
            </Button>
          )}

          {step < 2 ? (
            <Button type="button" onClick={handleNext} disabled={isSubmitting}>
              Next
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting
                ? isEditing ? "Saving..." : "Creating..."
                : isEditing ? "Save Changes" : "Create Program"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Step 1: Program Info ─────────────────────────────────────────────────────

function Step1Info({
  name,
  setName,
  description,
  setDescription,
  selectedCategories,
  setSelectedCategories,
  difficulty,
  setDifficulty,
  selectedTier,
  setSelectedTier,
  splitType,
  setSplitType,
  periodization,
  setPeriodization,
  errors,
  disabled,
}: {
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  selectedCategories: string[]
  setSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>
  difficulty: string
  setDifficulty: (v: string) => void
  selectedTier: string
  setSelectedTier: (v: string) => void
  splitType: string
  setSplitType: (v: string) => void
  periodization: string
  setPeriodization: (v: string) => void
  errors: Partial<Record<keyof ProgramFormData, string[]>>
  disabled: boolean
}) {
  return (
    <div className="space-y-4">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 12-Week Strength Builder"
          disabled={disabled}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name[0]}</p>}
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label>Category *</Label>
        <div id="category" className="flex flex-wrap gap-2">
          {PROGRAM_CATEGORIES.map((cat) => {
            const selected = selectedCategories.includes(cat)
            return (
              <button
                key={cat}
                type="button"
                disabled={disabled}
                onClick={() =>
                  setSelectedCategories((prev) =>
                    selected ? prev.filter((c) => c !== cat) : [...prev, cat]
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white text-muted-foreground border-border hover:border-primary/40"
                )}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            )
          })}
        </div>
        {errors.category && <p className="text-xs text-destructive">{errors.category[0]}</p>}
      </div>

      {/* Difficulty & Split Type */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="difficulty">Difficulty *</Label>
          <select
            id="difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            disabled={disabled}
            className={selectClass}
          >
            <option value="" disabled>Select difficulty</option>
            {PROGRAM_DIFFICULTIES.map((diff) => (
              <option key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</option>
            ))}
          </select>
          {errors.difficulty && <p className="text-xs text-destructive">{errors.difficulty[0]}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="split_type">Split Type</Label>
          <select
            id="split_type"
            value={splitType}
            onChange={(e) => setSplitType(e.target.value)}
            disabled={disabled}
            className={selectClass}
          >
            <option value="">None</option>
            {SPLIT_TYPES.map((st) => (
              <option key={st} value={st}>{SPLIT_TYPE_LABELS[st]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tier */}
      <div className="space-y-2">
        <Label htmlFor="tier">Tier *</Label>
        <select
          id="tier"
          value={selectedTier}
          onChange={(e) => setSelectedTier(e.target.value)}
          disabled={disabled}
          className={selectClass}
        >
          {PROGRAM_TIERS.map((t) => (
            <option key={t} value={t}>{TIER_LABELS[t]}</option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          {TIER_DESCRIPTIONS[selectedTier]}
        </p>
        {errors.tier && <p className="text-xs text-destructive">{errors.tier[0]}</p>}
      </div>

      {/* Periodization */}
      <div className="space-y-2">
        <Label htmlFor="periodization">Periodization</Label>
        <select
          id="periodization"
          value={periodization}
          onChange={(e) => setPeriodization(e.target.value)}
          disabled={disabled}
          className={selectClass}
        >
          <option value="">None</option>
          {PERIODIZATION_TYPES.map((p) => (
            <option key={p} value={p}>{PERIODIZATION_LABELS[p]}</option>
          ))}
        </select>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Brief description of the program..."
          disabled={disabled}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
        />
        {errors.description && <p className="text-xs text-destructive">{errors.description[0]}</p>}
      </div>
    </div>
  )
}

// ─── Step 2: Schedule & Pricing ───────────────────────────────────────────────

function Step2Schedule({
  durationWeeks,
  setDurationWeeks,
  sessionsPerWeek,
  setSessionsPerWeek,
  paymentType,
  setPaymentType,
  billingInterval,
  setBillingInterval,
  priceDollars,
  setPriceDollars,
  errors,
  disabled,
}: {
  durationWeeks: string
  setDurationWeeks: (v: string) => void
  sessionsPerWeek: string
  setSessionsPerWeek: (v: string) => void
  paymentType: PaymentType
  setPaymentType: (v: PaymentType) => void
  billingInterval: string
  setBillingInterval: (v: string) => void
  priceDollars: string
  setPriceDollars: (v: string) => void
  errors: Partial<Record<keyof ProgramFormData, string[]>>
  disabled: boolean
}) {
  const paymentOptions: { value: PaymentType; label: string; icon: React.ReactNode; desc: string }[] = [
    { value: "free", label: "Free", icon: <Gift className="size-4" />, desc: "No payment required" },
    { value: "one_time", label: "One-Time", icon: <CreditCard className="size-4" />, desc: "Single payment" },
    { value: "subscription", label: "Subscription", icon: <RefreshCw className="size-4" />, desc: "Recurring billing" },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Set up the program schedule and pricing.
      </p>

      {/* Duration & Sessions */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="duration_weeks">Duration (weeks) *</Label>
          <Input
            id="duration_weeks"
            type="number"
            min={1}
            value={durationWeeks}
            onChange={(e) => setDurationWeeks(e.target.value)}
            placeholder="e.g. 12"
            disabled={disabled}
          />
          {errors.duration_weeks && (
            <p className="text-xs text-destructive">{errors.duration_weeks[0]}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="sessions_per_week">Sessions/Week *</Label>
          <Input
            id="sessions_per_week"
            type="number"
            min={1}
            value={sessionsPerWeek}
            onChange={(e) => setSessionsPerWeek(e.target.value)}
            placeholder="e.g. 4"
            disabled={disabled}
          />
          {errors.sessions_per_week && (
            <p className="text-xs text-destructive">{errors.sessions_per_week[0]}</p>
          )}
        </div>
      </div>

      {/* Payment Type */}
      <div className="space-y-2">
        <Label>Payment Type *</Label>
        <div id="payment-type-options" className="grid grid-cols-3 gap-2">
          {paymentOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => {
                setPaymentType(opt.value)
                if (opt.value === "free") setPriceDollars("")
              }}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-center transition-colors",
                paymentType === opt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              )}
            >
              <span className={cn(
                paymentType === opt.value ? "text-primary" : "text-muted-foreground"
              )}>
                {opt.icon}
              </span>
              <span className={cn(
                "text-xs font-medium",
                paymentType === opt.value ? "text-primary" : "text-foreground"
              )}>
                {opt.label}
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                {opt.desc}
              </span>
            </button>
          ))}
        </div>
        {errors.payment_type && (
          <p className="text-xs text-destructive">{errors.payment_type[0]}</p>
        )}
      </div>

      {/* Price — hidden for free */}
      {paymentType !== "free" && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="price_dollars">
              Price ($) *
              {paymentType === "subscription" && billingInterval && (
                <span className="text-muted-foreground font-normal">
                  {" "}/ {billingInterval === "month" ? "mo" : "wk"}
                </span>
              )}
            </Label>
            <Input
              id="price_dollars"
              type="number"
              step="0.01"
              min={0}
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              placeholder="e.g. 99.99"
              disabled={disabled}
            />
            {errors.price_cents && (
              <p className="text-xs text-destructive">{errors.price_cents[0]}</p>
            )}
          </div>

          {/* Billing Interval — only for subscription */}
          {paymentType === "subscription" && (
            <div className="space-y-2">
              <Label htmlFor="billing_interval">Billing Interval *</Label>
              <select
                id="billing_interval"
                value={billingInterval}
                onChange={(e) => setBillingInterval(e.target.value)}
                disabled={disabled}
                className={selectClass}
              >
                {BILLING_INTERVALS.map((interval) => (
                  <option key={interval} value={interval}>
                    {BILLING_INTERVAL_LABELS[interval]}
                  </option>
                ))}
              </select>
              {errors.billing_interval && (
                <p className="text-xs text-destructive">{errors.billing_interval[0]}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Audience ─────────────────────────────────────────────────────────

function Step3Audience({
  audience,
  setAudience,
  disabled,
}: {
  audience: AudienceMode
  setAudience: (v: AudienceMode) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Who should have access to this program?
      </p>

      <div id="audience-options" className="grid gap-2">
        {/* Public */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAudience("public")}
          className={cn(
            "flex items-start gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors",
            audience === "public"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/30"
          )}
        >
          <Globe className={cn("size-5 shrink-0 mt-0.5", audience === "public" ? "text-primary" : "text-muted-foreground")} />
          <div>
            <p className={cn("text-sm font-medium", audience === "public" ? "text-primary" : "text-foreground")}>
              Public
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              Available in the store for any client to purchase
            </p>
          </div>
        </button>

        {/* Private */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAudience("private")}
          className={cn(
            "flex items-start gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors",
            audience === "private"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/30"
          )}
        >
          <Lock className={cn("size-5 shrink-0 mt-0.5", audience === "private" ? "text-primary" : "text-muted-foreground")} />
          <div>
            <p className={cn("text-sm font-medium", audience === "private" ? "text-primary" : "text-foreground")}>
              Private
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              Only visible to assigned clients — assign them from the program detail page
            </p>
          </div>
        </button>
      </div>

    </div>
  )
}

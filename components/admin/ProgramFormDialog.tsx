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
  UserCheck,
  CheckCircle2,
  UserPlus,
  ChevronRight,
  ChevronLeft,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  programFormSchema,
  PROGRAM_CATEGORIES,
  PROGRAM_DIFFICULTIES,
  PROGRAM_TIERS,
  SPLIT_TYPES,
  PERIODIZATION_TYPES,
  type ProgramFormData,
} from "@/lib/validators/program"
import { AssignProgramDialog } from "@/components/admin/AssignProgramDialog"
import { useFormTour } from "@/hooks/use-form-tour"
import { FormTour } from "@/components/admin/FormTour"
import { TourButton } from "@/components/admin/TourButton"
import { getProgramTourSteps } from "@/lib/tour-steps"
import type { Program, User } from "@/types/database"

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
  price_cents: "Price",
  split_type: "Split type",
  periodization: "Periodization",
  tier: "Tier",
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

const STEPS = [
  { label: "Info", number: 1 },
  { label: "Schedule", number: 2 },
  { label: "Audience", number: 3 },
] as const

type AudienceMode = "public" | "targeted" | "private"

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

  // Audience state
  const [audience, setAudience] = useState<AudienceMode>(() => {
    if (program?.target_user_id) return "targeted"
    if (program?.is_public) return "public"
    return "private"
  })
  const [targetUserId, setTargetUserId] = useState<string | null>(program?.target_user_id ?? null)

  // Clients
  const [clients, setClients] = useState<{ id: string; first_name: string; last_name: string; email: string }[]>([])
  const [loadingClients, setLoadingClients] = useState(false)

  // Post-save state
  const [savedProgramId, setSavedProgramId] = useState<string | null>(null)
  const [showAssign, setShowAssign] = useState(false)

  // Fetch clients when dialog opens
  useEffect(() => {
    if (!open) return
    setLoadingClients(true)
    fetch("/api/admin/users?role=client")
      .then((res) => res.json())
      .then((data) => setClients(Array.isArray(data?.users) ? data.users : []))
      .catch(() => setClients([]))
      .finally(() => setLoadingClients(false))
  }, [open])

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
    setAudience(program?.target_user_id ? "targeted" : program?.is_public ? "public" : "private")
    setTargetUserId(program?.target_user_id ?? null)
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
      price_cents: priceCents,
      split_type: splitType || null,
      periodization: periodization || null,
      is_public: audience === "public",
      target_user_id: audience === "targeted" ? targetUserId : null,
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
      setShowAssign(false)
      setStep(0)
      setDirection(1)
      tour.close()
    }
    onOpenChange(o)
  }

  function handleDone() {
    handleDialogClose(false)
  }

  // ─── Assign step (shown after successful save) ──────────────────────────

  if (savedProgramId && showAssign) {
    return (
      <AssignProgramDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) handleDialogClose(false)
        }}
        programId={savedProgramId}
        clients={clients as User[]}
        assignedUserIds={[]}
      />
    )
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
                Would you like to assign clients to this program?
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleDone}>
              Done
            </Button>
            <Button onClick={() => setShowAssign(true)}>
              <UserPlus className="size-4" />
              Assign to Clients
            </Button>
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
                  targetUserId={targetUserId}
                  setTargetUserId={setTargetUserId}
                  clients={clients}
                  loadingClients={loadingClients}
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
  priceDollars,
  setPriceDollars,
  errors,
  disabled,
}: {
  durationWeeks: string
  setDurationWeeks: (v: string) => void
  sessionsPerWeek: string
  setSessionsPerWeek: (v: string) => void
  priceDollars: string
  setPriceDollars: (v: string) => void
  errors: Partial<Record<keyof ProgramFormData, string[]>>
  disabled: boolean
}) {
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

      {/* Price */}
      <div className="space-y-2">
        <Label htmlFor="price_dollars">Price ($)</Label>
        <Input
          id="price_dollars"
          type="number"
          step="0.01"
          min={0}
          value={priceDollars}
          onChange={(e) => setPriceDollars(e.target.value)}
          placeholder="e.g. 99.99 (leave empty for free)"
          disabled={disabled}
        />
        {errors.price_cents && (
          <p className="text-xs text-destructive">{errors.price_cents[0]}</p>
        )}
      </div>
    </div>
  )
}

// ─── Step 3: Audience ─────────────────────────────────────────────────────────

function Step3Audience({
  audience,
  setAudience,
  targetUserId,
  setTargetUserId,
  clients,
  loadingClients,
  disabled,
}: {
  audience: AudienceMode
  setAudience: (v: AudienceMode) => void
  targetUserId: string | null
  setTargetUserId: (v: string | null) => void
  clients: { id: string; first_name: string; last_name: string; email: string }[]
  loadingClients: boolean
  disabled: boolean
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Who should have access to this program?
      </p>

      <div id="audience-options" className="grid gap-2">
        {/* Sell to All Clients */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setAudience("public"); setTargetUserId(null) }}
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
              Sell to Everyone
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              Available in the store for any client to purchase
            </p>
          </div>
        </button>

        {/* Sell to One Client */}
        <div
          className={cn(
            "rounded-lg border-2 transition-colors",
            audience === "targeted"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/30"
          )}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAudience("targeted")}
            className="flex items-start gap-3 px-4 py-3 text-left w-full"
          >
            <UserCheck className={cn("size-5 shrink-0 mt-0.5", audience === "targeted" ? "text-primary" : "text-muted-foreground")} />
            <div>
              <p className={cn("text-sm font-medium", audience === "targeted" ? "text-primary" : "text-foreground")}>
                Sell to Specific Client
              </p>
              <p className="text-xs text-muted-foreground leading-snug">
                Only visible to one client in their store
              </p>
            </div>
          </button>

          {/* Client selector — inside the card, aligned with the text */}
          {audience === "targeted" && (
            <div className="px-4 pb-3 pl-[48px] space-y-1.5">
              <Label htmlFor="target_user_id" className="text-xs">Select Client *</Label>
              <select
                id="target_user_id"
                value={targetUserId ?? ""}
                onChange={(e) => setTargetUserId(e.target.value || null)}
                disabled={disabled || loadingClients}
                className={selectClass}
              >
                <option value="" disabled>
                  {loadingClients ? "Loading clients..." : "Choose a client"}
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name} — {c.email}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Assign Directly (Free) */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setAudience("private"); setTargetUserId(null) }}
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
              Free / Direct Assign
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              Not in the store — you manually assign it to clients at no cost
            </p>
          </div>
        </button>
      </div>

    </div>
  )
}

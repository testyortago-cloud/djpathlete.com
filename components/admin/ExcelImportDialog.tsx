"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import { rtdb } from "@/lib/firebase"
import { ref, onValue, off } from "firebase/database"
import {
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  Brain,
  Dumbbell,
  ClipboardList,
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
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { AssignProgramDialog } from "@/components/admin/AssignProgramDialog"
import { useAiJobsDock } from "@/hooks/use-ai-jobs-dock"
import type { User } from "@/types/database"
import { summarizeApiError } from "@/lib/errors/humanize"

// ─── Constants ───────────────────────────────────────────────────────────────

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

const IMPORT_STEPS = [
  { key: "parsing", label: "Reading the spreadsheet", icon: FileSpreadsheet },
  { key: "interpreting", label: "AI reading your program", icon: Brain },
  { key: "matching", label: "Matching exercises to your library", icon: Dumbbell },
  { key: "building", label: "Building the program", icon: ClipboardList },
] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapProgressToStep(progress?: {
  status: string
  current_step: number
  total_steps: number
  detail?: string
}): { step: number; detail: string | null } {
  if (!progress) return { step: 0, detail: null }
  const idx = IMPORT_STEPS.findIndex((s) => s.key === progress.status)
  return { step: idx >= 0 ? idx + 1 : progress.current_step, detail: progress.detail ?? null }
}

/** Firebase RTDB drops empty arrays, so matched/created/counts may be undefined after round-trip */
function safeReport(v: unknown): ImportReport {
  const fallback: ImportReport = {
    counts: { days: 0, exercises: 0, weeks: 0 },
    matched: [],
    created: [],
  }
  if (!v || typeof v !== "object") return fallback
  const obj = v as Record<string, unknown>
  const counts = obj.counts && typeof obj.counts === "object" ? (obj.counts as Record<string, unknown>) : undefined
  return {
    counts: {
      days: typeof counts?.days === "number" ? counts.days : fallback.counts.days,
      exercises: typeof counts?.exercises === "number" ? counts.exercises : fallback.counts.exercises,
      weeks: typeof counts?.weeks === "number" ? counts.weeks : fallback.counts.weeks,
    },
    matched: Array.isArray(obj.matched) ? (obj.matched as ImportReport["matched"]) : fallback.matched,
    created: Array.isArray(obj.created) ? (obj.created as ImportReport["created"]) : fallback.created,
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface ImportReport {
  counts: { days: number; exercises: number; weeks: number }
  matched: Array<{ raw_name: string; exercise_id: string; exercise_name: string; method: string; confidence: number }>
  created: Array<{ raw_name: string; exercise_id: string }>
}

interface ImportResult {
  program_id: string
  report: ImportReport
}

interface ExcelImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clients: User[]
}

export function ExcelImportDialog({ open, onOpenChange, clients }: ExcelImportDialogProps) {
  const router = useRouter()
  const { addJob } = useAiJobsDock()

  // Form state
  const [clientId, setClientId] = useState("")
  const [nameOverride, setNameOverride] = useState("")
  const [isPublic, setIsPublic] = useState(false)
  const [notifyEmail, setNotifyEmail] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Import state
  const [isImporting, setIsImporting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [progressStep, setProgressStep] = useState(0)
  const [progressDetail, setProgressDetail] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAssign, setShowAssign] = useState(false)

  const jobRefRef = useRef<ReturnType<typeof ref> | null>(null)

  function stopListening() {
    if (jobRefRef.current) {
      off(jobRefRef.current)
      jobRefRef.current = null
    }
  }

  useEffect(() => {
    return () => stopListening()
  }, [])

  function resetForm() {
    stopListening()
    setClientId("")
    setNameOverride("")
    setIsPublic(false)
    setNotifyEmail("")
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
    setIsImporting(false)
    setIsCancelling(false)
    setActiveJobId(null)
    setProgressStep(0)
    setProgressDetail(null)
    setResult(null)
    setError(null)
    setShowAssign(false)
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen && !isImporting) resetForm()
    if (!isImporting) onOpenChange(newOpen)
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
        setIsImporting(false)
        setError(null)
        toast.info("Import cancelled")
        resetForm()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || "Failed to cancel")
      }
    } catch {
      toast.error("Failed to cancel import")
    } finally {
      setIsCancelling(false)
    }
  }

  async function handleSubmit() {
    if (!file) {
      toast.error("Please choose a spreadsheet to import")
      return
    }

    setIsImporting(true)
    setError(null)
    setResult(null)
    setProgressStep(0)

    try {
      const fd = new FormData()
      fd.append("file", file)
      if (clientId) fd.append("client_id", clientId)
      fd.append("is_public", isPublic ? "true" : "false")
      if (nameOverride.trim()) fd.append("name_override", nameOverride.trim())
      if (notifyEmail.trim()) fd.append("notify_email", notifyEmail.trim())

      const response = await fetch("/api/admin/programs/import-excel", {
        method: "POST",
        body: fd,
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const { message } = summarizeApiError(response, data, "Failed to import spreadsheet")
        throw new Error(message)
      }

      if (response.status === 202 && data.jobId) {
        setActiveJobId(data.jobId)
        addJob({ jobId: data.jobId, kind: "excel_import", label: "Excel import" })

        const jobRef = ref(rtdb, `ai_jobs/${data.jobId}`)
        jobRefRef.current = jobRef

        onValue(
          jobRef,
          (snapshot) => {
            const jobData = snapshot.val()
            if (!jobData) return

            if (jobData.progress) {
              const { step, detail } = mapProgressToStep(jobData.progress)
              setProgressStep(step)
              setProgressDetail(detail)
            }

            if (jobData.status === "completed" && jobData.result) {
              stopListening()
              setResult({
                program_id: jobData.result.program_id,
                report: safeReport(jobData.result.report),
              })
              setIsImporting(false)
              toast.success("Program imported successfully!")
              router.refresh()
            } else if (jobData.status === "failed") {
              stopListening()
              setError(jobData.error || "Import failed")
              setIsImporting(false)
              toast.error("Import failed")
            } else if (jobData.status === "cancelled") {
              stopListening()
              setIsImporting(false)
              toast.info("Import cancelled")
            }
          },
          (err) => {
            console.error("[ExcelImportDialog] RTDB listener error:", err)
            stopListening()
            setError("Lost connection to import updates")
            setIsImporting(false)
            toast.error("Connection lost")
          },
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred"
      setError(message)
      setIsImporting(false)
      toast.error("Import failed")
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
        priceCents={null}
        clients={clients}
        assignedUserIds={[]}
      />
    )
  }

  // Success result view
  if (result) {
    const { counts, matched, created } = result.report
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" />
              Program Imported
            </DialogTitle>
            <DialogDescription>
              Imported {counts.exercises} exercise{counts.exercises !== 1 ? "s" : ""} across {counts.weeks} week
              {counts.weeks !== 1 ? "s" : ""}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="rounded-lg bg-surface/50 border border-border p-3">
              <div className="text-xs text-muted-foreground">Days</div>
              <div className="text-sm font-medium font-heading">{counts.days}</div>
            </div>
            <div className="rounded-lg bg-surface/50 border border-border p-3">
              <div className="text-xs text-muted-foreground">Weeks</div>
              <div className="text-sm font-medium font-heading">{counts.weeks}</div>
            </div>
            <div className="rounded-lg bg-surface/50 border border-border p-3">
              <div className="text-xs text-muted-foreground">Matched</div>
              <div className="text-sm font-medium font-heading">{matched.length}</div>
            </div>
            <div className="rounded-lg bg-surface/50 border border-border p-3">
              <div className="text-xs text-muted-foreground">New Exercises</div>
              <div className="text-sm font-medium font-heading">{created.length}</div>
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

  // Loading / importing view
  if (isImporting) {
    const progressPercent = Math.round((progressStep / IMPORT_STEPS.length) * 100)

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col py-6 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
                <FileSpreadsheet className="size-4 text-primary animate-pulse" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-sm text-foreground">Importing Program</h3>
                <p className="text-xs text-muted-foreground">
                  Step {progressStep} of {IMPORT_STEPS.length}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
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
              {IMPORT_STEPS.map((s, idx) => {
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
              {isCancelling ? "Cancelling..." : "Cancel Import"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // ─── Upload form ──────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-heading font-semibold text-foreground">
            <FileSpreadsheet className="size-5 text-accent" />
            Import from Excel
          </DialogTitle>
          <DialogDescription>
            Upload a spreadsheet of your program and AI will build a structured training program from it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Error banner */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
              <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Import Failed</p>
                <p className="text-xs text-destructive/80">{error}</p>
              </div>
            </div>
          )}

          {/* Template download */}
          <a
            href="/api/admin/programs/import-excel/template"
            className="flex items-center gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Download className="size-4" />
            Download the template
          </a>

          {/* Client select */}
          <div className="space-y-2">
            <Label htmlFor="excel-client">Client (optional)</Label>
            <select
              id="excel-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={selectClass}
            >
              <option value="">No client (generic program)</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.first_name} {client.last_name} ({client.email})
                </option>
              ))}
            </select>
          </div>

          {/* Program name override */}
          <div className="space-y-2">
            <Label htmlFor="excel-name">Program name override</Label>
            <Input
              id="excel-name"
              value={nameOverride}
              onChange={(e) => setNameOverride(e.target.value)}
              placeholder="Leave blank to use the AI-detected name"
            />
          </div>

          {/* Public toggle */}
          <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:bg-surface/50 transition-colors">
            <Checkbox checked={isPublic} onCheckedChange={(v) => setIsPublic(v === true)} />
            <span className="text-sm font-medium">Public — visible in the store</span>
          </label>

          {/* Notify email */}
          <div className="space-y-2">
            <Label htmlFor="excel-notify">Notify email when done</Label>
            <Input
              id="excel-notify"
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          {/* File input */}
          <div className="space-y-2">
            <Label htmlFor="excel-file">Spreadsheet *</Label>
            <input
              id="excel-file"
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary-foreground"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!file}>
            <FileSpreadsheet className="size-4" />
            Import Program
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

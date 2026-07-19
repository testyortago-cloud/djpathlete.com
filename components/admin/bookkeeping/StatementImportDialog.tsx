"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { rtdb } from "@/lib/firebase"
import { ref, onValue, off } from "firebase/database"
import { Upload, Loader2, CheckCircle2, XCircle, AlertTriangle, FileText, Brain, ListChecks } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import { useAiJobsDock } from "@/hooks/use-ai-jobs-dock"
import { summarizeApiError } from "@/lib/errors/humanize"
import type { BookkeepingAccount, BookKind } from "@/types/database"
import type { AnnotatedStatementRow, DedupeInputRow } from "@/lib/bookkeeping/statement-dedupe"

/**
 * AI Bookkeeper Phase 2, Task 15 — statement import review dialog. Composes
 * two proven patterns: ExcelImportDialog's upload + RTDB-polling + progress
 * checklist + cancel machinery, and ImportPlatformDialog's review grid +
 * warnings banner + non-business confirm gate. Flow: upload -> AI job
 * (parsing -> categorizing -> finalizing) -> dedupe -> review -> post.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const STMT_STEPS = [
  { key: "parsing", label: "Reading the statement", icon: FileText },
  { key: "categorizing", label: "AI categorizing transactions", icon: Brain },
  { key: "finalizing", label: "Finalizing", icon: ListChecks },
] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapProgressToStep(progress?: {
  status: string
  current_step: number
  total_steps: number
  detail?: string
}): { step: number; detail: string | null } {
  if (!progress) return { step: 0, detail: null }
  const idx = STMT_STEPS.findIndex((s) => s.key === progress.status)
  return { step: idx >= 0 ? idx + 1 : progress.current_step, detail: progress.detail ?? null }
}

/** Firebase RTDB drops empty arrays AND `null` leaf values, so `result.rows`/
 *  `result.warnings` may be undefined after round-trip even though the job
 *  wrote a non-empty array, and an uncategorized row's `suggested_category`
 *  (written as `null`) may be missing entirely on read-back. Coalesce it back
 *  to `null` here — the single boundary where RTDB-shaped data enters the
 *  component — so every downstream consumer (the dedupe POST body, the
 *  review-grid render) can keep assuming the field is always present. */
function safeResultRows(v: unknown): JobResultRow[] {
  if (!Array.isArray(v)) return []
  return (v as JobResultRow[]).map((r) => ({
    ...r,
    suggested_category: r.suggested_category ?? null,
    confidence: r.confidence ?? "low",
  }))
}

function safeResultWarnings(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : []
}

/** Case-insensitive match against an account of the same account_type as the
 *  row's direction. Falls back to "" (Uncategorized) with no match. */
function resolveAccount(row: DedupeInputRow, accounts: BookkeepingAccount[]): string {
  if (!row.suggested_category) return ""
  const needle = row.suggested_category.trim().toLowerCase()
  const match = accounts.find((a) => a.account_type === row.direction && a.name.trim().toLowerCase() === needle)
  return match?.id ?? ""
}

function buildDraftRows(annotated: AnnotatedStatementRow[], accounts: BookkeepingAccount[]): DraftRow[] {
  return annotated.map((a) => ({
    ...a.row,
    include: a.defaultInclude,
    accountId: resolveAccount(a.row, accounts),
    possibleDuplicate: a.possibleDuplicate,
    reason: a.reason,
    newCandidate: a.newCandidate,
  }))
}

function rowFlag(row: DraftRow): { label: string; tone: "warning" | "muted" } | null {
  if (row.possibleDuplicate) return { label: "Possible duplicate", tone: "warning" }
  if (row.is_transfer) return { label: "Transfer", tone: "muted" }
  if (row.transferSuspect) return { label: "Possible transfer", tone: "warning" }
  return null
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape of a row inside the completed job's `result.rows` — the deterministic
 *  fields plus the AI's per-row categorization. No `source_ref` yet (the
 *  dedupe route computes that over the full row set). */
type JobResultRow = Omit<DedupeInputRow, "source_ref" | "transferSuspect">

interface DraftRow extends DedupeInputRow {
  include: boolean
  accountId: string
  possibleDuplicate: boolean
  reason: string | null
  newCandidate: boolean
}

type Step = "upload" | "empty" | "review"

interface StatementImportDialogProps {
  bookId: string
  bookKind: BookKind
  bookIsPrimary: boolean
  bookName: string
  accounts: BookkeepingAccount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

// ─── Row flag cell ───────────────────────────────────────────────────────────

function RowFlagCell({ row }: { row: DraftRow }) {
  const flag = rowFlag(row)
  if (!flag && !row.reason) return <span className="text-muted-foreground">—</span>
  return (
    <div className="space-y-1">
      {flag && (
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            flag.tone === "warning"
              ? "border-warning/30 bg-warning/10 text-warning"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {flag.label}
        </Badge>
      )}
      {row.reason && (
        <p className={cn("text-[11px]", flag ? "text-muted-foreground" : "text-warning/90")}>{row.reason}</p>
      )}
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StatementImportDialog({
  bookId,
  bookKind,
  bookIsPrimary,
  bookName,
  accounts,
  open,
  onOpenChange,
  onSaved,
}: StatementImportDialogProps) {
  const { addJob } = useAiJobsDock()

  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>("upload")
  const [isImporting, setIsImporting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [progressStep, setProgressStep] = useState(0)
  const [progressDetail, setProgressDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [rows, setRows] = useState<DraftRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [excludedTransferTotalCents, setExcludedTransferTotalCents] = useState(0)
  const [documentOverlapWarning, setDocumentOverlapWarning] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  // D-4 follow-up: closed-month rejections must not vanish with a transient
  // toast. This dialog has no persistent post-commit result screen (it just
  // toasts + closes), so we keep the dialog open and surface a persistent
  // amber line above the action buttons whenever the commit returns
  // rejected_closed > 0.
  const [rejectedClosedCount, setRejectedClosedCount] = useState(0)
  // Platform business income is almost always Darren's primary book — importing
  // a bank/Venmo statement into a household/non-primary book is very likely a
  // mis-click, so require an explicit confirmation there (same gate as
  // ImportPlatformDialog).
  const [confirmNonBusiness, setConfirmNonBusiness] = useState(false)
  const isNonBusinessBook = bookKind === "household" || !bookIsPrimary

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
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
    setStep("upload")
    setIsImporting(false)
    setIsCancelling(false)
    setActiveJobId(null)
    setDocumentId(null)
    setProgressStep(0)
    setProgressDetail(null)
    setError(null)
    setRows([])
    setWarnings([])
    setExcludedTransferTotalCents(0)
    setDocumentOverlapWarning(null)
    setPosting(false)
    setConfirmNonBusiness(false)
    setRejectedClosedCount(0)
  }

  // Reset every time the dialog is (re)opened so a prior run never leaks into
  // the next one — matches the reset-on-open convention used elsewhere.
  useEffect(() => {
    if (open) resetForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleOpenChange(newOpen: boolean) {
    // Block dismissal (Escape/backdrop/X) while a job is in flight — the user
    // must use the Cancel button so the RTDB listener + job are torn down
    // cleanly instead of orphaned. Also block mid-commit (posting) so closing
    // the review dialog can't orphan the in-flight POST.
    if (!newOpen && (isImporting || posting)) return
    onOpenChange(newOpen)
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
        toast.info("Statement import cancelled")
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

  async function handleJobCompleted(result: unknown) {
    const r = (result ?? {}) as { rows?: unknown; warnings?: unknown }
    const resultRows = safeResultRows(r.rows)
    const resultWarnings = safeResultWarnings(r.warnings)

    if (resultRows.length === 0) {
      setIsImporting(false)
      setStep("empty")
      return
    }

    try {
      const res = await fetch("/api/admin/bookkeeping/statement-import/dedupe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          rows: resultRows.map((row) => ({
            occurred_on: row.occurred_on,
            amount_cents: row.amount_cents,
            direction: row.direction,
            description: row.description,
            suggested_category: row.suggested_category,
            is_transfer: row.is_transfer,
            confidence: row.confidence,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const { message } = summarizeApiError(res, data, "Failed to review the statement")
        setError(message)
        setIsImporting(false)
        toast.error("Import failed")
        return
      }
      const annotated = (data.rows ?? []) as AnnotatedStatementRow[]
      setRows(buildDraftRows(annotated, accounts))
      setExcludedTransferTotalCents(
        typeof data.excludedTransferTotalCents === "number" ? data.excludedTransferTotalCents : 0,
      )
      setDocumentOverlapWarning(typeof data.documentOverlapWarning === "string" ? data.documentOverlapWarning : null)
      setWarnings(resultWarnings)
      setIsImporting(false)
      setStep("review")
    } catch {
      setError("Something went wrong reviewing the statement")
      setIsImporting(false)
      toast.error("Import failed")
    }
  }

  async function handleSubmit() {
    if (!file) {
      toast.error("Please choose a statement to import")
      return
    }

    setIsImporting(true)
    setError(null)
    setProgressStep(0)

    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("book_id", bookId)

      const response = await fetch("/api/admin/bookkeeping/statement-import", {
        method: "POST",
        body: fd,
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const { message } = summarizeApiError(response, data, "Failed to import statement")
        throw new Error(message)
      }

      if (response.status === 202 && data.jobId) {
        setActiveJobId(data.jobId)
        setDocumentId(typeof data.documentId === "string" ? data.documentId : null)
        addJob({ jobId: data.jobId, kind: "statement_import", label: "Statement import" })

        if (data.duplicateUploadHint) {
          toast.info(`You may have already uploaded this file on ${formatOccurredOn(String(data.duplicateUploadHint).slice(0, 10))}`)
        }

        const jobRef = ref(rtdb, `ai_jobs/${data.jobId}`)
        jobRefRef.current = jobRef

        onValue(
          jobRef,
          (snapshot) => {
            const jobData = snapshot.val()
            if (!jobData) return

            if (jobData.progress) {
              const { step: mappedStep, detail } = mapProgressToStep(jobData.progress)
              setProgressStep(mappedStep)
              setProgressDetail(detail)
            }

            if (jobData.status === "completed") {
              stopListening()
              void handleJobCompleted(jobData.result)
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
            console.error("[StatementImportDialog] RTDB listener error:", err)
            stopListening()
            setError("Lost connection to import updates")
            setIsImporting(false)
            toast.error("Connection lost")
          },
        )
      } else {
        setIsImporting(false)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred"
      setError(message)
      setIsImporting(false)
      toast.error("Import failed")
      stopListening()
    }
  }

  function updateRow(sourceRef: string, patch: Partial<DraftRow>) {
    setRows((list) => list.map((r) => (r.source_ref === sourceRef ? { ...r, ...patch } : r)))
  }

  const includedRows = rows.filter((r) => r.include)

  async function commit() {
    if (includedRows.length === 0) {
      toast.error("Select at least one entry to post")
      return
    }
    if (isNonBusinessBook && !confirmNonBusiness) return
    setPosting(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/statement-import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          document_id: documentId ?? undefined,
          entries: includedRows.map((r) => ({
            direction: r.direction,
            amount_cents: r.amount_cents,
            occurred_on: r.occurred_on,
            memo: r.description,
            counterparty: null,
            service_line: null,
            source: "statement_import",
            source_ref: r.source_ref,
            account_id: r.accountId || null,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const { message } = summarizeApiError(res, data, "Failed to import entries")
        toast.error(message)
        return
      }
      const inserted = typeof data.inserted === "number" ? data.inserted : 0
      const rejectedClosed = typeof data.rejected_closed === "number" ? data.rejected_closed : 0
      const skipped = includedRows.length - inserted - rejectedClosed
      setRejectedClosedCount(rejectedClosed)
      if (rejectedClosed > 0) {
        toast.warning(
          `${rejectedClosed} row${rejectedClosed === 1 ? " falls" : "s fall"} in closed months — post them as adjustment entries in an open month.`,
        )
      }
      if (skipped > 0) {
        toast.success(`Posted ${inserted} ${inserted === 1 ? "entry" : "entries"} (${skipped} already recorded — skipped).`)
      } else {
        toast.success(`Posted ${inserted} ${inserted === 1 ? "entry" : "entries"}.`)
      }
      onSaved()
      // Keep the dialog open when rows were rejected for a closed month so
      // the coach sees the persistent amber line below instead of it
      // vanishing with the transient toast.
      if (rejectedClosed === 0) {
        onOpenChange(false)
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setPosting(false)
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  // Processing view
  if (isImporting) {
    const progressPercent = Math.round((progressStep / STMT_STEPS.length) * 100)

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col py-6 space-y-5">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="size-4 text-primary animate-pulse" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-sm text-foreground">Importing Statement</h3>
                <p className="text-xs text-muted-foreground">
                  Step {progressStep} of {STMT_STEPS.length}
                </p>
              </div>
            </div>

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

            <div className="space-y-1">
              {STMT_STEPS.map((s, idx) => {
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

  // Empty-result view
  if (step === "empty") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-5 text-muted-foreground" />
              No transactions detected
            </DialogTitle>
            <DialogDescription>
              We couldn&apos;t find any transaction rows in this file. Is this a scanned image PDF? Full OCR support
              arrives in Phase 3 — for now, try a text-based PDF export or a CSV.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Review grid
  if (step === "review") {
    const hasIncomeRows = rows.some((r) => r.direction === "income")
    const mainRows = rows.filter((r) => !(r.direction === "income" && r.newCandidate))
    const newCandidateRows = rows.filter((r) => r.direction === "income" && r.newCandidate)

    const renderRow = (row: DraftRow) => {
      const eligible = accounts.filter((a) => a.account_type === row.direction)
      return (
        <tr
          key={row.source_ref}
          className={cn("border-b border-border last:border-b-0", row.confidence === "low" && "bg-warning/5")}
        >
          <td className="px-2 py-2">
            <Checkbox
              checked={row.include}
              onCheckedChange={(v) => updateRow(row.source_ref, { include: v === true })}
              aria-label={`Include ${row.description}`}
            />
          </td>
          <td className="px-2 py-2 whitespace-nowrap">{formatOccurredOn(row.occurred_on)}</td>
          <td className="px-2 py-2">
            {row.description}
            {row.confidence === "low" && <span className="ml-1.5 text-[10px] text-warning">low confidence</span>}
          </td>
          <td className={cn("px-2 py-2 text-right font-mono", row.direction === "income" ? "text-success" : "text-error")}>
            {row.direction === "income" ? "+" : "−"}
            {formatCents(row.amount_cents)}
          </td>
          <td className="px-2 py-2">
            <select
              value={row.accountId}
              onChange={(e) => updateRow(row.source_ref, { accountId: e.currentTarget.value })}
              disabled={!row.include}
              className="border-border rounded-md border bg-transparent px-1.5 py-1 text-xs"
              aria-label={`Category for ${row.description}`}
            >
              <option value="">Uncategorized</option>
              {eligible.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </td>
          <td className="px-2 py-2 max-w-48">
            <RowFlagCell row={row} />
          </td>
        </tr>
      )
    }

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review statement import</DialogTitle>
            <DialogDescription>
              Uncheck anything that shouldn&apos;t post. Nothing is saved until you post below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
                <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive/80">{error}</p>
              </div>
            )}

            {hasIncomeRows && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  Income caution
                </div>
                <p className="text-xs text-warning/90">
                  Bank/Venmo income is likely already recorded as platform income — leave these unchecked unless it
                  never went through the platform.
                </p>
              </div>
            )}

            {excludedTransferTotalCents > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  Transfers excluded
                </div>
                <p className="text-xs text-warning/90">
                  We excluded {formatCents(excludedTransferTotalCents)} of transfers/card payments. If any is a
                  credit-card payment, import that card&apos;s statement so its purchases are counted.
                </p>
              </div>
            )}

            {documentOverlapWarning && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  Overlapping statement
                </div>
                <p className="text-xs text-warning/90">{documentOverlapWarning}</p>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                </div>
                <ul className="text-xs text-warning/90 space-y-1 list-disc pl-5">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="overflow-x-auto border border-border rounded-lg max-h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border">
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground w-8" />
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">Date</th>
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">Description</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground">Amount</th>
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">Account</th>
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {mainRows.map(renderRow)}
                  {newCandidateRows.length > 0 && (
                    <>
                      <tr>
                        <td
                          colSpan={6}
                          className="bg-accent/5 px-2 py-1.5 text-[11px] font-medium text-accent uppercase tracking-wide"
                        >
                          New — opt-in candidate
                        </td>
                      </tr>
                      {newCandidateRows.map(renderRow)}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {isNonBusinessBook && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  Non-business book selected
                </div>
                <p className="text-xs text-warning/90">
                  You&apos;re importing a bank/Venmo statement into the &ldquo;{bookName}&rdquo; book. Statement
                  imports normally belong in your primary business book. Post here only if you&apos;re sure.
                </p>
                <div className="flex items-start gap-2 pt-1">
                  <Checkbox
                    id="stmt-confirm-non-business"
                    checked={confirmNonBusiness}
                    onCheckedChange={(v) => setConfirmNonBusiness(v === true)}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="stmt-confirm-non-business"
                    className="text-xs text-warning/90 leading-relaxed cursor-pointer"
                  >
                    I understand — post into this non-business book
                  </Label>
                </div>
              </div>
            )}
          </div>

          {rejectedClosedCount > 0 && (
            <p className="text-sm font-medium text-warning">
              {rejectedClosedCount} row{rejectedClosedCount === 1 ? "" : "s"}{" "}
              {rejectedClosedCount === 1 ? "falls" : "fall"} in closed months — post them as adjustment entries in
              the current open month.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={posting}>
              Cancel
            </Button>
            <Button
              onClick={commit}
              disabled={posting || includedRows.length === 0 || (isNonBusinessBook && !confirmNonBusiness)}
            >
              {posting ? "Posting…" : `Post ${includedRows.length} ${includedRows.length === 1 ? "entry" : "entries"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // ─── Upload form ──────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-heading font-semibold text-foreground">
            <Upload className="size-5 text-accent" />
            Import bank/Venmo statement
          </DialogTitle>
          <DialogDescription>
            Upload a CSV or PDF statement and AI will structure, categorize, and flag likely duplicates for review
            before anything posts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
              <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Import Failed</p>
                <p className="text-xs text-destructive/80">{error}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="stmt-file">Statement file *</Label>
            <input
              id="stmt-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary-foreground"
            />
            <p className="text-xs text-muted-foreground">CSV (bank/Venmo export) or PDF. Max 10 MB.</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!file}>
            <Upload className="size-4" />
            Upload &amp; Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { subscribeToJob, type JobSnapshot } from "@/lib/firebase/job-subscription"
import { Upload, Loader2, CheckCircle2, XCircle, FileText, Brain, ListChecks, ShoppingCart, AlertTriangle } from "lucide-react"
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
import { cn } from "@/lib/utils"
import { parseDollarsToCents, centsToDollarInput } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import { accountRequiresBusinessPurpose } from "@/lib/bookkeeping/receipts"
import { useAiJobsDock } from "@/hooks/use-ai-jobs-dock"
import { summarizeApiError } from "@/lib/errors/humanize"
import type { BookkeepingAccount } from "@/types/database"

/**
 * AI Bookkeeper Phase 3, Task 17 — Amazon order-history CSV import review
 * dialog. Clones StatementImportDialog's upload -> RTDB-poll -> review ->
 * post shell (job-doc listener, cancel route, progress-step mapping), with
 * three deliberate departures:
 *  - the job here is the SHIPPED statement_import job running in
 *    csv_structured mode (functions/src/statement-import.ts) — only 2
 *    progress steps (categorizing, finalizing), no "parsing" step, since
 *    lib/bookkeeping/amazon-parse.ts already deterministically parsed the
 *    CSV server-side before the job doc was created;
 *  - there is NO dedupe pass — Amazon purchases don't cross-reference bank
 *    statements the way platform income does. `result.rows` is zipped
 *    directly to the `refs` array the upload route returned, by index: the
 *    job contract guarantees exactly one output row per input row, in
 *    input order (see route + functions comments), so index-zip is safe
 *    IF AND ONLY IF the lengths match — a length mismatch is treated as a
 *    contract violation and aborts before any pairing happens;
 *  - every row posts as an expense (Amazon order lines are never income),
 *    so the category `<select>` is always expense-only regardless of the
 *    AI's per-row `direction` guess.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const AMZ_STEPS = [
  { key: "categorizing", label: "AI categorizing purchases", icon: Brain },
  { key: "finalizing", label: "Finalizing", icon: ListChecks },
] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapProgressToStep(progress?: JobSnapshot["progress"]): { step: number; detail: string | null } {
  if (!progress) return { step: 0, detail: null }
  const idx = AMZ_STEPS.findIndex((s) => s.key === progress.status)
  return { step: idx >= 0 ? idx + 1 : (progress.current_step ?? 0), detail: progress.detail ?? null }
}

/** Shape of a row inside the completed job's `result.rows` — the shipped
 *  statement_import job returns this same shape regardless of upload
 *  source (bank statement vs. Amazon CSV). No `source_ref` — that's the
 *  `refs` array from the 202 response, joined back in below by index. */
interface JobResultRow {
  occurred_on: string
  description: string
  amount_cents: number
  direction: "income" | "expense"
  suggested_category: string | null
  is_transfer: boolean
  confidence: "low" | "medium" | "high"
}

/** Firebase RTDB drops empty arrays AND `null` leaf values, so a fully
 *  uncategorized row's `suggested_category` (written as `null`) may be
 *  missing entirely on read-back. Coalesce it back to `null` here — the
 *  single boundary where RTDB-shaped data enters the component — same twin
 *  as StatementImportDialog's safeResultRows. */
function safeResultRows(v: unknown): JobResultRow[] {
  if (!Array.isArray(v)) return []
  return (v as JobResultRow[]).map((r) => ({
    ...r,
    suggested_category: r.suggested_category ?? null,
    confidence: r.confidence ?? "low",
  }))
}

/** RTDB drops empty arrays, so an absent `warnings` means "none". */
function safeResultWarnings(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : []
}

interface DraftRow extends JobResultRow {
  source_ref: string
  include: boolean
  accountId: string
  businessPurpose: string
  /** The coach-editable money field; `amount_cents` stays the parsed truth.
   *  Twin of StatementImportDialog's amountInput. */
  amountInput: string
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** What still stops a ticked row from posting — the commit route requires a
 *  YYYY-MM-DD date and a non-negative integer amount. */
function rowBlocker(row: DraftRow): string | null {
  if (!ISO_DATE_RE.test(row.occurred_on)) return "needs a date"
  const cents = parseDollarsToCents(row.amountInput)
  if (cents === null) return "amount isn't a number"
  if (cents === 0) return "amount is $0.00"
  return null
}

/** Case-insensitive match against an expense account. Every Amazon row
 *  posts as direction:"expense" regardless of the AI's suggested
 *  direction, so this always filters to account_type "expense". Falls
 *  back to "" (Uncategorized) with no match. */
function resolveExpenseAccount(suggestedCategory: string | null, accounts: BookkeepingAccount[]): string {
  if (!suggestedCategory) return ""
  const needle = suggestedCategory.trim().toLowerCase()
  const match = accounts.find((a) => a.account_type === "expense" && a.name.trim().toLowerCase() === needle)
  return match?.id ?? ""
}

/** The money-critical join: zip the job's result rows to the source_refs
 *  captured at upload time, strictly by index. Callers MUST verify
 *  `rows.length === refs.length` before calling this — a mismatch means
 *  the pairing below would silently misattribute amounts to the wrong
 *  Amazon order line. */
function zipRowsToRefs(rows: JobResultRow[], refs: string[], accounts: BookkeepingAccount[]): DraftRow[] {
  return rows.map((r, i) => ({
    ...r,
    source_ref: refs[i],
    include: !r.is_transfer,
    accountId: resolveExpenseAccount(r.suggested_category, accounts),
    businessPurpose: "",
    amountInput: centsToDollarInput(r.amount_cents),
  }))
}

/** Whether a row's currently-selected category is an IRS-sensitive account
 *  (Meals/Travel/Vehicle) that requires a business_purpose before posting —
 *  mirrors the server-side gate in receipts/amazon/commit/route.ts. */
function rowRequiresBusinessPurpose(row: DraftRow, accounts: BookkeepingAccount[]): boolean {
  if (!row.accountId) return false
  const account = accounts.find((a) => a.id === row.accountId)
  return account ? accountRequiresBusinessPurpose(account) : false
}

type Step = "upload" | "empty" | "review"

interface AmazonImportDialogProps {
  bookId: string
  accounts: BookkeepingAccount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AmazonImportDialog({ bookId, accounts, open, onOpenChange, onSaved }: AmazonImportDialogProps) {
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
  // Order lines the parser had to drop (cancelled orders, unreadable amounts,
  // the 500-row cap). They must be visible on the review screen — a silent
  // under-import reads as a complete one.
  const [warnings, setWarnings] = useState<string[]>([])
  const [posting, setPosting] = useState(false)
  // D-4 follow-up: closed-month rejections must not vanish with a transient
  // toast. This dialog has no persistent post-commit result screen (it just
  // toasts + closes), so we keep the dialog open and surface a persistent
  // amber line above the action buttons whenever the commit returns
  // rejected_closed > 0.
  const [rejectedClosedCount, setRejectedClosedCount] = useState(0)

  const jobUnsubRef = useRef<(() => void) | null>(null)

  function stopListening() {
    if (jobUnsubRef.current) {
      jobUnsubRef.current()
      jobUnsubRef.current = null
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
    setPosting(false)
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
        toast.info("Amazon import cancelled")
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

  function handleJobCompleted(result: unknown, uploadRefs: string[]) {
    const r = (result ?? {}) as { rows?: unknown; warnings?: unknown }
    const resultRows = safeResultRows(r.rows)
    setWarnings(safeResultWarnings(r.warnings))

    if (resultRows.length === 0) {
      setIsImporting(false)
      setStep("empty")
      return
    }

    // Contract violation guard — the statement job returns exactly one
    // output row per input row, in input order. A length mismatch means the
    // index-zip below would silently mispair amounts to the wrong order
    // line, so refuse to proceed rather than guess.
    if (resultRows.length !== uploadRefs.length) {
      console.error(
        `[AmazonImportDialog] result.rows length (${resultRows.length}) !== refs length (${uploadRefs.length})`,
      )
      setError("The import result didn't line up with the uploaded rows — please try again.")
      setIsImporting(false)
      toast.error("Import failed")
      return
    }

    setRows(zipRowsToRefs(resultRows, uploadRefs, accounts))
    setIsImporting(false)
    setStep("review")
  }

  async function handleSubmit() {
    if (!file) {
      toast.error("Please choose an Amazon order-history CSV to import")
      return
    }

    setIsImporting(true)
    setError(null)
    setProgressStep(0)

    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("book_id", bookId)

      const response = await fetch("/api/admin/bookkeeping/receipts/amazon", {
        method: "POST",
        body: fd,
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const { message } = summarizeApiError(response, data, "Failed to import Amazon CSV")
        throw new Error(message)
      }

      if (response.status === 202 && data.jobId) {
        const uploadRefs = Array.isArray(data.refs) ? (data.refs as string[]) : []
        setActiveJobId(data.jobId)
        setDocumentId(typeof data.documentId === "string" ? data.documentId : null)
        addJob({ jobId: data.jobId, kind: "receipt_scan", label: "Amazon import" })

        if (data.duplicateUploadHint) {
          toast.info(
            `You may have already uploaded this file on ${formatOccurredOn(String(data.duplicateUploadHint).slice(0, 10))}`,
          )
        }

        jobUnsubRef.current = subscribeToJob(
          data.jobId,
          (jobData) => {
            if (jobData.progress) {
              const { step: mappedStep, detail } = mapProgressToStep(jobData.progress)
              setProgressStep(mappedStep)
              setProgressDetail(detail)
            }

            if (jobData.status === "completed") {
              stopListening()
              handleJobCompleted(jobData.result, uploadRefs)
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
            console.error("[AmazonImportDialog] job listener error:", err)
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

  /** Money edits keep the raw text AND re-derive amount_cents (string-split
   *  cents — never parseFloat), so what posts is what the coach can see.
   *  Unparseable text leaves the last good cents and rowBlocker() stops the
   *  post, so a typo can't post a stale amount. */
  function updateAmount(sourceRef: string, raw: string) {
    const cents = parseDollarsToCents(raw)
    updateRow(sourceRef, cents === null ? { amountInput: raw } : { amountInput: raw, amount_cents: cents })
  }

  const includedRows = rows.filter((r) => r.include)
  const expenseAccounts = accounts.filter((a) => a.account_type === "expense")
  const purposeMissingRows = includedRows.filter(
    (r) => rowRequiresBusinessPurpose(r, accounts) && r.businessPurpose.trim().length === 0,
  )
  const blockedRows = includedRows.filter((r) => rowBlocker(r) !== null)
  const allIncluded = rows.length > 0 && rows.every((r) => r.include)

  /** Why the Post button is disabled, in the coach's words — a greyed button
   *  with no explanation reads as a broken screen. */
  const postBlockedReason: string | null =
    includedRows.length === 0
      ? "Nothing is ticked yet — tick a row's checkbox on the left to post it."
      : blockedRows.length > 0
        ? `${blockedRows.length} ticked row${blockedRows.length === 1 ? "" : "s"} still ${blockedRows.length === 1 ? "needs" : "need"} a valid date and amount.`
        : purposeMissingRows.length > 0
          ? `Add a business purpose for ${purposeMissingRows.length} ${purposeMissingRows.length === 1 ? "entry" : "entries"} in a sensitive category (Meals/Travel/Vehicle).`
          : null

  async function commit() {
    if (includedRows.length === 0) {
      toast.error("Select at least one entry to post")
      return
    }
    if (blockedRows.length > 0) {
      toast.error("Fix the flagged date/amount fields before posting")
      return
    }
    if (purposeMissingRows.length > 0) {
      toast.error("Add a business purpose for every sensitive-category entry before posting")
      return
    }
    setPosting(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/receipts/amazon/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          document_id: documentId ?? undefined,
          entries: includedRows.map((r) => ({
            direction: "expense",
            amount_cents: r.amount_cents,
            occurred_on: r.occurred_on,
            memo: r.description,
            counterparty: "Amazon",
            business_purpose: r.businessPurpose.trim() || null,
            service_line: null,
            source: "receipt",
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
    const progressPercent = Math.round((progressStep / AMZ_STEPS.length) * 100)

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col py-6 space-y-5">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="size-4 text-primary animate-pulse" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-sm text-foreground">Importing Amazon Orders</h3>
                <p className="text-xs text-muted-foreground">
                  Step {progressStep} of {AMZ_STEPS.length}
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
              {AMZ_STEPS.map((s, idx) => {
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
              No orders detected
            </DialogTitle>
            <DialogDescription>
              We couldn&apos;t find any order lines in this file. Make sure it&apos;s an unmodified export from
              Amazon&apos;s &ldquo;Order History Reports&rdquo; tool.
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
    const renderRow = (row: DraftRow) => {
      const blocker = row.include ? rowBlocker(row) : null
      return (
      <tr
        key={row.source_ref}
        className={cn("border-b border-border last:border-b-0", row.confidence === "low" && "bg-warning/5")}
      >
        <td className="px-2 py-2 align-top">
          <Checkbox
            checked={row.include}
            onCheckedChange={(v) => updateRow(row.source_ref, { include: v === true })}
            aria-label={`Include ${row.description}`}
          />
        </td>
        <td className="px-2 py-2 align-top">
          <input
            type="date"
            value={row.occurred_on}
            onChange={(e) => updateRow(row.source_ref, { occurred_on: e.currentTarget.value })}
            className="border-border w-32 rounded-md border bg-transparent px-1.5 py-1 text-xs"
            aria-label={`Date for ${row.description}`}
          />
        </td>
        <td className="px-2 py-2 align-top">
          <input
            type="text"
            value={row.description}
            onChange={(e) => updateRow(row.source_ref, { description: e.currentTarget.value })}
            className="border-border w-full min-w-40 rounded-md border bg-transparent px-1.5 py-1 text-xs"
            aria-label={`Description for ${row.description}`}
          />
          {row.confidence === "low" && <span className="text-[10px] text-warning">low confidence</span>}
          {row.is_transfer && (
            <span className="ml-1.5 text-[10px] text-muted-foreground">excluded — transfer/payment</span>
          )}
        </td>
        <td className="px-2 py-2 align-top">
          <div className="flex items-center justify-end gap-1">
            <span className="font-mono text-xs text-error">−$</span>
            <input
              type="text"
              inputMode="decimal"
              value={row.amountInput}
              onChange={(e) => updateAmount(row.source_ref, e.currentTarget.value)}
              className={cn(
                "w-24 rounded-md border bg-transparent px-1.5 py-1 text-right font-mono text-xs",
                blocker && blocker !== "needs a date" ? "border-warning" : "border-border",
              )}
              aria-label={`Amount for ${row.description}`}
            />
          </div>
          {blocker && <p className="mt-1 text-right text-[11px] text-warning">{blocker}</p>}
        </td>
        <td className="px-2 py-2 align-top">
          {/* Never disabled: picking the right category is usually what a
              coach does BEFORE ticking a row the AI excluded. */}
          <select
            value={row.accountId}
            onChange={(e) => updateRow(row.source_ref, { accountId: e.currentTarget.value })}
            className="border-border rounded-md border bg-transparent px-1.5 py-1 text-xs"
            aria-label={`Category for ${row.description}`}
          >
            <option value="">Uncategorized</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {rowRequiresBusinessPurpose(row, accounts) && (
            <input
              type="text"
              value={row.businessPurpose}
              onChange={(e) => updateRow(row.source_ref, { businessPurpose: e.currentTarget.value })}
              placeholder="Business purpose (required)"
              aria-label={`Business purpose for ${row.description}`}
              className={cn(
                "mt-1 w-full rounded-md border bg-transparent px-1.5 py-1 text-xs",
                row.include && row.businessPurpose.trim().length === 0 ? "border-warning" : "border-border",
              )}
            />
          )}
        </td>
      </tr>
      )
    }

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Amazon import</DialogTitle>
            <DialogDescription>
              Every field is editable — fix a date, description, amount or category, then tick the rows that should
              post. Nothing is saved until you post below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
                <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive/80">{error}</p>
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
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground w-8">
                      <Checkbox
                        checked={allIncluded}
                        onCheckedChange={(v) => setRows((list) => list.map((r) => ({ ...r, include: v === true })))}
                        aria-label={allIncluded ? "Untick every row" : "Tick every row"}
                      />
                    </th>
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">Date</th>
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">Description</th>
                    <th className="px-2 py-2 text-right font-medium text-muted-foreground">Amount</th>
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">Category</th>
                  </tr>
                </thead>
                <tbody>{rows.map(renderRow)}</tbody>
              </table>
            </div>

          </div>

          {postBlockedReason && <p className="text-sm text-muted-foreground">{postBlockedReason}</p>}

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
            <Button onClick={commit} disabled={posting || postBlockedReason !== null}>
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
            <ShoppingCart className="size-5 text-accent" />
            Import Amazon orders
          </DialogTitle>
          <DialogDescription>
            Upload an Amazon &ldquo;Order History Reports&rdquo; CSV export and AI will categorize each order line
            for review before anything posts.
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
            <Label htmlFor="amz-file">Amazon order-history CSV *</Label>
            <input
              id="amz-file"
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary-foreground"
            />
            <p className="text-xs text-muted-foreground">CSV export from Amazon&apos;s Order History Reports. Max 10 MB.</p>
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

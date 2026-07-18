"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { rtdb } from "@/lib/firebase"
import { ref, onValue, off } from "firebase/database"
import { Camera, Loader2, CheckCircle2, XCircle, AlertTriangle, FileText, ListChecks } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import { formatCents } from "@/lib/bookkeeping/money"
import { accountRequiresBusinessPurpose, receiptSourceRef } from "@/lib/bookkeeping/receipts"
import { useAiJobsDock } from "@/hooks/use-ai-jobs-dock"
import { summarizeApiError } from "@/lib/errors/humanize"
import type { BookkeepingAccount } from "@/types/database"

/**
 * AI Bookkeeper Phase 3, Task 16 — photo receipt upload dialog. Clones
 * StatementImportDialog's upload -> RTDB-polling -> review -> post shell
 * (same job-doc listener, cancel route, progress-step mapping), but the
 * job here scans a single receipt image (2 steps: extracting, finalizing —
 * see functions/src/receipt-scan.ts) and review is a single editable card,
 * not a row grid, since there's exactly one entry to post.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const RECEIPT_STEPS = [
  { key: "extracting", label: "Reading the receipt", icon: FileText },
  { key: "finalizing", label: "Finalizing", icon: ListChecks },
] as const

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape of the completed job's `result` — mirrors ReceiptScanResult
 *  (functions/src/ai/receipt-schema.ts) field-for-field. */
interface ReceiptResult {
  vendor: string | null
  amount_cents: number | null
  occurred_on: string | null
  suggested_category: string | null
  business_purpose_hint: string | null
  currency: string | null
  confidence: "low" | "medium" | "high"
  warnings: string[]
}

interface ReviewForm {
  counterparty: string
  amount: string // dollars, as typed
  occurredOn: string
  accountId: string
  businessPurpose: string
}

type Step = "upload" | "review"

interface ReceiptUploadDialogProps {
  bookId: string
  bookName: string
  accounts: BookkeepingAccount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function mapProgressToStep(progress?: {
  status: string
  current_step: number
  total_steps: number
  detail?: string
}): { step: number; detail: string | null } {
  if (!progress) return { step: 0, detail: null }
  const idx = RECEIPT_STEPS.findIndex((s) => s.key === progress.status)
  return { step: idx >= 0 ? idx + 1 : progress.current_step, detail: progress.detail ?? null }
}

/** Firebase RTDB drops empty arrays AND `null` leaf values, so a blurry-photo
 *  result with every field null may come back missing those keys entirely
 *  (Phase-2 C1 / Phase-3 receipt-scan's coalesceReceiptResult server twin).
 *  Coalesce it back to an explicit-null shape here — the single boundary
 *  where RTDB-shaped data enters the component. */
function safeReceiptResult(v: unknown): ReceiptResult {
  const r = (v ?? {}) as Partial<ReceiptResult>
  return {
    vendor: r.vendor ?? null,
    amount_cents: typeof r.amount_cents === "number" ? r.amount_cents : null,
    occurred_on: r.occurred_on ?? null,
    suggested_category: r.suggested_category ?? null,
    business_purpose_hint: r.business_purpose_hint ?? null,
    currency: r.currency ?? null,
    confidence: r.confidence === "medium" || r.confidence === "high" ? r.confidence : "low",
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
  }
}

/** Case-insensitive match against an expense account — receipts always post
 *  as direction:"expense". Falls back to "" (Uncategorized) with no match. */
function resolveExpenseAccount(suggestedCategory: string | null, accounts: BookkeepingAccount[]): string {
  if (!suggestedCategory) return ""
  const needle = suggestedCategory.trim().toLowerCase()
  const match = accounts.find((a) => a.account_type === "expense" && a.name.trim().toLowerCase() === needle)
  return match?.id ?? ""
}

function reviewFormFromResult(result: ReceiptResult): ReviewForm {
  return {
    counterparty: result.vendor ?? "",
    amount: result.amount_cents != null ? (result.amount_cents / 100).toString() : "",
    occurredOn: result.occurred_on ?? todayIso(),
    accountId: "",
    businessPurpose: result.business_purpose_hint ?? "",
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ReceiptUploadDialog({
  bookId,
  bookName,
  accounts,
  open,
  onOpenChange,
  onSaved,
}: ReceiptUploadDialogProps) {
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

  const [result, setResult] = useState<ReceiptResult | null>(null)
  const [reviewForm, setReviewForm] = useState<ReviewForm | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [businessPurposeError, setBusinessPurposeError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)

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
    setResult(null)
    setReviewForm(null)
    setImageUrl(null)
    setImageLoading(false)
    setBusinessPurposeError(null)
    setPosting(false)
  }

  // Reset every time the dialog is (re)opened so a prior run never leaks
  // into the next one — matches StatementImportDialog's convention.
  useEffect(() => {
    if (open) resetForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Fetch the signed preview URL once the review card mounts.
  useEffect(() => {
    if (step !== "review" || !documentId) return
    let cancelled = false
    setImageLoading(true)
    fetch(`/api/admin/bookkeeping/documents/${documentId}/download`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load preview")
        return res.json()
      })
      .then((data: { url?: string }) => {
        if (!cancelled) setImageUrl(typeof data.url === "string" ? data.url : null)
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null)
      })
      .finally(() => {
        if (!cancelled) setImageLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [step, documentId])

  function handleOpenChange(newOpen: boolean) {
    // Block dismissal while a job is in flight or a commit is posting — the
    // user must use the Cancel button so the RTDB listener + job are torn
    // down cleanly instead of orphaned.
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
        toast.info("Receipt scan cancelled")
        resetForm()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || "Failed to cancel")
      }
    } catch {
      toast.error("Failed to cancel receipt scan")
    } finally {
      setIsCancelling(false)
    }
  }

  function handleJobCompleted(rawResult: unknown) {
    const r = safeReceiptResult(rawResult)
    setResult(r)
    setReviewForm({ ...reviewFormFromResult(r), accountId: resolveExpenseAccount(r.suggested_category, accounts) })
    setIsImporting(false)
    setStep("review")
  }

  async function handleSubmit() {
    if (!file) {
      toast.error("Please choose a receipt photo to upload")
      return
    }

    setIsImporting(true)
    setError(null)
    setProgressStep(0)

    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("book_id", bookId)

      const response = await fetch("/api/admin/bookkeeping/receipts/upload", {
        method: "POST",
        body: fd,
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const { message } = summarizeApiError(response, data, "Failed to upload receipt")
        throw new Error(message)
      }

      if (response.status === 202 && data.jobId) {
        setActiveJobId(data.jobId)
        setDocumentId(typeof data.documentId === "string" ? data.documentId : null)
        addJob({ jobId: data.jobId, kind: "receipt_scan", label: "Receipt scan" })

        if (data.duplicateUploadHint) {
          toast.info(
            `You may have already uploaded this receipt on ${formatOccurredOn(String(data.duplicateUploadHint).slice(0, 10))}`,
          )
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
              handleJobCompleted(jobData.result)
            } else if (jobData.status === "failed") {
              stopListening()
              setError(jobData.error || "Receipt scan failed")
              setIsImporting(false)
              toast.error("Receipt scan failed")
            } else if (jobData.status === "cancelled") {
              stopListening()
              setIsImporting(false)
              toast.info("Receipt scan cancelled")
            }
          },
          (err) => {
            console.error("[ReceiptUploadDialog] RTDB listener error:", err)
            stopListening()
            setError("Lost connection to scan updates")
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
      toast.error("Upload failed")
      stopListening()
    }
  }

  const expenseAccounts = accounts.filter((a) => a.account_type === "expense")
  const selectedAccount = reviewForm ? (expenseAccounts.find((a) => a.id === reviewForm.accountId) ?? null) : null
  const purposeRequired = selectedAccount ? accountRequiresBusinessPurpose(selectedAccount) : false
  const purposeMissing = purposeRequired && (reviewForm?.businessPurpose.trim().length ?? 0) === 0

  async function commit() {
    if (!reviewForm || !documentId) {
      toast.error("Something went wrong — please re-upload the receipt.")
      return
    }
    const cents = Math.round(parseFloat(reviewForm.amount || "0") * 100)
    if (!reviewForm.amount || !Number.isFinite(cents) || cents <= 0) {
      toast.error("Enter a valid amount")
      return
    }
    if (!reviewForm.occurredOn) {
      toast.error("Pick a date")
      return
    }
    if (purposeMissing) {
      setBusinessPurposeError("Business purpose required for this category")
      return
    }
    setPosting(true)
    setBusinessPurposeError(null)
    try {
      const res = await fetch("/api/admin/bookkeeping/receipts/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          document_id: documentId,
          account_id: reviewForm.accountId || null,
          amount_cents: cents,
          occurred_on: reviewForm.occurredOn,
          counterparty: reviewForm.counterparty.trim() || null,
          business_purpose: reviewForm.businessPurpose.trim() || null,
          memo: null,
          source_ref: receiptSourceRef(documentId),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 422) {
          setBusinessPurposeError(
            typeof data.error === "string" ? data.error : "Business purpose required for this category",
          )
          return
        }
        const { message } = summarizeApiError(res, data, "Failed to post receipt")
        toast.error(message)
        return
      }
      toast.success("Receipt posted")
      onOpenChange(false)
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setPosting(false)
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  // Processing view
  if (isImporting) {
    const progressPercent = Math.round((progressStep / RECEIPT_STEPS.length) * 100)

    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col py-6 space-y-5">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Camera className="size-4 text-primary animate-pulse" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-sm text-foreground">Scanning Receipt</h3>
                <p className="text-xs text-muted-foreground">
                  Step {progressStep} of {RECEIPT_STEPS.length}
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
              {RECEIPT_STEPS.map((s, idx) => {
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
              {isCancelling ? "Cancelling..." : "Cancel Scan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Review card
  if (step === "review" && reviewForm && result) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review receipt</DialogTitle>
            <DialogDescription>
              Check the AI-read fields against the photo. Nothing is saved until you post below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {result.warnings.length > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}
                </div>
                <ul className="text-xs text-warning/90 space-y-1 list-disc pl-5">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.confidence === "low" && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  Low-confidence read
                </div>
                <p className="text-xs text-warning/90">
                  The AI wasn&apos;t fully confident reading this receipt — double-check every field against the
                  photo before posting.
                </p>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 overflow-hidden flex items-center justify-center min-h-32">
              {imageLoading ? (
                <Loader2 className="size-5 text-muted-foreground animate-spin my-8" />
              ) : imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Receipt" className="max-h-80 w-full object-contain" />
              ) : (
                <p className="text-xs text-muted-foreground py-8">Preview unavailable</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ru-amount">Amount ($)</Label>
                <Input
                  id="ru-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={reviewForm.amount}
                  onChange={(e) => setReviewForm((f) => (f ? { ...f, amount: e.target.value } : f))}
                  placeholder="0.00"
                />
                <p className="text-xs text-muted-foreground font-mono">
                  AI scanned: {result.amount_cents != null ? formatCents(result.amount_cents) : "—"}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ru-date">Date</Label>
                <Input
                  id="ru-date"
                  type="date"
                  value={reviewForm.occurredOn}
                  onChange={(e) => setReviewForm((f) => (f ? { ...f, occurredOn: e.target.value } : f))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ru-counterparty">Counterparty</Label>
              <Input
                id="ru-counterparty"
                value={reviewForm.counterparty}
                onChange={(e) => setReviewForm((f) => (f ? { ...f, counterparty: e.target.value } : f))}
                placeholder="Who was paid"
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={reviewForm.accountId || "none"}
                onValueChange={(v) => setReviewForm((f) => (f ? { ...f, accountId: v === "none" ? "" : v } : f))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorized</SelectItem>
                  {expenseAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ru-purpose">
                Business purpose (who/what for)
                {purposeRequired && <span className="text-error ml-1">*</span>}
              </Label>
              <Textarea
                id="ru-purpose"
                value={reviewForm.businessPurpose}
                onChange={(e) => {
                  const value = e.target.value
                  setReviewForm((f) => (f ? { ...f, businessPurpose: value } : f))
                  setBusinessPurposeError(null)
                }}
                placeholder="e.g. Client dinner with Jane re: Q3 program renewal"
              />
              {businessPurposeError && <p className="text-xs text-error">{businessPurposeError}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={posting}>
              Cancel
            </Button>
            <Button onClick={commit} disabled={posting || purposeMissing}>
              {posting ? "Posting…" : "Post receipt"}
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
            <Camera className="size-5 text-accent" />
            Upload receipt photo
          </DialogTitle>
          <DialogDescription>
            Upload a photo of a paper receipt into &ldquo;{bookName}&rdquo; and AI will read the vendor, amount,
            date, and category for you to review before anything posts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
              <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Upload Failed</p>
                <p className="text-xs text-destructive/80">{error}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="receipt-file">Receipt photo *</Label>
            <input
              id="receipt-file"
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary-foreground"
            />
            <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP. Max 10 MB.</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!file}>
            <Camera className="size-4" />
            Upload &amp; Scan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

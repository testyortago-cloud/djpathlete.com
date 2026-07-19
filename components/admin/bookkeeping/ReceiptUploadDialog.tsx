"use client"

// AI Bookkeeper — multi-receipt upload dialog (spec:
// docs/superpowers/specs/2026-07-19-multi-receipt-upload-design.md).
// One path for 1..15 photos: select → sequential fan-out of receipt_scan
// jobs → consolidated batch review (ReceiptBatchReview) → per-row posting.
// Orchestration lives in useReceiptBatch; this file is phase markup only.
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Camera, CheckCircle2, ImagePlus, Loader2, XCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatCents } from "@/lib/bookkeeping/money"
import { MAX_BATCH_SIZE, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import { useReceiptBatch } from "@/hooks/use-receipt-batch"
import { ReceiptBatchReview } from "@/components/admin/bookkeeping/ReceiptBatchReview"
import type { BookkeepingAccount } from "@/types/database"

interface ReceiptUploadDialogProps {
  bookId: string
  bookName: string
  accounts: BookkeepingAccount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

const TERMINAL: ReceiptBatchRow["status"][] = ["scanned", "scan_failed", "cancelled"]

function scanChip(row: ReceiptBatchRow): { icon: "spinner" | "check" | "fail" | "idle"; label: string } {
  if (row.status === "queued") return { icon: "idle", label: "Waiting" }
  if (row.status === "uploading") return { icon: "spinner", label: "Uploading" }
  if (row.status === "scanning") return { icon: "spinner", label: "Scanning" }
  if (row.status === "scanned") return { icon: "check", label: "Scanned" }
  if (row.status === "cancelled") return { icon: "fail", label: "Cancelled" }
  return { icon: "fail", label: row.error ?? "Failed" }
}

export function ReceiptUploadDialog({
  bookId,
  bookName,
  accounts,
  open,
  onOpenChange,
  onSaved,
}: ReceiptUploadDialogProps) {
  const batch = useReceiptBatch({
    bookId,
    accounts,
    onAllPosted: (count, totalCents) => {
      toast.success(
        count === 1
          ? `Receipt posted — ${formatCents(totalCents)}`
          : `${count} receipts posted — ${formatCents(totalCents)}`,
      )
      onOpenChange(false)
      onSaved()
    },
  })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const batchRef = useRef(batch)
  batchRef.current = batch

  // Reset every time the dialog is (re)opened so a prior run never leaks in.
  useEffect(() => {
    if (open) {
      batchRef.current.reset()
      setExpandedId(null)
    }
  }, [open])

  // A one-receipt batch lands on review with its single row auto-expanded —
  // this is how the old single-receipt card UX survives on the batch path.
  useEffect(() => {
    if (batch.phase === "review" && batch.rows.length === 1) {
      setExpandedId(batch.rows[0].clientId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.phase])

  function handleOpenChange(newOpen: boolean) {
    // Block dismissal while uploads/scans/posting are in flight — Cancel
    // buttons tear listeners + jobs down cleanly instead of orphaning them.
    if (!newOpen && batch.busy) return
    if (!newOpen && batch.postedCount > 0) onSaved()
    onOpenChange(newOpen)
  }

  function handleFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) return
    const { dropped } = batch.addFiles(list)
    if (dropped.length > 0) {
      toast.info(`Only ${MAX_BATCH_SIZE} receipts per batch — not added: ${dropped.join(", ")}`)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleCancelRemaining() {
    await batch.cancelRemaining()
    toast.info("Cancelling remaining scans…")
  }

  const scannedCount = batch.rows.filter((r) => TERMINAL.includes(r.status)).length

  // ─── Scanning phase ───────────────────────────────────────────────────────
  if (batch.phase === "scanning") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col py-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Camera className="size-4 text-primary animate-pulse" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-sm text-foreground">Scanning receipts</h3>
                <p className="text-xs text-muted-foreground">
                  Scanned {scannedCount} of {batch.rows.length}
                </p>
              </div>
            </div>

            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${batch.rows.length ? Math.round((scannedCount / batch.rows.length) * 100) : 0}%` }}
              />
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {batch.rows.map((row) => {
                const chip = scanChip(row)
                return (
                  <div
                    key={row.clientId}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
                      chip.icon === "spinner" && "bg-primary/5",
                    )}
                  >
                    {chip.icon === "check" ? (
                      <CheckCircle2 className="size-4 text-primary shrink-0" />
                    ) : chip.icon === "spinner" ? (
                      <Loader2 className="size-4 text-primary animate-spin shrink-0" />
                    ) : chip.icon === "fail" ? (
                      <XCircle className="size-4 text-error shrink-0" />
                    ) : (
                      <div className="size-4 rounded-full border border-muted-foreground/30 shrink-0" />
                    )}
                    <span className="text-sm text-foreground truncate flex-1">{row.fileName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{chip.label}</span>
                  </div>
                )
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelRemaining}
              disabled={batch.cancelling}
              className="w-full text-muted-foreground hover:text-destructive hover:border-destructive/30"
            >
              {batch.cancelling ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <XCircle className="size-3.5 mr-1.5" />
              )}
              {batch.cancelling ? "Cancelling…" : "Cancel remaining"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // ─── Review phase ─────────────────────────────────────────────────────────
  if (batch.phase === "review") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Review {batch.rows.length === 1 ? "receipt" : `${batch.rows.length} receipts`}
            </DialogTitle>
            <DialogDescription>
              Check the AI-read fields against each photo. Nothing is saved until you post below.
            </DialogDescription>
          </DialogHeader>
          <ReceiptBatchReview
            rows={batch.rows}
            accounts={accounts}
            expandedId={expandedId}
            posting={batch.posting}
            onExpand={setExpandedId}
            onToggleInclude={(clientId, included) => batch.updateRow(clientId, { included })}
            onEditRow={(clientId, patch) => batch.updateRow(clientId, patch)}
            onPost={() => void batch.postIncluded()}
            onCancel={() => handleOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    )
  }

  // ─── Select phase ─────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-heading font-semibold text-foreground">
            <Camera className="size-5 text-accent" />
            Upload receipt photos
          </DialogTitle>
          <DialogDescription>
            Upload photos of paper receipts into &ldquo;{bookName}&rdquo; and AI will read the vendor, amount,
            date, and category of each — you review everything in one summary before anything posts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {batch.scanError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
              <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Upload Failed</p>
                <p className="text-xs text-destructive/80">{batch.scanError}</p>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleFilesPicked(e.target.files)}
          />

          {batch.files.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary/40 bg-muted/20 p-8 flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ImagePlus className="size-6" />
              <span className="text-sm font-medium">Choose photos</span>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {batch.files.map((file, index) => (
                  <div key={`${file.name}-${file.size}`} className="relative rounded-lg border border-border overflow-hidden bg-muted/20">
                    <div className="aspect-square flex items-center justify-center">
                      <Camera className="size-5 text-muted-foreground/40" />
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate px-1.5 pb-1">{file.name}</p>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => batch.removeFile(index)}
                      className="absolute top-1 right-1 size-5 rounded-full bg-background/90 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive"
                    >
                      <XCircle className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={batch.files.length >= MAX_BATCH_SIZE}
              >
                <ImagePlus className="size-3.5 mr-1.5" />
                Add more
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            JPG, PNG, or WEBP. Max 10 MB each, up to {MAX_BATCH_SIZE} photos.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void batch.startScan()} disabled={batch.files.length === 0}>
            <Camera className="size-4" />
            {batch.files.length > 1 ? `Upload & Scan ${batch.files.length} receipts` : "Upload & Scan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

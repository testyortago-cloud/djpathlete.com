"use client"

// Orchestration state machine for the multi-receipt batch flow. All server
// contracts here are the EXISTING single-receipt routes — this hook only
// fans them out and aggregates state. Pure decisions (dupes, sorting,
// validation, totals) live in lib/bookkeeping/receipt-batch.ts.
import { useCallback, useEffect, useRef, useState } from "react"
import { ref, onValue, off } from "firebase/database"
import { rtdb } from "@/lib/firebase"
import { useAiJobsDock } from "@/hooks/use-ai-jobs-dock"
import { summarizeApiError } from "@/lib/errors/humanize"
import { receiptSourceRef } from "@/lib/bookkeeping/receipts"
import {
  MAX_BATCH_SIZE,
  applyScanResult,
  detectWithinBatchDuplicates,
  newReceiptRow,
  parseAmountCents,
  rowValidationError,
  sortReceiptRows,
  type ReceiptBatchRow,
} from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

export type BatchPhase = "select" | "scanning" | "review"

export interface UseReceiptBatchArgs {
  bookId: string
  accounts: BookkeepingAccount[]
  /** Fired once when every included row has posted (cumulative count + cents). */
  onAllPosted: (postedCount: number, totalCents: number) => void
}

const TERMINAL_SCAN: ReceiptBatchRow["status"][] = ["scanned", "scan_failed", "cancelled"]

function makeThumbUrl(file: File): string | null {
  try {
    return typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : null
  } catch {
    return null
  }
}

export function useReceiptBatch({ bookId, accounts, onAllPosted }: UseReceiptBatchArgs) {
  const { addJob } = useAiJobsDock()

  const [phase, setPhase] = useState<BatchPhase>("select")
  const [files, setFiles] = useState<File[]>([])
  const [rows, setRows] = useState<ReceiptBatchRow[]>([])
  const [uploading, setUploading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [postedCount, setPostedCount] = useState(0)

  // Refs so RTDB callbacks and the post loop never read stale closures.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const accountsRef = useRef(accounts)
  accountsRef.current = accounts
  const listenersRef = useRef(new Map<string, ReturnType<typeof ref>>())
  const cancelRequestedRef = useRef(false)

  function patchRow(clientId: string, patch: Partial<ReceiptBatchRow>) {
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)))
  }

  function stopJob(jobId: string) {
    const jobRef = listenersRef.current.get(jobId)
    if (jobRef) {
      off(jobRef)
      listenersRef.current.delete(jobId)
    }
  }

  function stopAllListeners() {
    for (const jobRef of listenersRef.current.values()) off(jobRef)
    listenersRef.current.clear()
  }

  useEffect(() => () => stopAllListeners(), [])

  const addFiles = useCallback(
    (incoming: FileList | File[]): { dropped: string[] } => {
      const dropped: string[] = []
      const next = [...files]
      for (const f of Array.from(incoming)) {
        if (next.some((e) => e.name === f.name && e.size === f.size)) continue
        if (next.length >= MAX_BATCH_SIZE) {
          dropped.push(f.name)
          continue
        }
        next.push(f)
      }
      setFiles(next)
      return { dropped }
    },
    [files],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  function listenToJob(clientId: string, jobId: string) {
    const jobRef = ref(rtdb, `ai_jobs/${jobId}`)
    listenersRef.current.set(jobId, jobRef)
    onValue(
      jobRef,
      (snapshot) => {
        const jobData = snapshot.val() as
          | { status?: string; result?: unknown; error?: string }
          | null
        if (!jobData) return
        if (jobData.status === "completed") {
          stopJob(jobId)
          setRows((prev) =>
            prev.map((r) =>
              r.clientId === clientId ? applyScanResult(r, jobData.result, accountsRef.current) : r,
            ),
          )
        } else if (jobData.status === "failed") {
          stopJob(jobId)
          patchRow(clientId, {
            status: "scan_failed",
            error: typeof jobData.error === "string" && jobData.error ? jobData.error : "Scan failed",
          })
        } else if (jobData.status === "cancelled") {
          stopJob(jobId)
          patchRow(clientId, { status: "cancelled", error: "Scan cancelled" })
        }
      },
      () => {
        stopJob(jobId)
        patchRow(clientId, { status: "scan_failed", error: "Lost connection to scan updates" })
      },
    )
  }

  const startScan = useCallback(
    async () => {
      if (files.length === 0) return
      cancelRequestedRef.current = false
      const initial = files.map((f) => newReceiptRow(crypto.randomUUID(), f.name, makeThumbUrl(f)))
      setRows(initial)
      setPhase("scanning")
      setUploading(true)
      // Sequential on purpose: file k's document exists before file k+1 is
      // hashed, so the route's sha256 hint also catches within-batch dupes.
      for (let i = 0; i < files.length; i++) {
        const { clientId } = initial[i]
        if (cancelRequestedRef.current) {
          patchRow(clientId, { status: "cancelled", error: "Scan cancelled" })
          continue
        }
        patchRow(clientId, { status: "uploading" })
        try {
          const fd = new FormData()
          fd.append("file", files[i])
          fd.append("book_id", bookId)
          const res = await fetch("/api/admin/bookkeeping/receipts/upload", { method: "POST", body: fd })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data.jobId) {
            const { message } = summarizeApiError(res, data, "Upload failed")
            patchRow(clientId, { status: "scan_failed", error: message })
            continue
          }
          const jobId = String(data.jobId)
          patchRow(clientId, {
            status: "scanning",
            jobId,
            documentId: typeof data.documentId === "string" ? data.documentId : null,
            duplicateUploadHint: data.duplicateUploadHint ? String(data.duplicateUploadHint) : null,
          })
          addJob({
            jobId,
            kind: "receipt_scan",
            label: files.length === 1 ? "Receipt scan" : `Receipt scan (${i + 1}/${files.length})`,
          })
          listenToJob(clientId, jobId)
        } catch {
          patchRow(clientId, { status: "scan_failed", error: "Upload failed — network error" })
        }
      }
      setUploading(false)
    },
    // listenToJob/patchRow are stable module-pattern fns using refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, bookId, addJob],
  )

  // When the upload loop is done and every row reached a terminal scan state,
  // enter review — or fall back to select when there is nothing reviewable
  // (nothing scanned AND nothing stored to post manually).
  useEffect(() => {
    if (phase !== "scanning" || uploading || rows.length === 0) return
    if (!rows.every((r) => TERMINAL_SCAN.includes(r.status))) return
    const reviewable =
      rows.some((r) => r.status === "scanned") ||
      rows.some((r) => r.status !== "scanned" && r.documentId != null)
    if (reviewable) {
      setRows((prev) => {
        const sorted = sortReceiptRows(prev)
        const dups = detectWithinBatchDuplicates(sorted)
        return sorted.map((r, i) => ({
          ...r,
          withinBatchDupOf: dups[i],
          included: r.status === "scanned" && dups[i] == null && r.duplicateUploadHint == null,
        }))
      })
      setPhase("review")
    } else {
      setPhase("select")
    }
  }, [phase, uploading, rows])

  const cancelRemaining = useCallback(async () => {
    if (cancelling) return
    setCancelling(true)
    cancelRequestedRef.current = true
    const inFlight = rowsRef.current.filter((r) => r.status === "scanning" && r.jobId)
    for (const row of inFlight) {
      try {
        await fetch("/api/admin/programs/generate/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: row.jobId }),
        })
      } catch {
        // Job keeps running server-side; its listener will still resolve the row.
      }
    }
    setCancelling(false)
  }, [cancelling])

  const updateRow = useCallback((clientId: string, patch: Partial<ReceiptBatchRow>) => {
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)))
  }, [])

  const postIncluded = useCallback(
    async () => {
      if (posting) return
      setPosting(true)
      const alreadyPosted = rowsRef.current.filter((r) => r.status === "posted")
      const target = rowsRef.current.filter((r) => r.included && r.status !== "posted")
      let newlyPosted = 0
      let newlyPostedCents = 0
      let failures = 0
      for (const row of target) {
        if (!row.documentId) {
          patchRow(row.clientId, { status: "post_failed", error: "Upload failed — nothing stored to post" })
          failures++
          continue
        }
        const invalid = rowValidationError(row, accountsRef.current)
        if (invalid) {
          patchRow(row.clientId, { status: "post_failed", error: invalid })
          failures++
          continue
        }
        const cents = parseAmountCents(row.amount) as number
        patchRow(row.clientId, { status: "posting", error: null })
        try {
          const res = await fetch("/api/admin/bookkeeping/receipts/commit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              book_id: bookId,
              document_id: row.documentId,
              account_id: row.accountId || null,
              amount_cents: cents,
              occurred_on: row.occurredOn,
              counterparty: row.counterparty.trim() || null,
              business_purpose: row.businessPurpose.trim() || null,
              memo: null,
              source_ref: receiptSourceRef(row.documentId),
            }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            const { message } = summarizeApiError(res, data, "Failed to post receipt")
            patchRow(row.clientId, {
              status: "post_failed",
              error: res.status === 422 && typeof data.error === "string" ? data.error : message,
            })
            failures++
            continue
          }
          newlyPosted++
          newlyPostedCents += cents
          patchRow(row.clientId, { status: "posted", error: null })
        } catch {
          patchRow(row.clientId, { status: "post_failed", error: "Network error — retry" })
          failures++
        }
      }
      setPosting(false)
      setPostedCount(alreadyPosted.length + newlyPosted)
      if (failures === 0 && newlyPosted > 0) {
        const priorCents = alreadyPosted.reduce((sum, r) => sum + (parseAmountCents(r.amount) ?? 0), 0)
        onAllPosted(alreadyPosted.length + newlyPosted, priorCents + newlyPostedCents)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posting, bookId, onAllPosted],
  )

  const reset = useCallback(() => {
    stopAllListeners()
    cancelRequestedRef.current = false
    for (const row of rowsRef.current) {
      if (row.thumbUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        try {
          URL.revokeObjectURL(row.thumbUrl)
        } catch {
          // noop — object URL may already be gone
        }
      }
    }
    setFiles([])
    setRows([])
    setPhase("select")
    setUploading(false)
    setPosting(false)
    setCancelling(false)
    setPostedCount(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy =
    uploading ||
    posting ||
    cancelling ||
    (phase === "scanning" && rows.some((r) => !TERMINAL_SCAN.includes(r.status)))

  return {
    phase,
    files,
    rows,
    uploading,
    posting,
    cancelling,
    postedCount,
    busy,
    addFiles,
    removeFile,
    startScan,
    cancelRemaining,
    updateRow,
    postIncluded,
    reset,
  }
}

"use client"

// Orchestration state machine for the multi-receipt batch flow. All server
// contracts here are the EXISTING single-receipt routes — this hook only
// fans them out and aggregates state. Pure decisions (dupes, sorting,
// validation, totals) live in lib/bookkeeping/receipt-batch.ts.
import { useCallback, useEffect, useRef, useState } from "react"
import { subscribeToJob } from "@/lib/firebase/job-subscription"
import { useAiJobsDock } from "@/hooks/use-ai-jobs-dock"
import { summarizeApiError } from "@/lib/errors/humanize"
import { receiptSourceRef } from "@/lib/bookkeeping/receipts"
import {
  MAX_BATCH_SIZE,
  applyScanResult,
  detectWithinBatchDuplicates,
  isAcceptedReceiptFile,
  isPdfFile,
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
  const [scanError, setScanError] = useState<string | null>(null)

  // Refs so RTDB callbacks and the post loop never read stale closures.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const accountsRef = useRef(accounts)
  accountsRef.current = accounts
  const listenersRef = useRef(new Map<string, () => void>())
  const cancelRequestedRef = useRef(false)
  const scanInFlightRef = useRef(false)
  // The upload POST currently on the wire. Cancel aborts it — without this a
  // row sits in "uploading" until the server answers, and the dialog refuses
  // to close for as long as any row is non-terminal.
  const uploadAbortRef = useRef<AbortController | null>(null)

  function patchRow(clientId: string, patch: Partial<ReceiptBatchRow>) {
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)))
  }

  function stopJob(jobId: string) {
    const unsubscribe = listenersRef.current.get(jobId)
    if (unsubscribe) {
      unsubscribe()
      listenersRef.current.delete(jobId)
    }
  }

  function stopAllListeners() {
    for (const unsubscribe of listenersRef.current.values()) unsubscribe()
    listenersRef.current.clear()
  }

  useEffect(() => () => stopAllListeners(), [])

  const addFiles = useCallback(
    (incoming: FileList | File[]): { dropped: string[]; rejected: string[] } => {
      const dropped: string[] = []
      const rejected: string[] = []
      const next = [...files]
      for (const f of Array.from(incoming)) {
        // Type-checked here, not by the input's `accept` attribute: dropped
        // files never pass through it.
        if (!isAcceptedReceiptFile(f)) {
          rejected.push(f.name)
          continue
        }
        if (next.some((e) => e.name === f.name && e.size === f.size)) continue
        if (next.length >= MAX_BATCH_SIZE) {
          dropped.push(f.name)
          continue
        }
        next.push(f)
      }
      setFiles(next)
      // Two distinct reasons a file did not make it in — the caller reports
      // them separately so "wrong type" never reads as "batch full".
      return { dropped, rejected }
    },
    [files],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  function listenToJob(clientId: string, jobId: string) {
    const unsubscribe = subscribeToJob(
      jobId,
      (jobData) => {
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
    // Safe to register after subscribing: Firestore delivers snapshots
    // asynchronously, so no callback can run before this line.
    listenersRef.current.set(jobId, unsubscribe)
  }

  const startScan = useCallback(
    async () => {
      if (files.length === 0 || scanInFlightRef.current) return
      scanInFlightRef.current = true
      cancelRequestedRef.current = false
      setScanError(null)
      // A retry re-mints thumbnails — revoke the prior batch's object URLs first.
      for (const row of rowsRef.current) {
        if (row.thumbUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          try {
            URL.revokeObjectURL(row.thumbUrl)
          } catch {
            // noop — object URL may already be gone
          }
        }
      }
      const initial = files.map((f) =>
        newReceiptRow(crypto.randomUUID(), f.name, makeThumbUrl(f), isPdfFile(f)),
      )
      setRows(initial)
      setPhase("scanning")
      setUploading(true)
      try {
        // Sequential on purpose: file k's document exists before file k+1 is
        // hashed, so the route's sha256 hint also catches within-batch dupes.
        for (let i = 0; i < files.length; i++) {
          const { clientId } = initial[i]
          if (cancelRequestedRef.current) {
            patchRow(clientId, { status: "cancelled", error: "Scan cancelled" })
            continue
          }
          patchRow(clientId, { status: "uploading" })
          const controller = new AbortController()
          uploadAbortRef.current = controller
          try {
            const fd = new FormData()
            fd.append("file", files[i])
            fd.append("book_id", bookId)
            const res = await fetch("/api/admin/bookkeeping/receipts/upload", {
              method: "POST",
              body: fd,
              signal: controller.signal,
            })
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
            // An aborted upload is the user's own Cancel, not a failure.
            patchRow(
              clientId,
              cancelRequestedRef.current
                ? { status: "cancelled", error: "Scan cancelled" }
                : { status: "scan_failed", error: "Upload failed — network error" },
            )
          } finally {
            if (uploadAbortRef.current === controller) uploadAbortRef.current = null
          }
        }
      } finally {
        setUploading(false)
        scanInFlightRef.current = false
      }
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
      setScanError(rows.find((r) => r.error)?.error ?? "Upload failed")
      setPhase("select")
    }
  }, [phase, uploading, rows])

  const cancelRemaining = useCallback(async () => {
    if (cancelling) return
    setCancelling(true)
    cancelRequestedRef.current = true
    // Stop the upload still on the wire first — a row in "uploading" has no
    // jobId yet, so the server-side cancel below cannot reach it.
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null

    const inFlight = rowsRef.current.filter((r) => r.status === "scanning" && r.jobId)
    for (const row of inFlight) {
      try {
        await fetch("/api/admin/programs/generate/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: row.jobId }),
        })
        // Deliberately not branching on res.ok: 404 (job gone) and 409 (job
        // already terminal) both mean "nothing left to stop", and a 500 still
        // leaves the user entitled to stop waiting. The row is cancelled
        // locally below either way.
      } catch {
        // Network error — same reasoning.
      }
    }

    // Cancel MUST land every row in a terminal state. `busy` stays true while
    // any row is non-terminal and the dialog refuses to close while busy, so
    // relying on the RTDB listener to deliver "cancelled" traps the user
    // whenever the server never sends it (job already failed, cancel refused,
    // listener torn down). Settle locally instead.
    stopAllListeners()
    setRows((prev) =>
      prev.map((r) =>
        TERMINAL_SCAN.includes(r.status) ? r : { ...r, status: "cancelled", error: "Scan cancelled" },
      ),
    )
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
    scanInFlightRef.current = false
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
    setScanError(null)
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
    scanError,
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

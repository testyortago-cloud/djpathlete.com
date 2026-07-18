import { getFirestore, FieldValue, type DocumentReference } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { getStorage } from "firebase-admin/storage"
import sharp from "sharp"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { receiptScanSchema, type ReceiptScanResult } from "./ai/receipt-schema.js"
import { RECEIPT_SCAN_PROMPT } from "./ai/receipt-prompt.js"
import { createJobProgressUpdater, createCancellationChecker } from "./ai/shared-helpers.js"
import { getSupabase } from "./lib/supabase.js"

/**
 * AI Bookkeeper Phase 3, Task 8 — receipt_scan Firebase job handler.
 *
 * Mirrors statement-import.ts's orchestration shape (load job, guard
 * status==="pending", re-check cancelled, mark processing in Firestore+RTDB,
 * createJobProgressUpdater/createCancellationChecker, callAgent, write-back,
 * complete/fail the ai_generation_log) but reads a single photographed
 * receipt image from the private bucket instead of statement text/rows:
 *
 * download the uploaded image -> auto-orient + downscale + re-encode via
 * sharp (resizeReceiptForVision, kept under Anthropic's vision size/5MB
 * limits) -> callAgent with the image attached -> coalesce every field to
 * an explicit null (RTDB drops null leaves, Phase-2 C1) before writing the
 * result to Firestore + RTDB.
 */

// ─── Input shape ─────────────────────────────────────────────────────────
// functions/ cannot import lib/ or types/ (separate rootDir) — this mirrors
// the shape written by the (Next.js-side) receipt upload route (Task 11).

export interface ReceiptScanAccount {
  name: string
  account_type: "income" | "expense"
}

export interface ReceiptScanJobInput {
  storagePath: string
  mimeType: string
  accounts: ReceiptScanAccount[]
  bookName: string
  bookKind: "business" | "household"
  documentId: string
  logId?: string
  requestedBy: string
}

// ─── Pure helpers (exported for isolated testing) ───────────────────────────

/** Auto-orient (EXIF), downscale to <=1568px longest edge, re-encode JPEG.
 *  Guarantees the vision payload is under Anthropic's size/5MB limits. */
export async function resizeReceiptForVision(buffer: Buffer): Promise<{ data: string; media_type: "image/jpeg" }> {
  const out = await sharp(buffer)
    .rotate()
    .resize(1568, 1568, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
  return { data: out.toString("base64"), media_type: "image/jpeg" }
}

/** Coalesce every field (RTDB drops null leaves) so downstream always sees a full object. */
export function coalesceReceiptResult(r: Partial<ReceiptScanResult> | null | undefined): ReceiptScanResult {
  return {
    vendor: r?.vendor ?? null,
    amount_cents: r?.amount_cents ?? null,
    occurred_on: r?.occurred_on ?? null,
    suggested_category: r?.suggested_category ?? null,
    business_purpose_hint: r?.business_purpose_hint ?? null,
    currency: r?.currency ?? null,
    confidence: r?.confidence ?? "low",
    warnings: Array.isArray(r?.warnings) ? r!.warnings : [],
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Write real-time status to RTDB so the client can listen for instant updates */
async function updateRtdb(jobId: string, data: Record<string, unknown>) {
  try {
    await getDatabase().ref(`ai_jobs/${jobId}`).update({ ...data, updatedAt: Date.now() })
  } catch (e) {
    console.warn(`[receipt-scan] RTDB update failed:`, e)
  }
}

/** Best-effort: mark the Supabase generation log as cancelled so it doesn't stay stuck "pending" */
async function markLogCancelled(logId: string | undefined) {
  if (!logId) return
  try {
    await getSupabase().from("ai_generation_log").update({ status: "cancelled" }).eq("id", logId)
  } catch (e) {
    console.warn(`[receipt-scan] mark log cancelled failed:`, e)
  }
}

function renderAccounts(accounts: ReceiptScanAccount[]): string {
  const expense = accounts.filter((a) => a.account_type === "expense").map((a) => a.name)
  return `## Expense categories\n${expense.length ? expense.join(", ") : "(none)"}`
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export async function handleReceiptScan(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef: DocumentReference = db.collection("ai_jobs").doc(jobId)

  const snap = await jobRef.get()
  if (!snap.exists) {
    console.error(`[receipt-scan] Job ${jobId} not found`)
    return
  }

  const job = snap.data()!
  if (job.status !== "pending") {
    console.log(`[receipt-scan] Job ${jobId} already ${job.status}, skipping`)
    return
  }

  // Double-check not cancelled between creation and pickup
  const fresh = await jobRef.get()
  if (fresh.data()?.status === "cancelled") {
    console.log(`[receipt-scan] Job ${jobId} was cancelled before processing`)
    return
  }

  // Mark as processing in both Firestore and RTDB
  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })
  await updateRtdb(jobId, { status: "processing" })

  const input = job.input as ReceiptScanJobInput

  try {
    const checkCancelled = createCancellationChecker(jobId)
    const updateProgress = createJobProgressUpdater(jobId, 2)

    await updateProgress("extracting", 1)
    if (await checkCancelled()) {
      await markLogCancelled(input.logId)
      await updateRtdb(jobId, { status: "cancelled" })
      return
    }

    const bucketName = process.env.FIREBASE_PRIVATE_BUCKET
    if (!bucketName) throw new Error("FIREBASE_PRIVATE_BUCKET not set")
    const [buffer] = await getStorage().bucket(bucketName).file(input.storagePath).download()
    const image = await resizeReceiptForVision(buffer)

    const userMessage = `${renderAccounts(input.accounts ?? [])}\n\nRead the attached receipt image and extract the fields.`
    const res = await callAgent<ReceiptScanResult>(
      RECEIPT_SCAN_PROMPT.replace("<name>", input.bookName),
      userMessage,
      receiptScanSchema,
      { model: MODEL_SONNET, images: [image] },
    )
    const result = coalesceReceiptResult(res.content)

    await updateProgress("finalizing", 2)

    // Back-fill the document + complete the log
    const supabase = getSupabase()
    const { error: docError } = await supabase
      .from("bookkeeping_documents")
      .update({ period_start: result.occurred_on, period_end: result.occurred_on, row_count: 1 })
      .eq("id", input.documentId)
    if (docError) {
      console.warn(`[receipt-scan] Failed to back-fill document ${input.documentId}:`, docError.message)
    }

    if (input.logId) {
      await supabase
        .from("ai_generation_log")
        .update({
          status: "completed",
          output_summary: {
            vendor: result.vendor,
            amount_cents: result.amount_cents,
            occurred_on: result.occurred_on,
            confidence: result.confidence,
            warnings: result.warnings,
            document_id: input.documentId,
          },
          tokens_used: res.tokens_used,
          completed_at: new Date().toISOString(),
        })
        .eq("id", input.logId)
    }

    await jobRef.update({ status: "completed", result, updatedAt: FieldValue.serverTimestamp() })
    await updateRtdb(jobId, { status: "completed", result })
    console.log(`[receipt-scan] Job ${jobId} completed — document ${input.documentId}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error(`[receipt-scan] Job ${jobId} failed:`, msg)

    await jobRef.update({ status: "failed", error: msg, updatedAt: FieldValue.serverTimestamp() })
    await updateRtdb(jobId, { status: "failed", error: msg })

    if (input.logId) {
      try {
        await getSupabase().from("ai_generation_log").update({ status: "failed", error_message: msg }).eq("id", input.logId)
      } catch (e) {
        console.warn(`[receipt-scan] mark log failed failed:`, e)
      }
    }
  }
}

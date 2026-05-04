// lib/ads/conversions.ts
// Phase 1.5c (offline conversion uploads) + Phase 1.5d (Stripe value
// adjustments). Three responsibilities:
//
//  1. enqueueBookingConversion — called from the GHL booking webhook.
//     Reads the active 'booking_created' conversion action for the customer,
//     idempotently inserts a 'click' upload row in 'pending' state.
//
//  2. enqueuePaymentValueAdjustment — called from the Stripe webhook on
//     successful payment. Looks up the originating booking's conversion
//     upload (if any) and enqueues a 'RESTATE' adjustment with the actual
//     paid value, so smart bidding learns true LTV instead of the placeholder.
//
//  3. processPendingConversionUploads — the worker. Drains pending rows in
//     batches, calls Google Ads, records api_request/api_response/status.
//     Gracefully no-ops when GOOGLE_ADS_DEVELOPER_TOKEN is unset — rows stay
//     pending until the live cutover.

import { ResourceNames } from "google-ads-api"
import { getCustomerClient } from "@/lib/ads/google-ads-client"
import {
  getActiveConversionAction,
  listConversionActions,
} from "@/lib/db/google-ads-conversion-actions"
import {
  findConversionUploadBySource,
  incrementUploadAttempts,
  insertConversionUpload,
  listPendingConversionUploads,
  setConversionUploadResult,
} from "@/lib/db/google-ads-conversion-uploads"
import { getActiveGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import type {
  GoogleAdsConversionUpload,
  GoogleAdsConversionTrigger,
} from "@/types/database"

const MAX_ATTEMPTS = 5
const WORKER_BATCH_SIZE = 50

interface BookingConversionInput {
  booking_id: string
  booking_date: string
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  /**
   * Optional value override (in micros). Defaults to the conversion action's
   * configured default_value_micros (e.g. $50 placeholder for a discovery
   * call lead). Plan 1.5d will adjust this to actual revenue post-payment.
   */
  value_micros?: number
}

/**
 * Enqueues a click-conversion upload for a freshly-created booking. No-ops
 * silently when there's no active 'booking_created' conversion action OR no
 * gclid/gbraid/wbraid (we can't attribute without a click identifier).
 *
 * Always idempotent — re-running with the same booking_id is safe.
 */
export async function enqueueBookingConversion(
  input: BookingConversionInput,
): Promise<GoogleAdsConversionUpload | null> {
  const click_id = input.gclid ?? input.gbraid ?? input.wbraid
  if (!click_id) return null

  // Phase 1.5: single-account. Pick the first active account; multi-account
  // routing lands when D1 (multi-customer) ships.
  const accounts = await getActiveGoogleAdsAccounts()
  const account = accounts[0]
  if (!account) return null

  const action = await getActiveConversionAction(account.customer_id, "booking_created")
  if (!action) return null

  return insertConversionUpload({
    customer_id: account.customer_id,
    conversion_action_id: action.conversion_action_id,
    upload_type: "click",
    source_table: "bookings",
    source_id: input.booking_id,
    gclid: input.gclid ?? null,
    gbraid: input.gbraid ?? null,
    wbraid: input.wbraid ?? null,
    conversion_time: input.booking_date,
    value_micros: input.value_micros ?? action.default_value_micros,
    currency: action.default_currency,
  })
}

interface PaymentValueAdjustmentInput {
  /** The booking row whose click conversion we want to restate. */
  booking_id: string
  /** Value paid in micros (Stripe cents → multiply by 10_000 for micros). */
  paid_value_micros: number
  /** ISO timestamp of the Stripe charge. */
  paid_at: string
  currency?: string
}

interface PaymentAdjustmentByEmailInput {
  /** Stripe customer email. Must match a booking's contact_email. */
  email: string
  /** Paid value in micros (Stripe cents × 10_000). */
  paid_value_micros: number
  /** ISO timestamp of the charge. */
  paid_at: string
  currency?: string
}

/**
 * Stripe-side entry point. Walks email → most-recent uploaded click
 * conversion → adjustment. No-ops when no booking with that email has had
 * a click conversion successfully uploaded yet (the Stripe payment came
 * before Google Ads accepted the click conversion — adjustments would be
 * rejected on a non-existent conversion). The pending adjustment can be
 * re-enqueued by another caller once the click upload completes.
 */
export async function enqueuePaymentValueAdjustmentByEmail(
  input: PaymentAdjustmentByEmailInput,
): Promise<GoogleAdsConversionUpload | null> {
  const { createServiceRoleClient } = await import("@/lib/supabase")
  const supabase = createServiceRoleClient()
  // Most-recent booking for this email
  const { data: booking } = await supabase
    .from("bookings")
    .select("id")
    .eq("contact_email", input.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!booking?.id) return null
  return enqueuePaymentValueAdjustment({
    booking_id: (booking as { id: string }).id,
    paid_value_micros: input.paid_value_micros,
    paid_at: input.paid_at,
    currency: input.currency,
  })
}

/**
 * When a booking turns into a paid Stripe charge, restate the conversion
 * value to the actual paid amount. Looks up the original 'click' upload for
 * the booking — if it doesn't exist (booking pre-dated this feature, or no
 * gclid was captured), we skip silently.
 */
export async function enqueuePaymentValueAdjustment(
  input: PaymentValueAdjustmentInput,
): Promise<GoogleAdsConversionUpload | null> {
  const original = await findConversionUploadBySource({
    source_table: "bookings",
    source_id: input.booking_id,
    upload_type: "click",
  })
  if (!original) return null
  // Don't enqueue an adjustment if the click conversion itself never
  // uploaded — Google rejects adjustments to unknown conversions. Once the
  // click uploads, the next worker pass can re-enqueue this adjustment.
  if (original.status !== "uploaded") {
    return null
  }

  return insertConversionUpload({
    customer_id: original.customer_id,
    conversion_action_id: original.conversion_action_id,
    upload_type: "adjustment",
    source_table: "bookings",
    source_id: input.booking_id,
    gclid: original.gclid,
    gbraid: original.gbraid,
    wbraid: original.wbraid,
    conversion_time: input.paid_at, // Used as adjustment_date_time
    value_micros: input.paid_value_micros,
    currency: input.currency ?? original.currency,
    adjustment_type: "RESTATE",
    related_upload_id: original.id,
  })
}

interface UploadResult {
  status: "uploaded" | "failed" | "skipped"
  error?: string
  api_request?: Record<string, unknown>
  api_response?: Record<string, unknown>
}

function gAdsDateTime(iso: string): string {
  // Google Ads expects "YYYY-MM-DD HH:MM:SS+00:00" (no fractional seconds, with offset).
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
  )
}

async function uploadOne(row: GoogleAdsConversionUpload): Promise<UploadResult> {
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    return { status: "skipped", error: "GOOGLE_ADS_DEVELOPER_TOKEN not set" }
  }

  const customer = await getCustomerClient(row.customer_id)
  const conversionActionResource = ResourceNames.conversionAction(
    row.customer_id,
    row.conversion_action_id,
  )
  const conversionDateTime = gAdsDateTime(row.conversion_time)
  const valueDollars = row.value_micros / 1_000_000

  if (row.upload_type === "click") {
    const conversion: Record<string, unknown> = {
      conversion_action: conversionActionResource,
      conversion_date_time: conversionDateTime,
      conversion_value: valueDollars,
      currency_code: row.currency,
    }
    if (row.gclid) conversion.gclid = row.gclid
    else if (row.gbraid) conversion.gbraid = row.gbraid
    else if (row.wbraid) conversion.wbraid = row.wbraid

    const request = {
      customer_id: row.customer_id,
      conversions: [conversion],
      partial_failure: true,
    }
    try {
      const response = await customer.conversionUploads.uploadClickConversions(
        request as never,
      )
      const responseRecord = response as unknown as Record<string, unknown>
      const partialFailure = (response as unknown as {
        partial_failure_error?: { message?: string } | null
      }).partial_failure_error
      if (partialFailure?.message) {
        return {
          status: "failed",
          error: partialFailure.message,
          api_request: request,
          api_response: responseRecord,
        }
      }
      return {
        status: "uploaded",
        api_request: request,
        api_response: responseRecord,
      }
    } catch (err) {
      return {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        api_request: request,
      }
    }
  }

  // Adjustment path
  if (!row.adjustment_type) {
    return { status: "failed", error: "adjustment row missing adjustment_type" }
  }
  if (!row.gclid) {
    // GBRAID/WBRAID adjustments aren't supported the same way — skip with a
    // clear error so the admin knows to handle it manually.
    return { status: "failed", error: "adjustment requires gclid (gbraid/wbraid not supported)" }
  }

  // For RESTATE adjustments we need to reference the original conversion's
  // datetime (gclid_date_time_pair), not the new payment time.
  let originalConversionDateTime = conversionDateTime
  if (row.related_upload_id) {
    const original = await findConversionUploadBySource({
      source_table: row.source_table,
      source_id: row.source_id,
      upload_type: "click",
    })
    if (original) {
      originalConversionDateTime = gAdsDateTime(original.conversion_time)
    }
  }

  const adjustment: Record<string, unknown> = {
    conversion_action: conversionActionResource,
    adjustment_type: row.adjustment_type,
    adjustment_date_time: conversionDateTime,
    gclid_date_time_pair: {
      gclid: row.gclid,
      conversion_date_time: originalConversionDateTime,
    },
  }
  if (row.adjustment_type === "RESTATE") {
    adjustment.restatement_value = {
      adjusted_value: valueDollars,
      currency_code: row.currency,
    }
  }

  const request = {
    customer_id: row.customer_id,
    conversion_adjustments: [adjustment],
    partial_failure: true,
  }
  try {
    const response =
      await customer.conversionAdjustmentUploads.uploadConversionAdjustments(request as never)
    const responseRecord = response as unknown as Record<string, unknown>
    const partialFailure = (response as unknown as {
      partial_failure_error?: { message?: string } | null
    }).partial_failure_error
    if (partialFailure?.message) {
      return {
        status: "failed",
        error: partialFailure.message,
        api_request: request,
        api_response: responseRecord,
      }
    }
    return {
      status: "uploaded",
      api_request: request,
      api_response: responseRecord,
    }
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      api_request: request,
    }
  }
}

export interface ProcessConversionsResult {
  drained: number
  uploaded: number
  failed: number
  skipped: number
  exhausted: number // hit MAX_ATTEMPTS
}

/**
 * Drains the pending upload queue. Per-row try/catch; soft-skip when the
 * Developer Token is missing (rows stay pending). Adjustments before their
 * source click conversion has uploaded are also soft-skipped — they get
 * picked up on the next worker pass.
 */
export async function processPendingConversionUploads(): Promise<ProcessConversionsResult> {
  const result: ProcessConversionsResult = {
    drained: 0,
    uploaded: 0,
    failed: 0,
    skipped: 0,
    exhausted: 0,
  }
  const pending = await listPendingConversionUploads(WORKER_BATCH_SIZE)
  if (pending.length === 0) return result

  for (const row of pending) {
    result.drained++
    if (row.attempts >= MAX_ATTEMPTS) {
      // Final-failed: stop retrying. Admin can still see the row + error.
      await setConversionUploadResult(row.id, {
        status: "failed",
        error_message: `Max attempts (${MAX_ATTEMPTS}) exhausted; giving up`,
      })
      result.exhausted++
      continue
    }

    await incrementUploadAttempts(row.id)
    const upload = await uploadOne(row)

    if (upload.status === "skipped") {
      // No token yet — leave pending (don't burn the attempts counter for
      // a config issue we'll fix at the cutover).
      result.skipped++
      continue
    }
    await setConversionUploadResult(row.id, {
      status: upload.status,
      api_request: upload.api_request ?? null,
      api_response: upload.api_response ?? null,
      error_message: upload.error ?? null,
    })
    if (upload.status === "uploaded") result.uploaded++
    else result.failed++
  }
  return result
}

/**
 * Diagnostic helper for the admin dashboard: surfaces whether the system
 * has the configuration it needs to actually upload, without leaking
 * environment values.
 */
export interface ConversionsHealth {
  has_developer_token: boolean
  has_active_account: boolean
  conversion_actions_configured: number
  pending_count: number
}

export async function getConversionsHealth(): Promise<ConversionsHealth> {
  const accounts = await getActiveGoogleAdsAccounts()
  const actions = await listConversionActions()
  const pending = await listPendingConversionUploads(1)
  // listPendingConversionUploads is limited; for the count we'd need a
  // separate query. The admin page can use getConversionUploadStatusCounts.
  return {
    has_developer_token: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    has_active_account: accounts.length > 0,
    conversion_actions_configured: actions.filter((a) => a.is_active).length,
    pending_count: pending.length,
  }
}

export type { GoogleAdsConversionTrigger }

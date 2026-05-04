// lib/db/google-ads-conversion-uploads.ts
// DAL for the durable conversion-upload queue. Rows persist across the
// Developer Token cutover — the worker either drains them (token present)
// or leaves them pending (token missing).

import { createServiceRoleClient } from "@/lib/supabase"
import type {
  GoogleAdsConversionAdjustmentType,
  GoogleAdsConversionSourceTable,
  GoogleAdsConversionUpload,
  GoogleAdsConversionUploadStatus,
  GoogleAdsConversionUploadType,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface InsertConversionUploadInput {
  customer_id: string
  conversion_action_id: string
  upload_type: GoogleAdsConversionUploadType
  source_table: GoogleAdsConversionSourceTable
  source_id: string
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  conversion_time: string
  value_micros: number
  currency?: string
  adjustment_type?: GoogleAdsConversionAdjustmentType | null
  related_upload_id?: string | null
}

/**
 * Idempotent: the unique index on (source_table, source_id, upload_type,
 * COALESCE(adjustment_type, 'NONE')) means re-enqueueing the same conversion
 * for the same source row silently no-ops. Returns the row that's now in DB
 * (either freshly inserted or the pre-existing one).
 */
export async function insertConversionUpload(
  input: InsertConversionUploadInput,
): Promise<GoogleAdsConversionUpload | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_conversion_uploads")
    .insert({
      customer_id: input.customer_id,
      conversion_action_id: input.conversion_action_id,
      upload_type: input.upload_type,
      source_table: input.source_table,
      source_id: input.source_id,
      gclid: input.gclid ?? null,
      gbraid: input.gbraid ?? null,
      wbraid: input.wbraid ?? null,
      conversion_time: input.conversion_time,
      value_micros: input.value_micros,
      currency: input.currency ?? "USD",
      adjustment_type: input.adjustment_type ?? null,
      related_upload_id: input.related_upload_id ?? null,
    })
    .select()
    .single()
  if (error) {
    // Duplicate against the idempotency index → return the existing row.
    if (error.code === "23505") {
      return await findConversionUploadBySource({
        source_table: input.source_table,
        source_id: input.source_id,
        upload_type: input.upload_type,
        adjustment_type: input.adjustment_type ?? null,
      })
    }
    throw error
  }
  return data as GoogleAdsConversionUpload
}

export async function findConversionUploadBySource(opts: {
  source_table: GoogleAdsConversionSourceTable
  source_id: string
  upload_type: GoogleAdsConversionUploadType
  adjustment_type?: GoogleAdsConversionAdjustmentType | null
}): Promise<GoogleAdsConversionUpload | null> {
  const supabase = getClient()
  let query = supabase
    .from("google_ads_conversion_uploads")
    .select("*")
    .eq("source_table", opts.source_table)
    .eq("source_id", opts.source_id)
    .eq("upload_type", opts.upload_type)
  if (opts.adjustment_type) {
    query = query.eq("adjustment_type", opts.adjustment_type)
  } else {
    query = query.is("adjustment_type", null)
  }
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return (data as GoogleAdsConversionUpload | null) ?? null
}

export async function listPendingConversionUploads(
  limit: number = 50,
): Promise<GoogleAdsConversionUpload[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_conversion_uploads")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as GoogleAdsConversionUpload[]
}

export async function listRecentConversionUploads(
  limit: number = 50,
): Promise<GoogleAdsConversionUpload[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_conversion_uploads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as GoogleAdsConversionUpload[]
}

export interface ConversionUploadStatusCounts {
  pending: number
  uploaded: number
  failed: number
  skipped: number
}

export async function getConversionUploadStatusCounts(): Promise<ConversionUploadStatusCounts> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_conversion_uploads")
    .select("status")
  if (error) throw error
  const counts: ConversionUploadStatusCounts = {
    pending: 0,
    uploaded: 0,
    failed: 0,
    skipped: 0,
  }
  for (const row of (data ?? []) as Array<{ status: GoogleAdsConversionUploadStatus }>) {
    counts[row.status]++
  }
  return counts
}

export async function setConversionUploadResult(
  id: string,
  result: {
    status: GoogleAdsConversionUploadStatus
    api_request?: Record<string, unknown> | null
    api_response?: Record<string, unknown> | null
    error_message?: string | null
  },
): Promise<void> {
  const supabase = getClient()
  const update: Record<string, unknown> = {
    status: result.status,
    last_attempt_at: new Date().toISOString(),
    api_request: result.api_request ?? null,
    api_response: result.api_response ?? null,
    error_message: result.error_message ?? null,
  }
  if (result.status === "uploaded") {
    update.uploaded_at = new Date().toISOString()
  }
  const { error } = await supabase
    .from("google_ads_conversion_uploads")
    .update(update)
    .eq("id", id)
  if (error) throw error
}

export async function incrementUploadAttempts(id: string): Promise<void> {
  const supabase = getClient()
  // Postgres atomic increment via raw RPC isn't worth adding for a single
  // counter — read-modify-write is safe here because each row is only ever
  // touched by one worker run at a time (worker drains sequentially).
  const { data, error } = await supabase
    .from("google_ads_conversion_uploads")
    .select("attempts")
    .eq("id", id)
    .single()
  if (error) throw error
  const next = ((data as { attempts: number } | null)?.attempts ?? 0) + 1
  const { error: updErr } = await supabase
    .from("google_ads_conversion_uploads")
    .update({ attempts: next })
    .eq("id", id)
  if (updErr) throw updErr
}

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

export type BusinessSettings = {
  business_id: string
  display_name: string
  sender_name: string
  sender_email: string
  reply_to: string
  logo_url: string | null
  timezone: string
  quiet_hours_start: number
  quiet_hours_end: number
  daily_message_cap: number
  postal_address: string
  sms_help_text: string
  sms_messaging_service_sid: string
  sms_sender_phone: string
}

function getClient() {
  return createServiceRoleClient()
}

/**
 * Thrown when a business has no `business_settings` row at all -- not a
 * PostgREST error, a genuinely missing row. `create_business` always writes
 * one, so this is only reachable for a business created outside that
 * function. A subclass (not a bare Error) so callers that want to answer
 * "not found" instead of 500 can catch it by type rather than by matching
 * a message string.
 */
export class BusinessSettingsMissingError extends Error {
  constructor(businessId: string) {
    super(`business_settings row missing for ${businessId}`)
    this.name = "BusinessSettingsMissingError"
  }
}

export async function getBusinessSettings(
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<BusinessSettings> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("business_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new BusinessSettingsMissingError(businessId)
  return data as BusinessSettings
}

export async function updateBusinessSettings(
  patch: Partial<Omit<BusinessSettings, "business_id">>,
  businessId: string,
): Promise<BusinessSettings> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("business_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .select()
    .single()
  if (error) throw error
  return data as BusinessSettings
}

export type Business = {
  id: string
  name: string
  slug: string
  status: "active" | "paused"
  booking_provider: "calendly" | "native"
  created_by: string | null
  created_at: string
}

/** Thrown so the route can answer a field error instead of a 500. */
export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`The web address "${slug}" is already taken`)
    this.name = "SlugTakenError"
  }
}

export interface CreateBusinessInput {
  name: string
  slug: string
  timezone: string
  hostDisplayName: string
  hostEmail: string
  /** The operator creating it. Null for a system-created business. */
  createdBy: string | null
}

/**
 * Creates a whole tenant -- businesses + business_settings + booking_hosts +
 * an owner membership -- in ONE transaction, via the plpgsql function of
 * migration 00244. Four separate inserts from here could not be atomic
 * (supabase-js opens no transaction) and any subset is a broken tenant.
 *
 * Takes NO default businessId and never will: a new function that defaults
 * the tenant is how the next leak ships.
 */
export async function createBusiness(input: CreateBusinessInput): Promise<Business> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("create_business", {
    p_name: input.name.trim(),
    p_slug: input.slug.trim().toLowerCase(),
    p_timezone: input.timezone.trim(),
    p_host_display_name: input.hostDisplayName.trim(),
    p_host_email: input.hostEmail.trim(),
    p_created_by: input.createdBy,
  })
  if (error) {
    if (error.code === "23505") throw new SlugTakenError(input.slug)
    throw new Error(`create_business failed (${error.code}): ${error.message}`)
  }
  // PostgREST resolves rather than throwing, so a null row with a null error
  // is a real possible answer. Returning it as a Business would hand the
  // caller an undefined id.
  const row = (Array.isArray(data) ? data[0] : data) as Business | null
  if (!row) throw new Error("create_business returned no row")
  return row
}

export async function listBusinesses(opts?: { activeOnly?: boolean }): Promise<Business[]> {
  const supabase = getClient()
  let q = supabase.from("businesses").select("*").order("name", { ascending: true })
  if (opts?.activeOnly !== false) q = q.eq("status", "active")
  const { data, error } = await q
  if (error) throw new Error(`listBusinesses failed (${error.code}): ${error.message}`)
  return (data ?? []) as Business[]
}

export async function getBusiness(businessId: string): Promise<Business | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("businesses").select("*").eq("id", businessId).maybeSingle()
  if (error) throw new Error(`getBusiness failed (${error.code}): ${error.message}`)
  return (data as Business | null) ?? null
}

export interface UpdateBusinessPatch {
  name?: string
  status?: "active" | "paused"
}

export async function updateBusiness(businessId: string, patch: UpdateBusinessPatch): Promise<Business> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("businesses")
    .update(patch)
    .eq("id", businessId)
    .select()
    .single()
  if (error) throw new Error(`updateBusiness failed (${error.code}): ${error.message}`)
  return data as Business
}

/**
 * Which business owns this inbound number. The To number is the only tenant
 * evidence an inbound SMS carries, and business_settings.sms_sender_phone
 * (00221) already holds it.
 *
 * Returns null rather than throwing on no match: an unmatched number is the
 * ORDINARY case today, because sms_sender_phone is NOT NULL DEFAULT '' and
 * the platform's own number still lives in the environment. The caller falls
 * back to the platform business.
 */
export async function getBusinessBySmsNumber(toNumber: string): Promise<string | null> {
  const to = toNumber.trim()
  // '' would match every business that has not configured a number.
  if (!to) return null
  const { data, error } = await getClient()
    .from("business_settings")
    .select("business_id")
    .eq("sms_sender_phone", to)
    .maybeSingle()
  if (error) {
    // Logged, not thrown: a failed read here must not 500 the SMS webhook,
    // and PostgREST resolves rather than throwing so this is the only
    // diagnostic. The caller falls back to the platform business -- exactly
    // the same outcome as "no business claims this number", which is the
    // correct fail-safe direction for a compliance surface (STOP/START).
    console.error(`[businesses] getBusinessBySmsNumber failed (${error.code} ${error.message})`)
    return null
  }
  return (data as { business_id: string } | null)?.business_id ?? null
}

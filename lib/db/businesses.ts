import { createServiceRoleClient } from "@/lib/supabase"

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
  /**
   * Tenant brand kit for the page builder's palette default (migration
   * 00260). NULL means "this tenant has not chosen a brand" -- the page
   * builder's `resolvePalette()` falls through to today's var(--primary)
   * behaviour in that case. Never defaulted: a default would make every
   * existing tenant claim a brand it never set.
   */
  brand_color: string | null
  accent_color: string | null
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

export async function getBusinessSettings(businessId: string): Promise<BusinessSettings> {
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
  if (error) {
    // 00247's partial unique index. Matched on the column as well as the code:
    // Postgres names the index in `message` and the column in `details`, and a
    // unique violation on anything else must not read as a taken number.
    if (error.code === "23505" && `${error.message} ${error.details ?? ""}`.includes("sms_sender_phone")) {
      throw new SmsSenderPhoneTakenError()
    }
    throw error
  }
  return data as BusinessSettings
}

/**
 * Another business already sends from this number. Thrown so the settings
 * route can answer a field error instead of a 500. Carries no business id:
 * the other business is another tenant.
 */
export class SmsSenderPhoneTakenError extends Error {
  constructor() {
    super("sms_sender_phone is already another business's sender number")
    this.name = "SmsSenderPhoneTakenError"
  }
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
 * The unique constraint on businesses.slug (the dev clone's pg_constraint).
 * Only a violation naming it means the slug is taken.
 */
const SLUG_UNIQUE_CONSTRAINT = "businesses_slug_key"

/**
 * Creates a whole tenant -- the business, its settings, booking host and
 * owner membership, then, through `seed_business_starter_set` (00279), the
 * three boards and eleven draft sequences -- in ONE transaction, via the
 * plpgsql function of migration 00244. Separate inserts from here could not
 * be atomic (supabase-js opens no transaction) and any subset is a broken
 * tenant.
 *
 * Takes NO default businessId and never will: a new function that defaults
 * the tenant is how the next leak ships.
 *
 * The 23505 mapping below checks the constraint NAME, not just the code:
 * `create_business` now inserts many rows on top of the businesses row
 * (boards, stages, sequences, steps), so a bare 23505 no longer means the
 * slug clashed -- it could just as easily be a starter-set uniqueness
 * violation, which must NOT read as "slug taken" to the caller.
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
    if (error.code === "23505" && (error.message ?? "").includes(SLUG_UNIQUE_CONSTRAINT)) {
      throw new SlugTakenError(input.slug)
    }
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
 * Which business owns this inbound number. The To number is ONE of the two
 * pieces of tenant evidence an inbound SMS carries (the other is
 * `MessagingServiceSid` -- see `getBusinessByMessagingServiceSid` below,
 * which the webhook consults FIRST), and business_settings.sms_sender_phone
 * (00221) already holds it.
 *
 * Returns null rather than throwing on NO MATCH: an unmatched number is the
 * ORDINARY case today, because sms_sender_phone is NOT NULL DEFAULT '' and
 * the platform's own number still lives in the environment. The caller falls
 * back to the platform business.
 *
 * A genuine READ ERROR is a different case and must NOT collapse into the
 * same null (fix round 1, Important 1): PostgREST resolves rather than
 * throwing, so {data: null, error} and {data: null, error: null} look
 * identical unless the error is checked. Falling back to the platform
 * business on a transient read failure would route a coach's inbound STOP to
 * the WRONG tenant -- the suppression and consent rows land on the platform
 * business, and the coach's own sequences keep texting someone who just
 * opted out. That is a compliance failure, not a data-tidiness one, so this
 * THROWS on error instead: the caller's route (app/api/webhooks/twilio/
 * inbound/route.ts) already wraps this in one try/catch that turns any
 * exception into a 500, and Twilio retries a 500 -- the same "infra fault,
 * retryable" contract that route's own getBusinessSettings call documents
 * 100 lines below its own call site.
 *
 * Two businesses claiming the SAME non-empty number would also read as an
 * error here (.maybeSingle() answers PGRST116, "multiple rows returned"),
 * which is exactly the outcome wanted: 00247's partial unique index on
 * sms_sender_phone (WHERE sms_sender_phone <> '') makes that state
 * unreachable at the database, so this throw exists as defense in depth, not
 * as the primary guard.
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
  if (error) throw new Error(`getBusinessBySmsNumber failed (${error.code}): ${error.message}`)
  return (data as { business_id: string } | null)?.business_id ?? null
}

/**
 * Which business owns this Messaging Service. The second piece of tenant
 * evidence an inbound SMS carries, and in practice the ONLY one that
 * resolves today: every live `business_settings` row has `sms_sender_phone`
 * empty and only `sms_messaging_service_sid` (00221) filled in, so matching
 * on the To number alone sends every inbound text to the platform business.
 * Twilio posts `MessagingServiceSid` on the inbound webhook whenever the
 * receiving number belongs to a Messaging Service.
 *
 * SAME CONTRACT as `getBusinessBySmsNumber` above, deliberately -- read its
 * doc comment for the full reasoning, which applies here unchanged:
 *   - empty string -> `null` BEFORE querying, because the column is
 *     NOT NULL DEFAULT '' and a bare `.eq()` on '' matches every business
 *     that has not configured a Messaging Service;
 *   - no match -> `null` (the ordinary case; the caller falls back);
 *   - a genuine READ ERROR -> THROWS, never the same `null`. PostgREST
 *     resolves rather than throwing, so `{data: null, error}` and
 *     `{data: null, error: null}` are indistinguishable unless the error is
 *     checked, and falling back to the platform business on a transient
 *     failure would record a coach's STOP under the WRONG tenant. The
 *     inbound route turns the throw into a 500 and Twilio retries.
 *
 * ONE DIFFERENCE, and it is a real one: there is NO unique index on
 * `sms_messaging_service_sid`. `sms_sender_phone` has 00247's partial unique
 * index (`WHERE sms_sender_phone <> ''`), which makes "two businesses claim
 * the same number" unreachable at the database; `sms_messaging_service_sid`
 * appears in exactly one migration (00221, which adds the column) and in no
 * index at all. So the `.maybeSingle()` PGRST116 throw below is the PRIMARY
 * guard against two businesses sharing a Messaging Service, not defense in
 * depth -- and it fails closed (a 500 Twilio retries), which is the right
 * direction for an ambiguous tenant. No migration is added here: adding a
 * unique index is a schema decision with its own backfill question about the
 * rows already sitting on '', and it belongs in its own task.
 */
export async function getBusinessByMessagingServiceSid(sid: string): Promise<string | null> {
  const messagingServiceSid = sid.trim()
  // '' would match every business that has not configured a Messaging Service.
  if (!messagingServiceSid) return null
  const { data, error } = await getClient()
    .from("business_settings")
    .select("business_id")
    .eq("sms_messaging_service_sid", messagingServiceSid)
    .maybeSingle()
  if (error) {
    throw new Error(`getBusinessByMessagingServiceSid failed (${error.code}): ${error.message}`)
  }
  return (data as { business_id: string } | null)?.business_id ?? null
}

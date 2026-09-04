// lib/db/coach-calendar-connections.ts
//
// Wraps the five SQL functions from 00250 plus a handful of plain reads/writes
// on non-secret columns. See platform-connections.ts for the shape this
// follows; the split from that file exists because fn_connect_platform names
// its vault secret after the plugin alone, which lets a second tenant
// connecting the same provider silently overwrite the first tenant's token.
// This table's secret name is tenant- AND host-qualified instead (00240/00250).
import { createServiceRoleClient } from "@/lib/supabase"
import type { CoachCalendarConnection, CoachCalendarProvider, CoachCalendarStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getCoachCalendarConnection(
  hostId: string,
  provider: CoachCalendarProvider = "calendly",
): Promise<CoachCalendarConnection | null> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("fn_get_coach_calendar_connection", {
    p_host_id: hostId,
    p_provider: provider,
  })
  if (error) throw new Error(`getCoachCalendarConnection failed (${error.code}): ${error.message}`)
  const rows = (data ?? []) as CoachCalendarConnection[]
  return rows[0] ?? null
}

/** No caller in this phase — the spec names it as part of the quartet regardless. Ships with the rest. */
export async function listCoachCalendarConnections(businessId: string): Promise<CoachCalendarConnection[]> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("fn_list_coach_calendar_connections", {
    p_business_id: businessId,
  })
  if (error) throw new Error(`listCoachCalendarConnections failed (${error.code}): ${error.message}`)
  return (data ?? []) as CoachCalendarConnection[]
}

/** Exactly the nine `fn_connect_coach_calendar` parameters, camelCased. The RPC is the only consumer. */
export interface ConnectCoachCalendarInput {
  businessId: string
  hostId: string
  provider: CoachCalendarProvider
  credentials: Record<string, unknown>
  calendlyUserUri: string | null
  calendlyOrganizationUri: string | null
  calendlyRole: string | null
  accessTokenExpiresAt: string | null
  connectedBy: string | null
}

export async function connectCoachCalendar(input: ConnectCoachCalendarInput): Promise<CoachCalendarConnection> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("fn_connect_coach_calendar", {
    p_business_id: input.businessId,
    p_host_id: input.hostId,
    p_provider: input.provider,
    p_credentials: input.credentials,
    p_calendly_user_uri: input.calendlyUserUri,
    p_calendly_organization_uri: input.calendlyOrganizationUri,
    p_calendly_role: input.calendlyRole,
    p_access_token_expires_at: input.accessTokenExpiresAt,
    p_connected_by: input.connectedBy,
  })
  if (error) throw new Error(`connectCoachCalendar failed (${error.code}): ${error.message}`)
  const rows = (data ?? []) as CoachCalendarConnection[]
  if (!rows[0]) throw new Error(`connectCoachCalendar: no row returned for host ${input.hostId}`)
  return rows[0]
}

export async function disconnectCoachCalendar(
  hostId: string,
  provider: CoachCalendarProvider = "calendly",
): Promise<CoachCalendarConnection> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("fn_disconnect_coach_calendar", {
    p_host_id: hostId,
    p_provider: provider,
  })
  if (error) throw new Error(`disconnectCoachCalendar failed (${error.code}): ${error.message}`)
  const rows = (data ?? []) as CoachCalendarConnection[]
  if (!rows[0]) throw new Error(`disconnectCoachCalendar: no row returned for host ${hostId}`)
  return rows[0]
}

export interface StoreRefreshedCalendarCredentialsInput {
  connectionId: string
  expectedRefreshToken: string
  credentials: Record<string, unknown>
  accessTokenExpiresAt: string
}

/**
 * The refresh compare-and-swap. `stored: false` means somebody else already
 * rotated the refresh token first — see 00250's comment on
 * fn_store_refreshed_calendar_credentials for why that is the winner's
 * credentials handed back rather than an error: Calendly's refresh tokens are
 * single-use, so the loser of a race must adopt the winner's token, not retry
 * its own.
 */
export async function storeRefreshedCalendarCredentials(
  input: StoreRefreshedCalendarCredentialsInput,
): Promise<{ stored: boolean; credentials: Record<string, unknown> }> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("fn_store_refreshed_calendar_credentials", {
    p_connection_id: input.connectionId,
    p_expected_refresh_token: input.expectedRefreshToken,
    p_credentials: input.credentials,
    p_access_token_expires_at: input.accessTokenExpiresAt,
  })
  if (error) throw new Error(`storeRefreshedCalendarCredentials failed (${error.code}): ${error.message}`)
  const rows = (data ?? []) as Array<{ stored: boolean; credentials: Record<string, unknown> }>
  const row = rows[0]
  if (!row) throw new Error("storeRefreshedCalendarCredentials: no row returned")
  return row
}

export async function setCoachCalendarError(
  connectionId: string,
  status: CoachCalendarStatus,
  message: string,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("coach_calendar_connections")
    .update({ status, last_error: message })
    .eq("id", connectionId)
  if (error) throw new Error(`setCoachCalendarError failed (${error.code}): ${error.message}`)
}

export interface UpdateCoachCalendarEventTypeInput {
  connectionId: string
  eventTypeUri: string
  schedulingUrl: string | null
  webhookSubscriptionUri: string | null
  /**
   * Mirrored from `POST /webhook_subscriptions`, because the uri alone does not
   * say whether Calendly is still delivering: it disables a subscription after
   * 24 hours of failures and the uri is unchanged when it does. Spec §6.3's
   * screen has nothing else to show for "bookings stopped arriving".
   */
  webhookState: string | null
}

export async function updateCoachCalendarEventType(input: UpdateCoachCalendarEventTypeInput): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("coach_calendar_connections")
    .update({
      event_type_uri: input.eventTypeUri,
      scheduling_url: input.schedulingUrl,
      webhook_subscription_uri: input.webhookSubscriptionUri,
      webhook_state: input.webhookState,
    })
    .eq("id", input.connectionId)
  // A CALLER MATCHES ON THIS STRING. PostgREST's error object does not survive
  // `new Error`, so `app/api/admin/bookings/calendar/event-type` reads the
  // `(23505)` and the constraint name back out of the message to tell "that
  // event type is already connected to another coach's calendar" apart from a
  // generic failure. The format below is that caller's contract.
  if (error) throw new Error(`updateCoachCalendarEventType failed (${error.code}): ${error.message}`)
}

/**
 * Put the connection back where a coach can pick a meeting again.
 *
 * `event_type_uri` is claimed BEFORE the webhook subscription is registered
 * (see the event-type route's header: the uniqueness conflict has to surface
 * before anything exists in Calendly to clean up). When that registration then
 * fails for a reason the coach cannot act on, the claim has to be given back —
 * otherwise the row reads `connected` with a chosen meeting and no
 * subscription, which the screen renders as a working calendar that will never
 * receive a booking, and only Disconnect gets out of it.
 *
 * DELIBERATELY NOT A `null` OVERLOAD OF updateCoachCalendarEventType. That
 * function's whole contract is a claim, and its caller matches on the 23505
 * that a claim can raise; giving away the claim is the opposite operation and
 * raises nothing.
 *
 * NOT for `plan_lapsed`, which deliberately KEEPS the pick so the coach can
 * upgrade and re-pick with their choice still selected.
 */
export async function clearCoachCalendarEventType(connectionId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("coach_calendar_connections")
    .update({
      event_type_uri: null,
      scheduling_url: null,
      webhook_subscription_uri: null,
      webhook_state: null,
      webhook_checked_at: null,
    })
    .eq("id", connectionId)
  if (error) throw new Error(`clearCoachCalendarEventType failed (${error.code}): ${error.message}`)
}

/**
 * What Calendly said about the subscription just now, and when we asked.
 *
 * `webhook_state` was written once at creation and never again, which made a
 * frozen snapshot look like live status on the screen — the one failure the
 * column exists to catch (Calendly disables a subscription after 24 hours of
 * failed deliveries, silently stopping every booking) was the one it could not
 * show. `/admin/bookings/calendar` re-reads the subscription on render and
 * calls this with the answer, which is also the only writer
 * `webhook_checked_at` has.
 *
 * `state` is Calendly's own word (`active` / `disabled`), or `removed` when
 * Calendly 404s the subscription — we do not invent a Calendly state for a
 * subscription Calendly no longer has.
 */
export async function recordCoachCalendarWebhookState(connectionId: string, state: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("coach_calendar_connections")
    .update({ webhook_state: state, webhook_checked_at: new Date().toISOString() })
    .eq("id", connectionId)
  if (error) throw new Error(`recordCoachCalendarWebhookState failed (${error.code}): ${error.message}`)
}

export async function confirmCoachCalendarConflictCheck(connectionId: string, confirmed: boolean): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("coach_calendar_connections")
    .update({ conflict_check_confirmed_at: confirmed ? new Date().toISOString() : null })
    .eq("id", connectionId)
  if (error) throw new Error(`confirmCoachCalendarConflictCheck failed (${error.code}): ${error.message}`)
}

/**
 * The webhook's tenant proof. Matches on `event_type_uri`, which 00240 made
 * uniquely claimable with a partial unique index -- so one event type cannot
 * belong to two connections and this match is a function, not a heuristic.
 *
 * THROWS ON A READ ERROR, and that is the whole point. PostgREST resolves
 * rather than throws, so `{ data: null, error }` and "nothing matched" are the
 * same shape. If this returned null for both, the webhook would take its
 * environment-variable ramp and file another coach's booking into the
 * platform's tenant. Null means matched nothing; a throw means could not look.
 */
export async function findCoachCalendarConnectionByEventType(
  eventTypeUri: string,
): Promise<CoachCalendarConnection | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("coach_calendar_connections")
    .select("*")
    .eq("event_type_uri", eventTypeUri)
    .maybeSingle()
  if (error) throw new Error(`findCoachCalendarConnectionByEventType failed (${error.code}): ${error.message}`)
  return (data as CoachCalendarConnection | null) ?? null
}

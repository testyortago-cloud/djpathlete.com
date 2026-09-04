// lib/calendly/account.ts — the Calendly API calls the per-coach connect flow
// needs once a coach has an OAuth access token: who the token belongs to, what
// event types they have, and owning the webhook subscription that delivers
// their bookings to us -- create it, READ ITS STATE BACK, delete it.
//
// The first three are the same calls scripts/calendly-setup.mjs already makes
// by hand with a personal access token (/users/me, /event_types?user=…, POST
// /webhook_subscriptions) -- that script is where the request and response
// shapes below were proven, not guessed.
//
// CALENDLY WEBHOOKS REQUIRE A PAID PLAN (Standard, Teams or Enterprise).
// POST /webhook_subscriptions answers 403 on a Free account -- that is the
// documented meaning of the `plan_lapsed` status migration 00240 put in
// coach_calendar_connections' CHECK constraint, and the difference between a
// coach reading "Calendly only sends us bookings on a paid plan -- upgrade in
// Calendly, then pick your meeting again" and reading "something went
// wrong". createWebhookSubscription raises CalendlyPlanRequiredError
// specifically for THAT 403.
//
// THAT CLASSIFICATION IS NOT SYMMETRIC. A 403 from GET /users/me or GET
// /event_types means a bad/expired token or a missing permission, not a plan
// problem -- this module only attributes 403 to the plan on the one call
// where that is Calendly's documented behavior. Everywhere else, 403 is a
// plain CalendlyAccountError("http", …, 403), same as any other non-2xx.
//
// Style follows lib/calendly/client.ts: injectable `fetchImpl`, Zod `.loose()`
// parsing so an added Calendly field is never a failure, and a typed error
// class carrying a `reason`/`status` discriminator (mirroring
// CalendlyUnavailable and lib/calendly/oauth.ts's CalendlyOAuthError) so
// "could not read" and "nothing there" stay different answers.

import { z } from "zod"

import { CALENDLY_API_BASE_DEFAULT } from "@/lib/calendly/env"

const REQUEST_TIMEOUT_MS = 8_000

export type CalendlyIdentity = {
  uri: string
  name: string
  email: string
  schedulingUrl: string
  organizationUri: string | null
}

export type CalendlyEventType = {
  uri: string
  name: string
  durationMinutes: number
  schedulingUrl: string
  active: boolean
}

export type CalendlyAccountErrorReason = "network" | "http" | "shape"

/**
 * Thrown when identity, event types, or a webhook subscription could not be
 * read or written, for any reason OTHER than "this plan doesn't include
 * webhooks" (that is CalendlyPlanRequiredError below, and only
 * createWebhookSubscription throws it). Mirrors CalendlyUnavailable
 * (lib/calendly/client.ts) and CalendlyOAuthError (lib/calendly/oauth.ts).
 */
export class CalendlyAccountError extends Error {
  readonly reason: CalendlyAccountErrorReason
  readonly status: number | null
  /**
   * Calendly's OWN words about what is wrong, when it bothered to say.
   *
   * A 400 from Calendly carries `details[].message` naming the exact
   * parameter and the exact fix -- and throwing that away is how a screen ends
   * up telling a coach to "try again in a moment" about a scope no retry can
   * grant. That is not hypothetical: the first real go-live failed on
   *   missing required scope: scheduled_events:read for event: invitee.created
   * and the sentence that would have fixed it in seconds was in the response
   * body all along, discarded into a log line.
   *
   * Empty for faults that have nothing to tell anyone -- a 5xx, a timeout, a
   * body that did not parse.
   */
  readonly details: string[]

  constructor(
    reason: CalendlyAccountErrorReason,
    message: string,
    status: number | null = null,
    details: string[] = [],
  ) {
    super(message)
    this.name = "CalendlyAccountError"
    this.reason = reason
    this.status = status
    this.details = details
  }

  /**
   * Whether trying the same call again could plausibly succeed.
   *
   * A 4xx says WE sent something wrong, so a retry sends the same wrong thing.
   * Only a 5xx, a 429 or a transport fault earns "try again". Keyed on the
   * status rather than on `details` being empty, so a 4xx with an unparseable
   * body is still correctly non-retryable.
   */
  get retryable(): boolean {
    if (this.reason === "network") return true
    if (this.status === null) return true
    if (this.status === 429) return true
    return this.status >= 500
  }
}

/**
 * Pull Calendly's per-parameter complaints out of an error body, falling back
 * to its top-level `message`. Never throws: an unparseable body simply has
 * nothing to say, and the caller's generic wording covers it.
 */
export function calendlyErrorDetails(bodyText: string): string[] {
  try {
    const body = JSON.parse(bodyText) as { message?: unknown; details?: unknown }
    const details = Array.isArray(body.details)
      ? body.details
          .map((d) => (d && typeof d === "object" ? (d as { message?: unknown }).message : null))
          .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      : []
    if (details.length > 0) return details
    return typeof body.message === "string" && body.message.trim().length > 0 ? [body.message] : []
  } catch {
    return []
  }
}

/**
 * Thrown ONLY by createWebhookSubscription, ONLY when Calendly answers 403
 * to POST /webhook_subscriptions -- the documented signature of a Free-plan
 * account (webhooks need Standard, Teams or Enterprise). Migration 00240's
 * `plan_lapsed` connection status exists for this case. See the file header:
 * a 403 anywhere else in this module is not attributable to plan.
 */
export class CalendlyPlanRequiredError extends Error {
  constructor(
    message = "This Calendly account's plan does not include webhooks. Upgrade to Standard, Teams, or Enterprise in Calendly, then pick your meeting again.",
  ) {
    super(message)
    this.name = "CalendlyPlanRequiredError"
  }
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
}

async function rawFetch(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (err) {
    throw new CalendlyAccountError("network", `Calendly request to ${url} failed: ${(err as Error).message}`)
  }
}

async function parseJson(response: Response, context: string): Promise<unknown> {
  try {
    return await response.json()
  } catch (err) {
    throw new CalendlyAccountError(
      "shape",
      `${context} body was not JSON: ${(err as Error).message}`,
      response.status,
    )
  }
}

// `.loose()` throughout: Calendly adds fields over time and a new key must
// never turn a good response into a "shape" failure.

const identityResponseSchema = z
  .object({
    resource: z
      .object({
        uri: z.string().min(1),
        name: z.string(),
        email: z.string(),
        scheduling_url: z.string(),
        current_organization: z.string().nullable().optional(),
      })
      .loose(),
  })
  .loose()

export type FetchIdentityArgs = {
  accessToken: string
  apiBase?: string
  fetchImpl?: typeof fetch
}

/** Who an access token belongs to -- GET /users/me. */
export async function fetchIdentity(args: FetchIdentityArgs): Promise<CalendlyIdentity> {
  const fetchImpl = args.fetchImpl ?? fetch
  const apiBase = args.apiBase ?? CALENDLY_API_BASE_DEFAULT
  const url = new URL("/users/me", apiBase).toString()

  const response = await rawFetch(fetchImpl, url, { method: "GET", headers: authHeaders(args.accessToken) })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new CalendlyAccountError("http", `GET /users/me answered ${response.status} ${text}`, response.status)
  }

  const body = await parseJson(response, "GET /users/me")
  const parsed = identityResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new CalendlyAccountError("shape", "GET /users/me returned an unexpected shape", response.status)
  }

  const resource = parsed.data.resource
  return {
    uri: resource.uri,
    name: resource.name,
    email: resource.email,
    schedulingUrl: resource.scheduling_url,
    organizationUri: resource.current_organization ?? null,
  }
}

const eventTypeSchema = z
  .object({
    uri: z.string().min(1),
    name: z.string(),
    duration: z.number(),
    scheduling_url: z.string(),
    active: z.boolean(),
  })
  .loose()

const listEventTypesResponseSchema = z.object({ collection: z.array(eventTypeSchema) }).loose()

export type ListEventTypesArgs = {
  accessToken: string
  userUri: string
  apiBase?: string
  fetchImpl?: typeof fetch
}

/** A user's active event types -- GET /event_types?user=…&active=true. */
export async function listEventTypes(args: ListEventTypesArgs): Promise<CalendlyEventType[]> {
  const fetchImpl = args.fetchImpl ?? fetch
  const apiBase = args.apiBase ?? CALENDLY_API_BASE_DEFAULT
  const url = new URL("/event_types", apiBase)
  url.searchParams.set("user", args.userUri)
  url.searchParams.set("active", "true")
  url.searchParams.set("count", "50")

  const response = await rawFetch(fetchImpl, url.toString(), { method: "GET", headers: authHeaders(args.accessToken) })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new CalendlyAccountError("http", `GET /event_types answered ${response.status} ${text}`, response.status)
  }

  const body = await parseJson(response, "GET /event_types")
  const parsed = listEventTypesResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new CalendlyAccountError("shape", "GET /event_types returned an unexpected shape", response.status)
  }

  return parsed.data.collection.map((t) => ({
    uri: t.uri,
    name: t.name,
    durationMinutes: t.duration,
    schedulingUrl: t.scheduling_url,
    active: t.active,
  }))
}

const webhookSubscriptionResponseSchema = z
  .object({
    resource: z
      .object({
        uri: z.string().min(1),
        state: z.string().min(1),
      })
      .loose(),
  })
  .loose()

export type CreateWebhookSubscriptionArgs = {
  accessToken: string
  organizationUri: string
  userUri: string
  callbackUrl: string
  /** Chosen by us, one platform-owned key for every coach -- never issued by Calendly, never shown to a coach. */
  signingKey: string
  apiBase?: string
  fetchImpl?: typeof fetch
}

/**
 * POST /webhook_subscriptions, subscribed to exactly invitee.created and
 * invitee.canceled with scope "user". Calendly requires the `organization`
 * URI on every subscription request, and additionally `user` when
 * scope is "user" -- both are sent.
 */
export async function createWebhookSubscription(
  args: CreateWebhookSubscriptionArgs,
): Promise<{ uri: string; state: string }> {
  const fetchImpl = args.fetchImpl ?? fetch
  const apiBase = args.apiBase ?? CALENDLY_API_BASE_DEFAULT
  const url = new URL("/webhook_subscriptions", apiBase).toString()

  const response = await rawFetch(fetchImpl, url, {
    method: "POST",
    headers: authHeaders(args.accessToken),
    body: JSON.stringify({
      url: args.callbackUrl,
      events: ["invitee.created", "invitee.canceled"],
      organization: args.organizationUri,
      user: args.userUri,
      scope: "user",
      signing_key: args.signingKey,
    }),
  })

  if (response.status === 403) {
    // THE one 403 this module can actually attribute -- see the file header.
    throw new CalendlyPlanRequiredError()
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new CalendlyAccountError(
      "http",
      `POST /webhook_subscriptions answered ${response.status} ${text}`,
      response.status,
      // Only a 4xx is worth quoting to a coach: it names something WE sent that
      // Calendly refused, which is a thing they can act on. A 5xx's body is
      // about Calendly's own trouble and telling them about it helps nobody.
      response.status < 500 ? calendlyErrorDetails(text) : [],
    )
  }

  const body = await parseJson(response, "POST /webhook_subscriptions")
  const parsed = webhookSubscriptionResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new CalendlyAccountError("shape", "POST /webhook_subscriptions returned an unexpected shape", response.status)
  }

  return { uri: parsed.data.resource.uri, state: parsed.data.resource.state }
}

export type GetWebhookSubscriptionArgs = {
  accessToken: string
  /** The absolute uri Calendly handed back at creation, stored on the connection row. */
  subscriptionUri: string
  fetchImpl?: typeof fetch
}

/**
 * Read ONE subscription back -- the only way to learn whether Calendly is
 * still delivering. Calendly disables a subscription after 24 hours of failed
 * deliveries and the uri is UNCHANGED when it does, so the `state` stored at
 * creation is a snapshot of one moment, not a status. This is what re-reads it.
 *
 * `null` means Calendly no longer has this subscription (404) -- a real
 * answer, and a different one from "we could not look", which throws. Same
 * split as findCoachCalendarConnectionByEventType: conflating them would let a
 * transient outage be recorded as "bookings have stopped".
 *
 * The uri is used as the URL directly, exactly as deleteWebhookSubscription
 * does -- Calendly's resource uris are absolute, so there is no apiBase to
 * join them onto.
 */
export async function getWebhookSubscription(
  args: GetWebhookSubscriptionArgs,
): Promise<{ uri: string; state: string } | null> {
  const fetchImpl = args.fetchImpl ?? fetch
  const response = await rawFetch(fetchImpl, args.subscriptionUri, {
    method: "GET",
    headers: authHeaders(args.accessToken),
  })

  if (response.status === 404) return null

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new CalendlyAccountError(
      "http",
      `GET ${args.subscriptionUri} answered ${response.status} ${text}`,
      response.status,
    )
  }

  const body = await parseJson(response, `GET ${args.subscriptionUri}`)
  const parsed = webhookSubscriptionResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new CalendlyAccountError("shape", `GET ${args.subscriptionUri} returned an unexpected shape`, response.status)
  }

  return { uri: parsed.data.resource.uri, state: parsed.data.resource.state }
}

export type DeleteWebhookSubscriptionArgs = {
  accessToken: string
  subscriptionUri: string
  fetchImpl?: typeof fetch
}

/**
 * DELETE the subscription. A 404 is treated as success: already-gone is the
 * desired end state, and a disconnect must not fail because the thing it
 * wants gone is already gone.
 */
export async function deleteWebhookSubscription(args: DeleteWebhookSubscriptionArgs): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const response = await rawFetch(fetchImpl, args.subscriptionUri, {
    method: "DELETE",
    headers: authHeaders(args.accessToken),
  })

  if (response.ok || response.status === 404) return

  const text = await response.text().catch(() => "")
  throw new CalendlyAccountError(
    "http",
    `DELETE ${args.subscriptionUri} answered ${response.status} ${text}`,
    response.status,
  )
}

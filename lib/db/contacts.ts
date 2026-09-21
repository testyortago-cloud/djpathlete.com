// The one entry point every front door calls.

import { createServiceRoleClient } from "@/lib/supabase"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"
import { isUsableTimezone } from "@/lib/timezones"
import { decideMerge, type MatchCandidate } from "@/lib/lead-engine/merge"
import { enrollIfTriggered } from "@/lib/lead-engine/enroll"

export type ContactEventSource =
  | "funnel_form"
  | "funnel_checkout"
  | "contact_form"
  | "newsletter"
  | "lead_magnet"
  | "event_signup"
  | "shop"
  | "assessment"
  | "questionnaire"
  | "step_up"
  | "ai_chat"
  | "inquiry"
  | "purchase"
  /**
   * A Checkout session that expired without being paid. Written from the
   * Stripe webhook's `checkout.session.expired` case. NOT `funnel_checkout`,
   * which means the opposite -- a checkout that succeeded.
   */
  | "checkout_abandoned"
  // NO MIGRATION NEEDED. `contact_timeline_events.source` is plain
  // `text NOT NULL` with no CHECK constraint (00214_lead_engine_timeline.sql),
  // so this union is the only place the set is enforced.
  | "quiz"

/**
 * Which members of ContactEventSource mean "this person paid" — see
 * `PURCHASE_SOURCES` below, read by `hasPurchaseSince`.
 *
 * WHY THIS EXISTS (gap #14, fix round 1): `hasPurchaseSince` used to filter
 * `.eq("source", "purchase")` directly. That was correct only while
 * `purchase` was the ONE source a completed checkout could write. Once gap
 * #14 narrowed it -- a `shop_order` checkout now writes `shop`, a
 * `funnel_purchase` checkout now writes `funnel_checkout` -- that literal
 * filter silently stopped seeing two of the three ways a person can pay.
 * The concrete break: someone abandons a funnel checkout, pays on a SECOND
 * funnel checkout (now `funnel_checkout`, not `purchase`), and ~24h later
 * Stripe's `checkout.session.expired` fires for the FIRST session; the
 * webhook's `alreadyPurchased` guard (app/api/stripe/webhook/route.ts, the
 * `checkout.session.expired` case) reads `hasPurchaseSince`, found nothing,
 * and would have enrolled a paying customer in the abandoned-checkout
 * sequence to chase them for a cart they already paid for.
 *
 * A `Record<ContactEventSource, boolean>` rather than a bare array so tsc
 * enforces completeness: adding a member to `ContactEventSource` without
 * deciding whether it belongs here is a compile error (a missing key on a
 * `Record` over a union type), not a silent gap the way the old literal
 * `.eq()` was. `checkout_abandoned` is explicitly `false` — it means the
 * OPPOSITE of a purchase, and must never be added to `PURCHASE_SOURCES`.
 */
const IS_PURCHASE_SOURCE: Record<ContactEventSource, boolean> = {
  funnel_form: false,
  funnel_checkout: true,
  contact_form: false,
  newsletter: false,
  lead_magnet: false,
  event_signup: false,
  shop: true,
  assessment: false,
  questionnaire: false,
  step_up: false,
  ai_chat: false,
  inquiry: false,
  purchase: true,
  checkout_abandoned: false,
  quiz: false,
}

/**
 * Every member of `ContactEventSource`, derived from `IS_PURCHASE_SOURCE`'s
 * keys rather than hand-copied, so this list can never drift from the union.
 * `IS_PURCHASE_SOURCE`'s type forces the object literal above to have an
 * entry for every member (a missing one is a compile error) and rejects an
 * extra key that isn't one (an excess-property error on the literal), so
 * `Object.keys` on it enumerates exactly `ContactEventSource`'s members, no
 * more and no fewer.
 *
 * Exists so a test that needs to walk "every declared contact source" (e.g.
 * the `SOURCE_LABELS` completeness test in
 * __tests__/lib/db/contact-detail.test.ts) can drive off the union itself
 * instead of a hand-copied literal list -- a hand-copied list is exactly the
 * kind of guard that stops guarding the moment someone adds a source and
 * forgets to update the separate list too.
 */
export const ALL_CONTACT_EVENT_SOURCES: readonly ContactEventSource[] = Object.keys(
  IS_PURCHASE_SOURCE,
) as ContactEventSource[]

/**
 * Every `ContactEventSource` that means "this person paid", derived from
 * `IS_PURCHASE_SOURCE` above so the two can never disagree. The ONLY reader
 * today is `hasPurchaseSince` below; a future caller asking "has this
 * contact paid" should read this rather than re-deciding the question
 * against a source list of its own.
 */
export const PURCHASE_SOURCES: readonly ContactEventSource[] = ALL_CONTACT_EVENT_SOURCES.filter(
  (source) => IS_PURCHASE_SOURCE[source],
)

export type RecordContactEventInput = {
  email?: string | null
  phone?: string | null
  name?: string | null
  source: ContactEventSource
  attributionSessionId?: string | null
  /** See `UpsertContactIdentityInput.userId` — passed straight through. */
  userId?: string | null
  /** See `UpsertContactIdentityInput.timezone` — passed straight through. */
  timezone?: string | null
  /** See `UpsertContactIdentityInput.nameFillOnly` — passed straight through. */
  nameFillOnly?: boolean
  metadata?: Record<string, unknown>
  /**
   * G11. `events.start_date` when this event is an event signup — the moment
   * an anchored `wait` counts down to. Passed straight through to
   * `enrollIfTriggered`, which explains why it is not a `metadata` key.
   */
  anchorAt?: string | null
  businessId: string
}

function getClient() {
  return createServiceRoleClient()
}

// Two separate equality queries, unioned in JS, instead of a single .or()
// filter built by string interpolation. An email or phone value dropped
// straight into PostgREST filter syntax could contain a comma or parenthesis
// and corrupt the filter; .eq() never parses user input as syntax.
async function findMatchCandidates(
  supabase: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
  email: string | null,
  phone: string | null,
): Promise<MatchCandidate[]> {
  const byId = new Map<string, MatchCandidate>()

  if (email) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id,email,phone_e164,created_at,first_touch_session_id,user_id,timezone,name")
      .eq("business_id", businessId)
      .eq("email", email)
    if (error) throw error
    for (const row of (data ?? []) as MatchCandidate[]) byId.set(row.id, row)
  }

  if (phone) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id,email,phone_e164,created_at,first_touch_session_id,user_id,timezone,name")
      .eq("business_id", businessId)
      .eq("phone_e164", phone)
    if (error) throw error
    for (const row of (data ?? []) as MatchCandidate[]) byId.set(row.id, row)
  }

  return Array.from(byId.values())
}

/**
 * A `users` row a contact may be linked to. `status: "lead"` rows are NOT
 * accounts: app/api/contact, app/api/inquiry and the funnel checkout mint one
 * for a stranger with no password, and registration later upgrades that same
 * row to `active`. Linking a contact to the placeholder would make
 * `has_user` ("already a client", the quiz sequences' branch) true for
 * someone who cannot log in. Production on 2026-09-20: of the 54 contacts
 * matching a `users` row by email, 11 matched only a placeholder.
 *
 * `lead` is the ONLY excluded status, deliberately. `inactive` and
 * `suspended` rows ARE linkable: a deactivated client is still a client, and
 * "already a client" is the true answer for them. (Production has none of
 * either today — this is here so the next reader does not relitigate it.)
 */
function isLinkableAccount(row: { id: string; status?: string | null }): boolean {
  return row.status !== "lead"
}

function logAccountLookupFault(branch: "id" | "email", err: unknown): void {
  // `code`/`message` only — `details` can embed the email address.
  const pgErr = err as { code?: unknown; message?: unknown } | null | undefined
  console.error(`resolveLinkableUserId: ${branch} lookup failed; contact written unlinked`, {
    code: typeof pgErr?.code === "string" ? pgErr.code : undefined,
    message: typeof pgErr?.message === "string" ? pgErr.message : undefined,
  })
}

/**
 * The account this contact belongs to, or null (most leads have none).
 *
 * `email` is THE EMAIL ON THE ROW being written — the submitted one on
 * create, the row's own on update/merge (see `upsertContactIdentity`) —
 * never an address `buildIdentifierPatch` just refused as a conflict. The
 * identity rule and the link rule have to agree: two people sharing a phone
 * (review finding C1) would otherwise have one person's contact linked to
 * the other's account, permanently, because a link is fill-only.
 *
 * `userId` — from a session or from Stripe metadata this app wrote itself —
 * is consulted first, but is honoured only when it names a real, linkable
 * `users` row WHOSE EMAIL IS THIS ROW'S EMAIL (normalised), or when the row
 * has no email at all (a phone-only contact). A checkout that pins no
 * customer email lets a signed-in buyer type any receipt address (review
 * finding I1): that address is not proof of who owns it, so the id must not
 * win over it. What the id lookup still buys is the cohort an exact
 * `.eq("email")` cannot reach — `users` stores the address as typed, and a
 * mixed-case account email compares equal here after normalisation. The
 * FK check is the other reason it is verified at all: `contacts.user_id`
 * references `users(id)`, and a stale id (a user deleted between checkout
 * and webhook delivery) would turn the whole contact insert into a 23503.
 *
 * Then the account whose `email` equals the row's email exactly
 * (`users_email_key` is unique, so `.maybeSingle()` is safe); the one-time
 * backfill in migration 00264 covers legacy mixed-case rows.
 *
 * The phone-only allowance rests on one invariant, so name it: NO CALLER MAY
 * PASS A `userId` THE SUBMITTER CONTROLS. Today they cannot — the only
 * producers are a server-side session and the Stripe metadata this app
 * stamps at mint time. Accept a `userId` from a request body and the
 * `args.email === null` branch becomes "link me to whoever I say".
 *
 * NEVER throws, and each branch fails on its own (review finding I2): a
 * fault on the id lookup — a transient error, a non-UUID id — must still let
 * the email match run. The contact write is the thing that matters and a
 * link is recoverable (the next submission, the register route, or a
 * backfill fills it); a lookup fault here must not cost the lead.
 */
async function resolveLinkableUserId(
  supabase: ReturnType<typeof createServiceRoleClient>,
  args: { userId?: string | null; email: string | null },
): Promise<string | null> {
  if (args.userId) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, status, email")
        .eq("id", args.userId)
        .maybeSingle()
      if (error) throw error
      const row = data as { id: string; status?: string | null; email?: string | null } | null
      if (row && isLinkableAccount(row) && (args.email === null || normaliseEmail(row.email) === args.email)) {
        return row.id
      }
    } catch (err) {
      logAccountLookupFault("id", err)
    }
  }
  if (args.email) {
    try {
      const { data, error } = await supabase.from("users").select("id, status").eq("email", args.email).maybeSingle()
      if (error) throw error
      const row = data as { id: string; status?: string | null } | null
      if (row && isLinkableAccount(row)) return row.id
    } catch (err) {
      logAccountLookupFault("email", err)
    }
  }
  return null
}

/**
 * FILL-ONLY, like `firstTouchSessionPatch` below: a contact is one person,
 * and the account it was first linked to is the account it stays linked to.
 * The lookup is only made when the row has no link yet — an already-linked
 * contact costs no `users` query at all. On the merge path
 * `existingUserId` is EITHER pre-merge row's link (see the caller): the
 * `merge_contacts` RPC copies the loser's user_id onto a survivor that has
 * none, so a survivor whose own value was null may just have been linked,
 * inside the RPC, to a truer account than the one this request resolves.
 */
async function userIdPatch(
  existingUserId: string | null | undefined,
  resolve: () => Promise<string | null>,
): Promise<Record<string, unknown>> {
  if (existingUserId != null) return {}
  const userId = await resolve()
  if (!userId) return {}
  return { user_id: userId }
}

// Applies a patch to the contacts row and throws on failure. Used for both
// the plain-update path and the post-merge patch of the survivor: recording
// who this person is must never fail silently.
async function updateContact(
  supabase: ReturnType<typeof createServiceRoleClient>,
  contactId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase.from("contacts").update(patch).eq("id", contactId)
  if (error) throw error
}

/**
 * FIRST TOUCH WINS. The session that brought this person in the first time is
 * the one that gets credit for whatever they eventually buy, so this patch
 * only ever FILLS a null — never replaces a session already on file, which
 * would re-credit the latest visit and quietly rewrite the contact's history.
 *
 * It exists at all because the column used to be written on the CREATE branch
 * only: someone whose contact row predates their first stamped session (or
 * who first arrived organically, before /go landings earned a cookie) stayed
 * null forever, since every later submission takes the update or merge branch.
 * On production that was 0 of 170 contacts linked to a session
 * (audit 2026-09-13 §3.5).
 *
 * `existingSessionId` is "the session this person already had before this
 * request", which on the merge path means EITHER of the two rows being merged
 * — see the caller.
 */
function firstTouchSessionPatch(
  existingSessionId: string | null | undefined,
  attributionSessionId: string | null | undefined,
): Record<string, unknown> {
  if (existingSessionId != null) return {}
  if (!attributionSessionId) return {}
  return { first_touch_session_id: attributionSessionId }
}

/**
 * The contact's display name (G20). Unlike the three patches around it this is
 * NOT the default — `name` is the one identity column here that has always
 * been written unconditionally, so every caller that does not ask for
 * `fillOnly` keeps overwrite semantics exactly as before.
 *
 * WHY IT IS OPT-IN RATHER THAN THE NEW DEFAULT. Every pre-existing caller
 * (contact form, inquiry, newsletter, shop, the two event routes, the Stripe
 * webhook) receives a name the person typed on THAT form, moments earlier —
 * the freshest evidence of what they call themselves, and worth preferring
 * over an older value. The questionnaire is the first caller for which that is
 * not true: it is session-gated, so the only name it has is the ACCOUNT's, and
 * an account name is not fresher than a name the same person typed on a camp
 * enquiry last week. Making fill-only global would quietly freeze the first
 * name six entry points ever recorded.
 *
 * A blank-but-not-null name ("" or "   ") counts as no name, and it has to
 * count that way in BOTH directions. `contacts.name` is plain nullable text
 * with no CHECK, so an empty string is what a form field submitted empty
 * actually stores:
 *   - as the EXISTING value, treating it as "already named" would make the
 *     column permanently unfillable for that person;
 *   - as the SUBMITTED value, writing it would blank a column three admin
 *     screens render with a `?? fallback` — and this is reachable, not
 *     theoretical: `registerSchema` is `z.string().min(1)` with no `.trim()`
 *     and lib/auth.ts composes the session name from those fields, so "   "
 *     is a name the questionnaire route can genuinely hand over.
 * Fill-only writing the very thing it defines as "no name" would be the
 * function contradicting its own contract.
 *
 * Both blank rules live INSIDE the `fillOnly` branch on purpose. On the
 * default path this function must be byte-for-byte what the six pre-existing
 * callers already did (`name: input.name ?? undefined`), blank submissions
 * included — tightening that here would change what the contact form,
 * inquiry, newsletter, shop, event and Stripe callers write, which is a
 * separate decision from this gap.
 */
function namePatch(
  existingName: string | null | undefined,
  submitted: string | null | undefined,
  fillOnly: boolean,
): Record<string, unknown> {
  if (submitted == null) return {}
  if (fillOnly) {
    if (submitted.trim() === "") return {}
    if (existingName != null && existingName.trim() !== "") return {}
  }
  return { name: submitted }
}

/**
 * The person's own timezone (G06), fill-only and validated — same shape as
 * `firstTouchSessionPatch` above, for the same reason.
 *
 * Fill-only because a timezone describes where someone LIVES, and the value
 * arrives from whatever device they happened to fill a form on: a client in
 * Auckland filling a second form from an airport in Dubai must not be moved to
 * Dubai for quiet-hours purposes. First answer wins; a real correction is a
 * deliberate act, not a side effect of a form.
 *
 * Validated here rather than at the reader — see `isUsableTimezone`. A zone
 * `Intl` cannot parse throws inside the tick, which fails the run and costs the
 * send; storing null instead merely falls back to the business timezone, which
 * is exactly what every contact does today.
 */
function timezonePatch(
  existingTimezone: string | null | undefined,
  submitted: string | null | undefined,
): Record<string, unknown> {
  if (existingTimezone != null) return {}
  if (!submitted) return {}
  if (!isUsableTimezone(submitted)) {
    // Truncated: this value arrives on unauthenticated public endpoints and
    // the field is deliberately uncapped, so the log drain is the one place
    // an oversized string could still land in full.
    console.warn(`[contacts] ignoring unusable timezone from a form: ${JSON.stringify(submitted).slice(0, 80)}`)
    return {}
  }
  return { timezone: submitted }
}

export type IdentifierConflict = { field: "email" | "phone"; submitted: string; existing: string }

// A public form must never let a submitted identifier silently overwrite a
// different one already on file — that is how a double-submit or a shared
// device rewrites a stranger's email. An identifier is only ever WRITTEN when
// the contact's current value for it is null (a fill). A submission carrying
// a different non-null value is reported as a conflict instead, so the caller
// can record it rather than discard it.
function buildIdentifierPatch(
  existing: { email: string | null; phone_e164: string | null } | null,
  email: string | null,
  phone: string | null,
): { patch: Record<string, unknown>; conflicts: IdentifierConflict[] } {
  const patch: Record<string, unknown> = {}
  const conflicts: IdentifierConflict[] = []

  if (email) {
    if (!existing?.email) {
      patch.email = email
    } else if (existing.email !== email) {
      conflicts.push({ field: "email", submitted: email, existing: existing.email })
    }
  }

  if (phone) {
    if (!existing?.phone_e164) {
      patch.phone_e164 = phone
    } else if (existing.phone_e164 !== phone) {
      conflicts.push({ field: "phone", submitted: phone, existing: existing.phone_e164 })
    }
  }

  return { patch, conflicts }
}

export type UpsertContactIdentityInput = {
  email?: string | null
  phone?: string | null
  name?: string | null
  attributionSessionId?: string | null
  /**
   * The account behind this submission, when the caller KNOWS it — a
   * session user, or the buyer id this app stamped into Stripe metadata.
   * Verified against `users` before it is written (`resolveLinkableUserId`);
   * when absent, the account is looked up by email instead. Either way the
   * link is fill-only.
   */
  userId?: string | null
  /**
   * The IANA zone the submitter's own device reported
   * (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Fill-only and
   * validated — see `timezonePatch`. Reader: `resolveTimezone`
   * (lib/lead-engine/guardrails.ts), via `loadRunContext`, which is what puts
   * quiet hours in this person's morning rather than the coach's.
   */
  timezone?: string | null
  /**
   * G20. Treat `name` the way `userId`/`timezone` are already treated — fill a
   * contact that has none, never replace one that has. OPT-IN and false by
   * default, so every caller written before this flag existed keeps the
   * overwrite behaviour it was built on; see `namePatch` for why that default
   * is the correct one rather than the timid one.
   */
  nameFillOnly?: boolean
  businessId: string
}

export type UpsertContactIdentityResult = {
  contactId: string
  created: boolean
  merged: boolean
  identifierConflicts: IdentifierConflict[]
}

/**
 * The identity/merge/upsert core every entry point ultimately needs:
 * normalise, find who this might already be (`findMatchCandidates`), decide
 * create/update/merge (`decideMerge`), and write the winning contact row.
 * Extracted out of `recordContactEvent` so a second, non-enrolling caller —
 * the GHL import (`lib/lead-engine/import.ts`, `importGhlContact`) — can
 * reuse the exact same matching and conflict rules without pulling in
 * anything that makes `recordContactEvent` a *contact event*: this function
 * writes no timeline row (the caller decides what happened and how to
 * describe it — "entry_point" for a live submission, "ghl_import" for an
 * import) and never calls `enrollIfTriggered`. `recordContactEvent` below is
 * now a thin wrapper around this plus its own timeline writes and the
 * enrolment attempt — behavior identical to before the extraction, which the
 * existing `recordContactEvent` suites prove by staying green unmodified.
 */
export async function upsertContactIdentity(input: UpsertContactIdentityInput): Promise<UpsertContactIdentityResult> {
  const businessId = input.businessId
  const email = normaliseEmail(input.email)
  const phone = normalisePhone(input.phone)

  if (!email && !phone) {
    throw new Error("upsertContactIdentity needs at least one usable identifier (email or phone)")
  }

  const supabase = getClient()

  const found = await findMatchCandidates(supabase, businessId, email, phone)
  const decision = decideMerge(found, email, phone)

  // G04: the account this person has, if any. Deferred behind a closure so
  // the update and merge branches only pay for the lookup when the row they
  // are about to write is not linked already (`userIdPatch`). `linkEmail` is
  // the email that will be ON the row — the submitted one on create, and on
  // update/merge the row's own when it has one (a submitted email that
  // differs is a recorded conflict, not this person's address; see
  // resolveLinkableUserId). The merge RPC never moves an email, so the
  // survivor's pre-merge value is still its value afterwards, and a null one
  // is filled from the submission by buildIdentifierPatch.
  const resolveLink = (linkEmail: string | null) =>
    resolveLinkableUserId(supabase, { userId: input.userId, email: linkEmail })

  let contactId: string
  let created = false
  let merged = false
  let identifierConflicts: IdentifierConflict[] = []

  if (decision.kind === "create") {
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        business_id: businessId,
        email,
        phone_e164: phone,
        name: input.name ?? null,
        first_touch_session_id: input.attributionSessionId ?? null,
        user_id: await resolveLink(email),
        // Fill-only is trivially true on a create; the VALIDATION is not.
        // `timezonePatch` returns {} for a zone Intl cannot parse, so `?? null`
        // is what keeps junk out of the column on this branch too.
        timezone: (timezonePatch(null, input.timezone).timezone as string | undefined) ?? null,
      })
      .select()
      .single()
    if (error) throw error
    contactId = data.id
    created = true
  } else if (decision.kind === "update") {
    contactId = decision.contactId
    const existing = found.find((c) => c.id === contactId) ?? null
    const built = buildIdentifierPatch(existing, email, phone)
    identifierConflicts = built.conflicts
    await updateContact(supabase, contactId, {
      ...built.patch,
      ...firstTouchSessionPatch(existing?.first_touch_session_id, input.attributionSessionId),
      ...timezonePatch(existing?.timezone, input.timezone),
      ...(await userIdPatch(existing?.user_id, () => resolveLink(existing?.email ?? email))),
      ...namePatch(existing?.name, input.name, input.nameFillOnly === true),
      updated_at: new Date().toISOString(),
    })
  } else {
    contactId = decision.survivorId
    merged = true
    // Pre-merge candidates already include the survivor's current identifier
    // values; the merge itself never touches them, so this lookup stays valid.
    const existing = found.find((c) => c.id === contactId) ?? null
    const mergedCandidate = found.find((c) => c.id === decision.mergedId) ?? null
    await mergeContacts(decision.survivorId, decision.mergedId, businessId)
    const built = buildIdentifierPatch(existing, email, phone)
    identifierConflicts = built.conflicts
    await updateContact(supabase, contactId, {
      ...built.patch,
      // Same first-touch rule as the update branch, but read against BOTH
      // pre-merge rows. `merge_contacts` (migration 00238) does write this
      // column: when the loser has a session the survivor lacks, it moves the
      // loser's over, because first touch must be the EARLIER of the two. So
      // the survivor's own pre-merge null does not mean "this person has no
      // session" — it may mean the RPC just filled it, moments ago, with a
      // truer one than the session in front of us. Backfill only when neither
      // row had one.
      ...firstTouchSessionPatch(
        existing?.first_touch_session_id ?? mergedCandidate?.first_touch_session_id,
        input.attributionSessionId,
      ),
      // Timezone across a merge needs the OPPOSITE shape to the two rules
      // around it, because `merge_contacts` behaves differently again. It
      // moves `user_id` (00217:109-110) and `first_touch_session_id`, so for
      // those a survivor's own null may mean "the RPC just filled it" — hence
      // their both-rows reads. It does NOT touch `timezone` at all (verified:
      // the string does not appear in 00217 or 00238), so the survivor's own
      // pre-merge value is still its value here, exactly like `email`.
      //
      // The loser's value is therefore about to be destroyed with the row. It
      // is the same kind of evidence as the submission — a zone a real device
      // reported on a real form — so it is worth keeping when the survivor has
      // none and this submission brought nothing. Survivor's own value still
      // wins outright; fill-only is unchanged.
      // `isUsableTimezone` rather than `??` on the submission: a junk value is
      // not null, so `??` would stop at it, `timezonePatch` would then reject
      // it, and the loser's perfectly good zone would be destroyed with the row
      // for nothing.
      ...timezonePatch(
        existing?.timezone,
        isUsableTimezone(input.timezone ?? "") ? input.timezone : mergedCandidate?.timezone,
      ),
      // Same both-rows rule for the account link — `merge_contacts` carries
      // the loser's user_id over too (00217), so either pre-merge link means
      // the survivor is spoken for.
      ...(await userIdPatch(existing?.user_id ?? mergedCandidate?.user_id, () =>
        resolveLink(existing?.email ?? email),
      )),
      // G20. Read against the SURVIVOR'S OWN name only, unlike the three
      // patches above. Those read both pre-merge rows because `merge_contacts`
      // moves their columns, so a survivor's null may mean "the RPC just
      // filled it". It does not touch `name` (same as `timezone`), so the
      // survivor's own value is still its value here.
      //
      // And unlike `timezone`, the loser's name is NOT rescued before the row
      // is destroyed. That would be a new behaviour for every caller, not just
      // the opt-in one — nothing rescues a name today — and it is not what
      // this gap claims. Worth doing; worth doing deliberately.
      ...namePatch(existing?.name, input.name, input.nameFillOnly === true),
      updated_at: new Date().toISOString(),
    })
  }

  return { contactId, created, merged, identifierConflicts }
}

/**
 * Fills `contacts.user_id` on every UNLINKED contact carrying this email and
 * returns how many it filled. The register route's half of G04: a person who
 * came in as a lead — through a form, a quiz, a purchase — and then made an
 * account, or whose `status: "lead"` placeholder row just became one.
 *
 * DELIBERATELY UNSCOPED, for the same reason `findContactWithBusinessByIdentifiers`
 * is: the register route has no tenant, because a `users` row is
 * platform-wide (one login serves every business). The predicate is the
 * person's own email plus "not yet linked", and `contacts_business_email_uniq`
 * holds at most one contact per email per business — so this touches one
 * row per business that knows this person, every one of which IS this
 * person. Fill-only: a contact already linked to a different account is left
 * alone, never re-pointed.
 *
 * Throws on a write error. The caller (the register route) decides that an
 * account link must never fail a registration and logs it.
 */
export async function linkContactsToUser(args: { email: string | null | undefined; userId: string }): Promise<number> {
  const email = normaliseEmail(args.email)
  if (!email) return 0
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contacts")
    .update({ user_id: args.userId })
    .eq("email", email)
    .is("user_id", null)
    .select("id")
  if (error) throw error
  return (data ?? []).length
}

/**
 * Fill a contact's timezone from a source that is not a form (G06).
 *
 * The one caller today is the booking ingest: Calendly reports the invitee's
 * own timezone, and that is a better signal than anything a form gives us —
 * the person picked a slot in it. A booking is also the one entry point that
 * reaches people who never filled a lead form at all.
 *
 * FILL-ONLY, and enforced in the WHERE rather than by reading first: the
 * `.is("timezone", null)` predicate makes the update a no-op against a row
 * that already has one, atomically. The read-then-write shape used elsewhere
 * in this file is fine inside `upsertContactIdentity`, which is already
 * holding the row it just matched; here there is no such read, and adding one
 * would open a window where two bookings could both see null.
 *
 * Returns whether a row was actually filled, so the caller can log honestly
 * rather than assume. THROWS on a write error, deliberately: the decision that
 * a timezone must never cost a booking belongs to the caller, which is why the
 * booking ingest wraps this in its own try, after the sequence exit and the
 * pipeline card. Do not remove that catch on the strength of this returning a
 * boolean.
 */
export async function backfillContactTimezone(
  contactId: string,
  timezone: string | null | undefined,
  businessId: string,
): Promise<boolean> {
  if (!timezone || !isUsableTimezone(timezone)) return false

  const supabase = getClient()
  const { data, error } = await supabase
    .from("contacts")
    .update({ timezone, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("business_id", businessId)
    .is("timezone", null)
    .select("id")
  if (error) throw error
  return ((data ?? []) as { id: string }[]).length > 0
}

export async function recordContactEvent(
  input: RecordContactEventInput,
): Promise<{ contactId: string; created: boolean; merged: boolean }> {
  const businessId = input.businessId

  const { contactId, created, merged, identifierConflicts } = await upsertContactIdentity({
    email: input.email,
    phone: input.phone,
    name: input.name,
    attributionSessionId: input.attributionSessionId,
    userId: input.userId,
    timezone: input.timezone,
    nameFillOnly: input.nameFillOnly,
    businessId,
  })

  const supabase = getClient()

  // A timeline row is history, not the record of who this person is. The
  // contact write above already succeeded (or this function would already
  // have thrown), so a failure here must not fail an entry point that has
  // already captured the lead. Log it with enough context to find and
  // backfill, and return normally.
  const { error: timelineError } = await supabase.from("contact_timeline_events").insert({
    business_id: businessId,
    contact_id: contactId,
    kind: "entry_point",
    source: input.source,
    metadata: input.metadata ?? {},
  })
  if (timelineError) {
    console.error(
      `recordContactEvent: failed to append timeline event for contact ${contactId} (source: ${input.source})`,
      timelineError,
    )
  }

  // A conflicting identifier is never silently discarded: it did not
  // overwrite the record, so it is recorded on the timeline instead, one row
  // per conflicting field.
  for (const conflict of identifierConflicts) {
    const { error: conflictError } = await supabase.from("contact_timeline_events").insert({
      business_id: businessId,
      contact_id: contactId,
      kind: "identifier_conflict",
      source: input.source,
      metadata: { field: conflict.field, submitted: conflict.submitted, existing: conflict.existing },
    })
    if (conflictError) {
      console.error(
        `recordContactEvent: failed to append identifier_conflict event for contact ${contactId} (field: ${conflict.field})`,
        conflictError,
      )
    }
  }

  // Enrolment is marketing; the contact record is the thing that matters.
  // Losing an enrolment is recoverable, losing the lead is not — the same
  // contract lib/funnels/capture-contact.ts documents. Never log the raw
  // thrown value: a unique-index violation on contacts embeds the literal
  // email address in `details`; `code` and `message` are safe.
  try {
    await enrollIfTriggered({
      contactId,
      source: input.source,
      metadata: input.metadata,
      businessId,
      // G11. Typed and separate from `metadata` on purpose — see
      // `enrollIfTriggered`'s own note. `metadata` is attacker-influenced on
      // the funnel path; this decides when mail is sent.
      anchorAt: input.anchorAt,
    })
  } catch (err) {
    const pgErr = err as { code?: unknown; message?: unknown } | null | undefined
    console.error(`recordContactEvent: enrolment failed for contact ${contactId} (source: ${input.source})`, {
      code: typeof pgErr?.code === "string" ? pgErr.code : undefined,
      message: typeof pgErr?.message === "string" ? pgErr.message : undefined,
    })
  }

  return { contactId, created, merged }
}

/**
 * Appends one timeline event onto a contact that ALREADY EXISTS. Never
 * creates, merges or otherwise touches identity — the opposite contract to
 * `recordContactEvent` above, which upserts identity unconditionally.
 *
 * Exists for gap #14's ruling on `assessment` (see the design doc, §2.3):
 * the only assessment surface 401s without a session, so everyone who
 * submits is already a registered client, not a lead. Minting a contact row
 * for them the way `recordContactEvent` would is a product decision this
 * task does not make — the caller is expected to have already resolved a
 * contact id (e.g. via `findContactByIdentifiers`) and to call this ONLY
 * when one came back, doing nothing at all otherwise.
 *
 * A timeline write failure is logged, never thrown — same discipline as the
 * timeline insert inside `recordContactEvent`: the caller's own action
 * (an assessment submission) has already succeeded and must not be failed
 * to fix a history row.
 */
export async function recordEventForExistingContact(input: {
  contactId: string
  businessId: string
  source: ContactEventSource
  metadata?: Record<string, unknown>
}): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("contact_timeline_events").insert({
    business_id: input.businessId,
    contact_id: input.contactId,
    kind: "entry_point",
    source: input.source,
    metadata: input.metadata ?? {},
  })
  if (error) {
    console.error(
      `recordEventForExistingContact: failed to append timeline event for contact ${input.contactId} (source: ${input.source})`,
      error,
    )
  }
}

// Runs in a single transaction inside the `merge_contacts` plpgsql function
// (supabase/migrations/00217_lead_engine_sequence_functions.sql) — Supabase
// REST cannot span statements, so this used to be several independent
// round-trips with a real crash window between the audit insert and the
// loser's delete. That window is closed: re-pointing every child, the
// user_id carry-over, the idempotent audit insert, and the final delete all
// commit or roll back together now.
//
// The list of child tables the function re-points before deleting the loser
// — currently five: contact_timeline_events, contact_consents,
// sequence_messages, sequence_runs, and contact_merges.survivor_id — lives
// in that migration file, not here. It must be updated there whenever a new
// table gains a foreign key onto contacts(id), or that table's rows for the
// loser are destroyed by cascade instead of being carried to the survivor.
// This is not hypothetical: Stage 1a's merge missed contact_consents and
// destroyed consent evidence, and this function's own first draft missed a
// fifth child, contact_merges.survivor_id.
export async function mergeContacts(survivorId: string, mergedId: string, businessId: string) {
  const supabase = getClient()
  const { error } = await supabase.rpc("merge_contacts", {
    p_survivor: survivorId,
    p_merged: mergedId,
    p_business: businessId,
    p_reason: "email and phone resolved to different contacts",
  })
  if (error) throw error
}

/**
 * The user_id a contact is linked to, or null when it has none — true for
 * most leads, since a contact only gains one once the same person registers
 * or is otherwise matched to an account.
 *
 * SCOPED BY businessId, same as every other contact read here. This exists
 * so a booking/payment consequence that already resolved a contact id (via
 * findContactByIdentifiers, itself business-scoped) can go on to look up
 * marketing attribution keyed on user_id — see
 * findAttributionForContact's own docstring for why user_id, not email, is
 * the safe key once two businesses can share a lead.
 */
export async function getContactUserId(contactId: string, businessId: string): Promise<string | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contacts")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("id", contactId)
    .maybeSingle()
  if (error) throw error
  return (data as { user_id: string | null } | null)?.user_id ?? null
}

/**
 * Resolves a contact id from whichever identifiers a caller has on hand —
 * used by the marketing-exit hooks (payment, booking) to find who to stop
 * emailing. Resolution order: userId, then email (normalised), then phone
 * (normalised) — each is only consulted if the previous one was given but
 * matched nothing. Returns null when nothing matches; that is a legitimate
 * answer (this person has no contact record yet), not an error.
 *
 * Email and phone are normalised through the same functions writes use
 * (normaliseEmail / normalisePhone) before querying: the `contacts` unique
 * index is on `lower(email)` while lookups use a plain `.eq("email", …)`,
 * and they only agree because the value handed to `.eq()` was already
 * normalised. Skipping normalisation here would silently fail to find
 * people whose raw casing/formatting differs from what was stored.
 */
export async function findContactByIdentifiers(args: {
  email?: string | null
  phone?: string | null
  userId?: string | null
  businessId: string
}): Promise<string | null> {
  const supabase = getClient()
  const businessId = args.businessId

  if (args.userId) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("user_id", args.userId)
      .maybeSingle()
    if (error) throw error
    if (data) return (data as { id: string }).id
  }

  const email = normaliseEmail(args.email)
  if (email) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("email", email)
      .maybeSingle()
    if (error) throw error
    if (data) return (data as { id: string }).id
  }

  const phone = normalisePhone(args.phone)
  if (phone) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("phone_e164", phone)
      .maybeSingle()
    if (error) throw error
    if (data) return (data as { id: string }).id
  }

  return null
}

/**
 * DELIBERATELY UNSCOPED -- the only contact lookup in this repo with no
 * business predicate, and it must stay that way. Its caller is a vendor
 * webhook (one Stripe account serves every business) which has NO tenant in
 * scope; the contact row it finds is what SUPPLIES the tenant to every
 * consequence downstream. Do not "fix" this by adding a businessId: a
 * businessId here would have to be a guess, and the guess is the leak.
 *
 * KNOWN AMBIGUITY, stated rather than hidden: two businesses can each hold a
 * contact with the same email -- a shared lead. Resolution is the OLDEST row
 * (the first business to know this person) plus a warning, which is
 * deterministic but not RIGHT. The right fix is stamping business_id into the
 * Stripe checkout session metadata at creation and preferring it when
 * present; that touches every checkout creation site and is phase 4.
 */
export async function findContactWithBusinessByIdentifiers(args: {
  email?: string | null
  userId?: string | null
}): Promise<{ id: string; businessId: string } | null> {
  const supabase = getClient()

  const pick = async (column: "user_id" | "email", value: string) => {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, business_id, created_at")
      .eq(column, value)
      .order("created_at", { ascending: true })
    if (error) throw error
    const rows = (data ?? []) as { id: string; business_id: string }[]
    if (rows.length === 0) return null
    if (rows.length > 1) {
      console.warn(
        `[contacts] ${rows.length} contacts across businesses match ${column}; taking the oldest (${rows[0].business_id}). ` +
          `Stamp business_id into the checkout session to remove this ambiguity.`,
      )
    }
    return { id: rows[0].id, businessId: rows[0].business_id }
  }

  if (args.userId) {
    const hit = await pick("user_id", args.userId)
    if (hit) return hit
  }
  const email = normaliseEmail(args.email)
  if (email) {
    const hit = await pick("email", email)
    if (hit) return hit
  }
  return null
}

/**
 * True when this contact already has a timeline event in `PURCHASE_SOURCES`
 * (above -- `purchase`, `funnel_checkout` or `shop`) at or after `since`.
 *
 * Exists for the Stripe webhook's `checkout.session.expired` case — see that
 * call site's comment for the ordering problem this closes: a customer who
 * pays on a SECOND checkout attempt already has a qualifying row (written by
 * `tryCaptureLeadFromCheckout` on the `checkout.session.completed` case,
 * above in this file's sibling `recordContactEvent` path) by the time the
 * FIRST, abandoned session's `expired` event arrives, often ~24h later.
 * Comparing against `since` (the expired session's own `created` timestamp)
 * rather than "ever purchased" is deliberate: an older, unrelated purchase
 * must not suppress a genuinely new abandonment.
 *
 * MUST filter on `PURCHASE_SOURCES`, never a bare `.eq("source", "purchase")`
 * — gap #14 narrowed `purchase` to exclude `shop_order` and `funnel_purchase`
 * checkouts (they now write `shop` / `funnel_checkout`), and an `.eq()` here
 * stopped seeing those as a purchase at all, silently re-enrolling a paying
 * funnel customer in the abandoned-checkout sequence. See `PURCHASE_SOURCES`'
 * own comment above for the incident this fixes.
 *
 * SCOPED BY businessId, same as every other reader here.
 */
export async function hasPurchaseSince(contactId: string, businessId: string, since: Date): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_timeline_events")
    .select("id")
    .eq("business_id", businessId)
    .eq("contact_id", contactId)
    .in("source", PURCHASE_SOURCES)
    .gte("occurred_at", since.toISOString())
    .limit(1)
  if (error) throw error
  return (data ?? []).length > 0
}

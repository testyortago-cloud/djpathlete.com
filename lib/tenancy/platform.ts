import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { createServiceRoleClient } from "@/lib/supabase"

/**
 * The platform's OWN business -- the tenant that owns darrenjpaul.com.
 *
 * This is a SEAM, not a resolution, and the distinction is the point. Several
 * different reasons land a call site here, and they are NOT the same claim --
 * conflating them is exactly the kind of stale invariant this file has
 * already been bitten by twice, so each is named explicitly rather than
 * folded into one list.
 *
 * GENUINELY CANNOT RESOLVE A TENANT YET -- the caller has no session, no
 * connection row, and no column to key off:
 *   - the pipeline reconciler's payments half
 *     (lib/automation/pipeline-reconcile.ts) -- not because the reconciler
 *     itself lacks a businessId (it iterates real businesses in a loop and
 *     knows exactly which one it is on), but because `payments` has no
 *     `business_id` column at all. No business other than the platform's own
 *     can ever legitimately claim a payment today, so this is
 *     correct-by-construction rather than a caller unable to resolve.
 *   - the Host boundary's own fallback (lib/tenancy/public.ts). Since phase 4
 *     every public surface resolves through `resolvePublicTenant()`, which
 *     reads `business_domains` by the request's Host and reaches this only
 *     when no row claims the host, when the table is not there yet (the
 *     deploy window), or when the read failed. Its callers are inventoried in
 *     that file, not here.
 *   - the public lead-capture surfaces, converted 2026-09-05 when the Lead
 *     Engine DAL stopped defaulting its tenant. Each resolves this ONCE at
 *     the top of its handler and threads it into every write — the contact,
 *     the settings read behind the consent wording, and the consent row —
 *     so the wording shown and the wording filed can never name different
 *     businesses. No session, and no row to inherit from: `funnels`,
 *     `funnel_steps`, `funnel_submissions`, `events`, `event_signups`,
 *     `shop_products` and `shop_leads` carry no business_id (no migration adds
 *     one), so until phase 4 reads the Host header these are the platform's
 *     by seam, not by evidence:
 *     and the pages and server components that render the same consent
 *     wording those routes file, which must read the SAME business:
 *       app/(marketing)/camps/[slug]/page.tsx
 *       app/(marketing)/clinics/[slug]/page.tsx
 *       components/public/InquiryForm.tsx
 *       components/public/StepUpInquiryForm.tsx
 *       components/funnels/islands/FormIsland.tsx
 *     Phase 4 converted the quiz progress route and the quiz island together
 *     (both now resolve the Host); app/api/quiz/submit/route.ts is still NOT
 *     on this list, deliberately: it inherits the attempt's business_id
 *     rather than resolving anything.
 *
 * CORRECT BY CONSTRUCTION -- the caller could be asked to resolve a tenant
 * and the answer would still be the platform's own. Not a placeholder
 * awaiting a later phase:
 *   - the GHL booking webhook's BUSINESS
 *     (app/api/webhooks/ghl-booking/route.ts). Listed above as "cannot
 *     resolve yet" until phase 2; that was the wrong shelf. Nothing later
 *     will give this route a per-coach tenant to find.
 *   - the GHL booking webhook's HOST (app/api/webhooks/ghl-booking/route.ts),
 *     via platformHostId() below. Not a caller that cannot resolve: the GHL
 *     calendar is the one Calendly REPLACES, it will never be per-coach, and
 *     so the platform's own host is the right answer rather than a placeholder
 *     awaiting a later phase. In phase 2 the Calendly webhook ROUTE stopped
 *     calling it directly — a connection row now carries the host — but its
 *     resolver still does, on the ramp described below. This is not the only
 *     remaining caller.
 *   - the invite claim's plain-team-invite branch
 *     (app/api/public/invite/[token]/claim/route.ts). An invite with no
 *     business_id is a /admin/team invite, which is by definition onto the
 *     platform's own business; the membership row it writes says so.
 *
 * A NARROWER VARIANT OF THE SAME SEAM -- the caller DOES attempt a real
 * resolution first, and only reaches this as the fallback when that lookup
 * comes back empty:
 *   - the Twilio inbound SMS webhook (app/api/webhooks/twilio/inbound/route.ts)
 *     resolves the tenant from the `To` number via `getBusinessBySmsNumber`
 *     first -- the only tenant evidence an inbound SMS carries -- and falls
 *     back to this only when no business claims that number. That fallback is
 *     the ORDINARY case today, since `sms_sender_phone` defaults to `''` and
 *     the platform's own number still lives in the environment, not in a
 *     per-coach row.
 *   - the Calendly webhook's tenant resolver (lib/bookings/calendly-tenant.ts)
 *     matches the delivery's event type against `coach_calendar_connections`
 *     first, and reaches this pair only for the single event type named by
 *     CALENDLY_EVENT_TYPE_URI. That is a deploy ramp, not a default: migrations
 *     reach production on push to main while Vercel is still building, so
 *     without it every real booking would be dropped in the window between the
 *     deploy and the owner clicking Connect. Its use is console.warn'd, and an
 *     event type matching NEITHER is ignored rather than filed here.
 *   - the Stripe webhook's purchase capture (app/api/stripe/webhook/route.ts).
 *     One Stripe account serves every business, so the webhook has no
 *     tenant of its own. It resolves the payer's contact row first — the
 *     same lookup its pipeline half already makes — and a repeat buyer's
 *     capture lands on that contact row's business (the OLDEST row when a
 *     lead is shared — see `findContactWithBusinessByIdentifiers` in
 *     lib/db/contacts.ts). A FIRST-TIME payer, who has no contact row
 *     anywhere, falls to this — and so does a payer whose lookup FAILED,
 *     because the capture must not be lost and pre-branch it always filed
 *     here. The route declares `payerBusinessId` outside its own try block
 *     for exactly that reason, and the throw path is pinned by
 *     __tests__/api/stripe/webhook-capture-tenant.test.ts ("a contact lookup
 *     that THROWS still leaves the capture with the platform tenant").
 *
 * DELIBERATELY FROZEN PENDING A LATER PHASE -- the caller COULD resolve a
 * real tenant (it has an authenticated admin session), but converting it
 * would mean re-scoping a large, unrelated subsystem as a side effect of a
 * smaller task:
 *   - `loadCatalogues()` (lib/funnels/sections/resolve.ts), the AI funnel
 *     builder's catalogue loader. Its call graph spans the build/publish/plan
 *     routes, the ~1900-line build orchestrator, the funnel editor page, and
 *     the shared draft-preview renderer -- none of which any task has claimed
 *     for tenancy conversion. Freezing it here keeps today's behaviour
 *     byte-identical (this returns the same constant that call site used to
 *     hard-code) while making the compromise greppable instead of silent.
 *   - the Google Ads OAuth callback (app/api/integrations/google-ads/callback/route.ts)
 *     and the rediscover-accounts route (app/api/admin/ads/rediscover-accounts/route.ts),
 *     the two callers of `upsertGoogleAdsAccount`. Both routes DO have an
 *     admin session, but `/admin/ads/settings` and everything under it --
 *     `listGoogleAdsAccounts`, the account-toggle and diagnose routes, and
 *     the Firebase nightly sync cron -- read every account with no business
 *     filter at all. Passing a real per-coach businessId into just the write
 *     path here would connect an account no other screen in that subsystem
 *     could tell apart from the platform's own; converting the whole ads
 *     admin surface to multi-tenant is not this task's claim.
 *
 *     Since 2026-09-04 that seam is at least no longer reachable by a
 *     teammate: `/admin/ads` and `/api/admin/ads` moved into
 *     OWNER_ONLY_PREFIXES and the `ads` PermissionDef was deleted, so the
 *     invite screen can no longer grant it. That is a narrowing of who can
 *     reach the unscoped reader, NOT a scoping of it — the reader is
 *     unchanged. See docs/superpowers/plans/2026-09-04-ads-owner-only.md,
 *     and scope the reader before making it grantable again.
 *
 *     The reader's own default is the same seam: `getActiveGoogleAdsAccounts`
 *     (lib/db/google-ads-accounts.ts) is the one tenant default left in
 *     lib/db, spelled as this function since 2026-09-05, and its five
 *     no-argument callers — lib/ads/agent.ts (twice), lib/ads/ga4-audiences.ts,
 *     lib/ads/conversions.ts, app/api/admin/ads/diagnose/route.ts — are
 *     untouched for the reason above. Scope the subsystem, then the default.
 *
 * TWINS THAT CANNOT CALL THIS: functions/src/lib/tenancy-constants.ts and
 * functions/src/ads/dal.ts carry the literal because `functions/` has
 * rootDir "src" and cannot import lib/. A grep for the constant finds them;
 * they are the Firebase runtime's copy of this seam, not inline literals in
 * the Next.js app. lib/tenancy/resolve.ts also names the constant, in a
 * history comment about the fallback migration 00246 removed — not a use.
 *
 * Each of those calls this instead of writing the constant inline, so a
 * later phase has ONE greppable place to change per reason, rather than
 * literals scattered across routes. Calling every one of them a "resolution"
 * would be a lie; naming each honestly, and naming WHICH kind, is the whole
 * value.
 */
export function platformBusinessId(): string {
  return SINGLETON_BUSINESS_ID
}

/**
 * The platform business's own booking host -- the host half of the seam
 * above, for the GHL webhook listed under CORRECT BY CONSTRUCTION and for the
 * Calendly resolver's ramp.
 *
 * This was `singletonHostId` in lib/db/bookings.ts until phase 2. The body is
 * unchanged, because two parts of it are load-bearing and both read like
 * tidy-up candidates.
 *
 * Returns null rather than throwing on a read failure — a throw here would
 * 500 the booking webhook for what might be a transient read, which is worse
 * than proceeding without a host. But since migration 00243, `bookings.host_id`
 * is NOT NULL: a null return now means the insert that follows WILL fail with
 * 23502 (not_null_violation), and the console.error below is the only
 * diagnostic that survives — without it, "the table doesn't exist" and "there
 * really is no host row yet" are indistinguishable from the 23502 alone.
 * PostgREST resolves a read failure rather than throwing (same as the
 * business_members fan-out read in lib/bookings/ingest.ts), so `error` is
 * checked explicitly here instead of relying on a try/catch that would never
 * fire.
 *
 * Note this is the OPPOSITE contract to
 * `findCoachCalendarConnectionByEventType`, and deliberately so. That read
 * decides WHOSE booking this is, so a failure there must never be mistaken
 * for "nobody's" and it throws. This one only decides which host row to stamp
 * on a booking already known to be the platform's.
 */
export async function platformHostId(): Promise<string | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("booking_hosts")
    .select("id")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error(`[booking-hosts] platformHostId read failed (${error.code} ${error.message})`)
    return null
  }
  return (data as { id: string } | null)?.id ?? null
}

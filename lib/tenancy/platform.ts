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
 *   - public, unauthenticated quiz-taking routes (e.g.
 *     app/api/quiz/progress/route.ts), until phase 4 resolves the Host
 *     header;
 *   - the public chat assistant (app/api/ask/route.ts), the one place a
 *     conversation's tenant is decided at all -- same story as the quiz
 *     route, no session and no Host resolution until phase 4. Once the
 *     conversation exists, every OTHER call in that route threads
 *     `conversation.business_id` instead of calling this again -- see the
 *     route's own comment above `createConversation`;
 *   - the pipeline reconciler's payments half
 *     (lib/automation/pipeline-reconcile.ts) -- not because the reconciler
 *     itself lacks a businessId (it iterates real businesses in a loop and
 *     knows exactly which one it is on), but because `payments` has no
 *     `business_id` column at all. No business other than the platform's own
 *     can ever legitimately claim a payment today, so this is
 *     correct-by-construction rather than a caller unable to resolve.
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
 *     awaiting a later phase. The Calendly webhook stopped calling it in
 *     phase 2, when a connection row began carrying the host.
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

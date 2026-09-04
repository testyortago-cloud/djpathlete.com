import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

/**
 * The platform's OWN business -- the tenant that owns darrenjpaul.com.
 *
 * This is a SEAM, not a resolution, and the distinction is the point. Two
 * different reasons land a call site here, and they are NOT the same claim --
 * conflating them is exactly the kind of stale invariant this file has
 * already been bitten by twice, so both are named explicitly rather than
 * folded into one list.
 *
 * GENUINELY CANNOT RESOLVE A TENANT YET -- the caller has no session, no
 * connection row, and no column to key off:
 *   - the Calendly webhook (app/api/webhooks/calendly/route.ts), until phase 2
 *     gives each coach a connection row whose event-type URI identifies the
 *     business;
 *   - the GHL booking webhook (app/api/webhooks/ghl-booking/route.ts), which
 *     is the calendar Calendly replaces and will never be per-coach;
 *   - public, unauthenticated quiz-taking routes (e.g.
 *     app/api/quiz/progress/route.ts), until phase 4 resolves the Host
 *     header;
 *   - the pipeline reconciler's payments half
 *     (lib/automation/pipeline-reconcile.ts) -- not because the reconciler
 *     itself lacks a businessId (it iterates real businesses in a loop and
 *     knows exactly which one it is on), but because `payments` has no
 *     `business_id` column at all. No business other than the platform's own
 *     can ever legitimately claim a payment today, so this is
 *     correct-by-construction rather than a caller unable to resolve.
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

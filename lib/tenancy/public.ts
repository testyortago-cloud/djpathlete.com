import { headers } from "next/headers"
import { findBusinessIdByHost, BusinessDomainReadError } from "@/lib/db/business-domains"
import { platformBusinessId } from "@/lib/tenancy/platform"
import { recordAudit } from "@/lib/audit/record"

/**
 * THE HOST BOUNDARY — the one place a public, unauthenticated request's tenant
 * is decided. lib/tenancy/resolve.ts is the session boundary and stays the
 * only one; this file never imports it, and it never imports this.
 *
 * `resolvePublicTenant()` takes no arguments and reads `await headers()`, so
 * one call works in a route handler and in a server component alike. It reads
 * `x-forwarded-host` first (the value a proxy in front of the app carries;
 * Vercel sets it from the real request) and `host` second, normalises
 * (lowercase, no port), and looks the host up in `business_domains`. A row
 * wins. Otherwise the platform's own business is served, through
 * `platformBusinessId()` — which is why lib/tenancy/platform.ts lists THIS
 * file, and only this file, as the public surfaces' remaining caller.
 *
 * Three ways to reach the platform, three different log lines (spec §6):
 *   - no row claims the host (every dev and preview host lands here): warn,
 *     ONCE per host per process. "Never silent" means the host is named, not
 *     that the log is flooded with one line per request.
 *   - the table is missing (PostgREST 42P01 / PGRST205): business_domains has
 *     been live since migration 00240, so in production this is an incident,
 *     not a deploy window — it is logged and audited exactly like any other
 *     failed read below. The branch exists so an environment behind 00240 (a
 *     fresh clone, a preview database) still serves the platform instead of
 *     500ing.
 *   - any other failed read: error EVERY time with code and message (never
 *     the raw object — it logs as [object Object]) — each one is an
 *     incident, not deduped. The audit row that files it under outcome
 *     "failure" so the 24h strip on /admin/audit-logs sees it is filed ONCE
 *     per host per process instead: during a sustained outage every public
 *     request would otherwise pay an extra awaited insert against the same
 *     degraded database, and one row per instance already lights the strip.
 *     A public page 500ing on a transient read is worse than serving the
 *     platform; that is the recorded decision, not a default.
 *
 * Both dedupe sets below (warned hosts, audited hosts) are capped at 1000
 * entries and cleared on overflow: the host is client-controlled, so an
 * unbounded Set keyed on it would be a memory-growth vector on a long-lived
 * (Fluid Compute) instance.
 *
 * `await headers()` is deliberately OUTSIDE the try. During a static
 * prerender Next throws from it to bail the route out to dynamic rendering;
 * swallowing that would prerender the page with the platform tenant and keep
 * it static forever. Pinned by __tests__/lib/tenancy/public.test.ts.
 *
 * Security: a client controls its own Host. The worst it can do is file its
 * OWN submission under a business whose host it names — which it could do
 * by sending the request to that host. An unknown host resolves to the
 * platform, never to "any"; no other tenant's rows become readable.
 *
 * CALLERS — every public surface that used to sit on platform.ts's CANNOT
 * RESOLVE YET shelf. __tests__/lib/tenancy/public-inventory.test.ts fails if
 * a caller is missing from this list or a listed file stops calling.
 *
 *   The §5.1 lead-capture routes, each resolving once at the top and
 *   threading into every write (contact, settings read, consent row):
 *     app/api/contact/route.ts
 *     app/api/shop/leads/route.ts
 *     app/api/newsletter/route.ts
 *     app/api/inquiry/route.ts
 *     app/api/events/[id]/signup/route.ts
 *     app/api/events/[id]/checkout/route.ts
 *     app/api/funnels/submit/route.ts
 *     app/api/ask/config/route.ts
 *   The two places a row's tenant is DECIDED, after which the row carries it:
 *     app/api/quiz/progress/route.ts   (createAttempt; quiz/submit inherits)
 *     app/api/ask/route.ts             (createConversation; the rest of that
 *                                       route threads conversation.business_id)
 *   The pages and server components that render the consent wording those
 *   routes file, which must read the SAME business the route resolves —
 *   under Host resolution both read the same header:
 *     app/(marketing)/ask/page.tsx
 *     app/(marketing)/camps/[slug]/page.tsx
 *     app/(marketing)/clinics/[slug]/page.tsx
 *     components/public/InquiryForm.tsx
 *     components/public/StepUpInquiryForm.tsx
 *     components/funnels/islands/FormIsland.tsx
 *     components/funnels/islands/QuizIsland.tsx
 */

/**
 * PostgREST codes meaning the table itself is missing: undefined_table
 * (42P01) and "not in the schema cache" (PGRST205). business_domains has
 * existed since migration 00240, so either code in production is an
 * incident, not a deploy window — this Set only picks the LOG WORDING in the
 * catch block below; the failure path itself (error every time, audit once
 * per host per process) is identical to any other failed read.
 */
const TABLE_MISSING = new Set(["42P01", "PGRST205"])

/**
 * Lowercase, no port, first value of a comma list, trimmed. Null for absent
 * or blank. Exported for its own tests; the DAL expects exactly this shape.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? ""
  if (first === "") return null
  // An IPv6 literal keeps its brackets and loses only the port: "[::1]:3050" -> "[::1]".
  const noPort = first.startsWith("[") ? first.replace(/^(\[[^\]]*\]).*$/, "$1") : first.replace(/:.*$/, "")
  // A browser sends a trailing dot when one is typed: "www.darrenjpaul.com." ->
  // "www.darrenjpaul.com". Applied AFTER the port is stripped, and only ONE
  // dot is removed — the column stores the host without it.
  const noTrailingDot = noPort.endsWith(".") ? noPort.slice(0, -1) : noPort
  return noTrailingDot === "" ? null : noTrailingDot
}

/** A dedupe set keyed on a client-controlled value must not grow forever. */
const DEDUPE_CAP = 1000

/**
 * True the first time `key` is seen; false on a repeat. Bounds `set` at
 * `DEDUPE_CAP` by clearing it outright rather than evicting one entry at a
 * time — a host may warn (or audit) twice per thousand distinct hosts, which
 * is an acceptable price for a Set that never grows past a fixed size.
 */
function once(set: Set<string>, key: string): boolean {
  if (set.size >= DEDUPE_CAP) set.clear()
  if (set.has(key)) return false
  set.add(key)
  return true
}

const warnedHosts = new Set<string>()
const auditedHosts = new Set<string>()

function warnOnce(host: string, message: string): void {
  if (once(warnedHosts, host)) console.warn(message)
}

/** The business this public request belongs to. Never throws for a tenancy reason. */
export async function resolvePublicTenant(): Promise<string> {
  const h = await headers()
  // `||`, not `??`: an EMPTY x-forwarded-host (present but "") must still
  // fall back to `host`, not resolve as "(none)".
  const host = normalizeHost(h.get("x-forwarded-host") || h.get("host"))

  if (host === null) {
    warnOnce("(none)", "[tenancy] request carried no Host header; serving the platform")
    return platformBusinessId()
  }

  try {
    const businessId = await findBusinessIdByHost(host)
    if (businessId !== null) return businessId
    warnOnce(host, `[tenancy] no business_domains row for host "${host}"; serving the platform`)
    return platformBusinessId()
  } catch (err) {
    const code = err instanceof BusinessDomainReadError ? err.code : "unknown"
    const message = err instanceof Error ? err.message : String(err)
    // ONE failure path — only the log message differs by classification.
    // TABLE_MISSING gets its own wording because business_domains has
    // existed since migration 00240: seeing 42P01/PGRST205 in production
    // means the table is gone or PostgREST's schema cache is stale, which is
    // an incident, not a deploy window. Every other code gets the generic
    // message. Neither is deduped — each failed read is its own incident in
    // the log — but the audit row below IS.
    console.error(
      TABLE_MISSING.has(code)
        ? `[tenancy] business_domains is MISSING (${code}) for host "${host}"; serving the platform — the table has existed since migration 00240, so this is an incident, not a deploy window`
        : `[tenancy] business_domains read failed for host "${host}" (${code} ${message}); serving the platform`,
    )
    // The audit row IS deduped, ONCE per host per process: unlike the error
    // line above, an awaited insert against the same degraded database on
    // every request during a sustained outage is its own cost, and one row
    // per instance already lights the 24h failure strip. recordAudit never
    // throws. `actor` is passed so it does not call auth() on a public
    // request.
    if (once(auditedHosts, host)) {
      await recordAudit({
        action: "tenancy.public_host_lookup_failed",
        category: "system",
        outcome: "failure",
        actor: { role: "system" },
        error: { code, message },
        metadata: { host },
      })
    }
    return platformBusinessId()
  }
}

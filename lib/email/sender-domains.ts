import { Resend } from "resend"

/**
 * Reads the Resend account's domain list and returns only the ones Resend has
 * actually verified. `sender_email`'s Zod rule (businessSettingsPatchSchema)
 * checks *format* only, so a syntactically valid address on an unverified
 * domain (e.g. the bare apex when only a subdomain is verified) passes Zod
 * and would otherwise reach Resend on every send, get silently dropped, and
 * repeat the 2026-08-31 incident (73 sequence sends lost because
 * `sender_email` pointed at `darrenjpaul.com`, not the verified
 * `send.darrenjpaul.com`).
 *
 * Fails closed: any reason this can't produce a real, current list (no key,
 * SDK error) is reported as its own `reason` rather than an empty domain
 * list, because "Resend has zero verified domains" and "we couldn't ask
 * Resend" must not collapse into the same caller-visible outcome — the
 * message the route shows for each is different, and only one of them is
 * actually "nothing is verified."
 *
 * Builds its OWN Resend client, per call, INSTEAD of importing the shared
 * `resend` singleton from `lib/resend.ts`. That module constructs its client
 * eagerly at import time (`export const resend = new Resend(process.env
 * .RESEND_API_KEY!)`), and the SDK's own constructor throws synchronously
 * when no key is available (node_modules/resend/dist/index.mjs: `if
 * (!this.key) throw new Error("Missing API key. ...")`). This module is
 * imported unconditionally at the top of the businesses route, so importing
 * the shared singleton here would mean merely LOADING that route -- to serve
 * any PATCH, including one that never touches sender_email -- throws before
 * the `key` guard below ever runs, whenever RESEND_API_KEY is unset. Only
 * importing the (side-effect-free) `Resend` class, and constructing after
 * the guard, means the guard actually guards.
 */
export async function listVerifiedSenderDomains(): Promise<
  { ok: true; domains: string[] } | { ok: false; reason: "no_api_key" | "api_error" }
> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false as const, reason: "no_api_key" as const }
  let listed: Awaited<ReturnType<Resend["domains"]["list"]>>
  try {
    listed = await new Resend(key).domains.list()
  } catch (err) {
    // Constructing the client or calling the SDK can both throw (as opposed
    // to resolving with an `error` field) -- a network failure inside the
    // SDK's fetch, for instance. Without this catch, that throw would
    // propagate as an uncaught exception (a raw 500) instead of the same
    // fail-closed 400 every other unreachable-Resend case gets.
    console.error("[sender-domains] Resend domains.list threw:", err)
    return { ok: false as const, reason: "api_error" as const }
  }
  const { data, error } = listed
  if (error || !data) return { ok: false as const, reason: "api_error" as const }
  return {
    ok: true as const,
    domains: data.data.filter((d) => d.status === "verified").map((d) => d.name.toLowerCase()),
  }
}

/**
 * Exact-domain match only. The 08-31 fault was apex-vs-subdomain
 * (`darrenjpaul.com` typed in where only `send.darrenjpaul.com` is
 * verified) -- a suffix/subdomain rule in either direction (accept an
 * apex because a subdomain of it is verified, or accept a subdomain
 * because its parent apex is verified) would have let that exact fault
 * through, since Resend verifies each domain independently and does not
 * extend verification to its parent or children.
 */
export function senderDomainVerdict(email: string, verified: string[]): { ok: true } | { ok: false; domain: string } {
  const domain = email.trim().toLowerCase().split("@")[1] ?? ""
  return verified.includes(domain) ? { ok: true as const } : { ok: false as const, domain }
}

/**
 * The verified domains that the TYPED domain should plausibly have been —
 * `send.darrenjpaul.com` for someone who typed `darrenjpaul.com`, and the
 * reverse. Nothing else.
 *
 * WHY NOT JUST LIST THE VERIFIED SET. Resend domains are ACCOUNT-wide, not
 * per-business: one Resend account backs every tenant on the platform. The
 * refusal used to render `verified.domains.join(", ")`, so any admin who
 * fat-fingered a sender address was shown every other coach's sending domain.
 * Under the white-label direction that is a disclosure, and it was never the
 * useful part of the message — the useful part is the one domain they meant.
 *
 * NOT A RELAXATION OF `senderDomainVerdict`. That stays an exact match, for
 * the reason given above it; this is presentation only, and runs only after
 * the verdict has already refused.
 *
 * Returns `[]` when nothing in the account relates to what was typed — a
 * genuinely unknown domain — and the caller says so in words rather than
 * naming a substitute it cannot justify.
 */
export function relatedVerifiedDomains(domain: string, verified: string[]): string[] {
  const typed = domain.trim().toLowerCase()
  if (!typed) return []
  return verified.filter((candidate) => candidate.endsWith(`.${typed}`) || typed.endsWith(`.${candidate}`))
}

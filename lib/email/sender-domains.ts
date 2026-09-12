import { resend } from "@/lib/resend"

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
 */
export async function listVerifiedSenderDomains(): Promise<
  { ok: true; domains: string[] } | { ok: false; reason: "no_api_key" | "api_error" }
> {
  if (!process.env.RESEND_API_KEY) return { ok: false as const, reason: "no_api_key" as const }
  const { data, error } = await resend.domains.list()
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

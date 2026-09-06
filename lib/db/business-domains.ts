import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

/**
 * A failed read of `business_domains`. Carries PostgREST's code so the Host
 * boundary (lib/tenancy/public.ts) can name a MISSING table (42P01 /
 * PGRST205) in its log line. That is not a deploy window: the table has been
 * live since migration 00240, so in production a missing table is an incident
 * and is audited like every other failed read. The message names the code and
 * the reason because a raw PostgREST error object logs as `[object Object]`.
 */
export class BusinessDomainReadError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(`business_domains read failed (${code}): ${message}`)
    this.name = "BusinessDomainReadError"
    this.code = code
  }
}

/**
 * The business that owns `host`, or null when no row claims it.
 *
 * `host` must already be normalised — lowercase, no scheme, no port, the way
 * the column is stored (see `normalizeHost` in lib/tenancy/public.ts). This
 * does not lowercase on the way in; an un-normalised value simply finds
 * nothing, which is the honest answer to a question asked in the wrong shape.
 *
 * THROWS on a failed read. null means "no row", never "could not look" —
 * conflating the two would make an outage indistinguishable from an unknown
 * host, and the caller would serve the platform for both without a trace.
 *
 * No `kind` filter: an `alias` row resolves exactly like a `primary` one. The
 * distinction is for the domain-management surface that does not exist yet.
 * `verified_at` is not filtered either: a row resolves the moment it exists.
 * The seed sets it because the platform's hosts are live; an onboarding
 * writer that inserts a row before verification must know the row goes live
 * immediately.
 */
export async function findBusinessIdByHost(host: string): Promise<string | null> {
  const { data, error } = await getClient()
    .from("business_domains")
    .select("business_id")
    .eq("host", host)
    .maybeSingle()
  if (error) throw new BusinessDomainReadError(error.code ?? "unknown", error.message ?? String(error))
  return (data as { business_id: string } | null)?.business_id ?? null
}

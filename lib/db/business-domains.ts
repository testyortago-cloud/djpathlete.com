import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

/**
 * A failed read of `business_domains`. Carries PostgREST's code so the Host
 * boundary (lib/tenancy/public.ts) can tell "the table is not there yet" —
 * the deploy window between the migration applying and the build finishing —
 * from every other failure. The message names the code and the reason
 * because a raw PostgREST error object logs as `[object Object]`.
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

import { cookies } from "next/headers"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { BUSINESS_COOKIE } from "@/lib/tenancy/cookie"

export type BusinessChoice = { id: string; name: string; slug: string }

export type ResolvedTenant = {
  /** The business whose rows this request may read and write. */
  businessId: string
  /** Every business this caller may switch to. One entry = no switcher. */
  choices: BusinessChoice[]
  /** True for the operator, an implicit owner of every business. */
  isOperator: boolean
}

type Row = { id: string; name: string; slug: string }

function getClient() {
  return createServiceRoleClient()
}

async function activeBusinessesByIds(ids: string[]): Promise<Row[]> {
  if (ids.length === 0) return []
  const { data, error } = await getClient()
    .from("businesses")
    .select("id, name, slug")
    .in("id", ids)
    .eq("status", "active")
    .order("name", { ascending: true })
  if (error) throw new Error(`resolveAdminTenant businesses read failed (${error.code}): ${error.message}`)
  return (data ?? []) as Row[]
}

async function allActiveBusinesses(): Promise<Row[]> {
  const { data, error } = await getClient()
    .from("businesses")
    .select("id, name, slug")
    .eq("status", "active")
    .order("name", { ascending: true })
  if (error) throw new Error(`resolveAdminTenant businesses read failed (${error.code}): ${error.message}`)
  return (data ?? []) as Row[]
}

async function membershipBusinessIds(userId: string): Promise<string[]> {
  const { data, error } = await getClient()
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
  // A FAILED READ IS NOT AN EMPTY LIST. PostgREST resolves rather than
  // throwing, and treating {data:null,error} as "no memberships" would send a
  // coach down the singleton compatibility path below -- silently widening
  // them to another tenant's rows.
  if (error) throw new Error(`resolveAdminTenant membership read failed (${error.code}): ${error.message}`)
  return ((data ?? []) as { business_id: string }[]).map((r) => r.business_id)
}

/**
 * The allowed set, computed server-side from the session. Shared by the page
 * resolver and the request resolver so the two can never disagree about which
 * businesses a caller may read -- if they did, one of them would be a leak.
 */
async function allowedSet(userId: string, role: string): Promise<{ choices: BusinessChoice[]; isOperator: boolean }> {
  if (role === "admin") {
    return { choices: await allActiveBusinesses(), isOperator: true }
  }
  const ids = await membershipBusinessIds(userId)
  if (ids.length === 0) {
    // COMPATIBILITY, not a default. Every staff user predating multi-coach has
    // no membership row and legitimately works on the singleton; denying them
    // would break every existing teammate the day this merges. A coach is
    // created WITH a membership row, so a coach never takes this path.
    return { choices: await activeBusinessesByIds([SINGLETON_BUSINESS_ID]), isOperator: false }
  }
  return { choices: await activeBusinessesByIds(ids), isOperator: false }
}

/**
 * Picks the selected business. The cookie only ever CHOOSES AMONG `choices`;
 * a value naming a business the caller may not see is ignored rather than
 * erroring, because a coach whose membership was just revoked should land on
 * something rather than a 500.
 */
function select(choices: BusinessChoice[], cookieValue: string | undefined): string {
  if (cookieValue && choices.some((c) => c.id === cookieValue)) return cookieValue
  return choices[0]?.id ?? SINGLETON_BUSINESS_ID
}

export async function resolveAdminTenant(): Promise<ResolvedTenant> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("resolveAdminTenant called without a session")
  const { choices, isOperator } = await allowedSet(session.user.id, session.user.role ?? "")
  const jar = await cookies()
  return { businessId: select(choices, jar.get(BUSINESS_COOKIE)?.value), choices, isOperator }
}

/** The same allowed set, for route handlers, whose cookie source is the request. */
export async function resolveAdminTenantForRequest(req: Request): Promise<ResolvedTenant> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("resolveAdminTenantForRequest called without a session")
  const { choices, isOperator } = await allowedSet(session.user.id, session.user.role ?? "")
  const raw = req.headers.get("cookie") ?? ""
  const match = raw.match(new RegExp(`(?:^|;\\s*)${BUSINESS_COOKIE}=([^;]+)`))
  const cookieValue = match ? decodeURIComponent(match[1]) : undefined
  return { businessId: select(choices, cookieValue), choices, isOperator }
}

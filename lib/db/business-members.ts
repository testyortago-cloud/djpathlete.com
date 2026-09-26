import { createServiceRoleClient } from "@/lib/supabase"

export type BusinessMemberRole = "owner" | "coach" | "staff"

export type BusinessMember = {
  business_id: string
  user_id: string
  role: BusinessMemberRole
  created_at: string
  email: string
  first_name: string
  last_name: string
}

function getClient() {
  return createServiceRoleClient()
}

/**
 * True if `userId` holds a `business_members` row on `businessId`.
 *
 * Written for the `/go/<slug>?preview=1` escalation (whole-branch review item
 * 2): that route resolves its tenant from the request's HOST, not from the
 * viewer's session cookie the way every admin page does, so the session's
 * global `role` alone cannot answer "may THIS caller see THIS tenant's
 * unpublished funnel". A staff member of tenant B is `role: "staff"`
 * regardless of which host they typed, and without this check that role
 * check alone let them read tenant A's draft by visiting A's host directly.
 * `resolveAdminTenant`'s own operator branch (role `"admin"`) is unaffected —
 * an operator has every business in its `choices` already, so it never calls
 * this.
 */
export async function isBusinessMember(businessId: string, userId: string): Promise<boolean> {
  const { data, error } = await getClient()
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`isBusinessMember failed (${error.code}): ${error.message}`)
  return data !== null
}

export async function listBusinessMembers(businessId: string): Promise<BusinessMember[]> {
  const { data, error } = await getClient()
    .from("business_members")
    .select("business_id, user_id, role, created_at, users!inner(email, first_name, last_name)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
  if (error) throw new Error(`listBusinessMembers failed (${error.code}): ${error.message}`)
  type Joined = Omit<BusinessMember, "email" | "first_name" | "last_name"> & {
    users: { email: string; first_name: string; last_name: string }
  }
  return ((data ?? []) as unknown as Joined[]).map((r) => ({
    business_id: r.business_id,
    user_id: r.user_id,
    role: r.role,
    created_at: r.created_at,
    email: r.users.email,
    first_name: r.users.first_name,
    last_name: r.users.last_name,
  }))
}

/**
 * WHO IS TOLD, IN THE ADMIN BELL, THAT A LEAD ARRIVED ON THIS BUSINESS'S SITE:
 * its owners and coaches. The owner's ruling (G35, 2026-09-25), shared by the
 * contact form and the inquiry form so the two cannot drift apart.
 *
 * Staff are left out by that ruling, not by oversight. 00246 made every
 * platform teammate a `staff` member of the platform business, so adding
 * `staff` here would start belling all of them about every contact form.
 *
 * Before G35 both routes belled `users where role = 'admin'`: every platform
 * operator, whichever business's site the lead came from. That is the same
 * cross-tenant broadcast the "New Call Booked" fan-out in
 * lib/bookings/ingest.ts already stopped being.
 */
export const LEAD_ALERT_ROLES = ["owner", "coach"] as const satisfies readonly BusinessMemberRole[]

/**
 * The user ids of `businessId`'s members holding one of `roles`, oldest
 * membership first, then by user id, so two rows sharing a `created_at` still
 * come back in one order. The inquiry route names the FIRST of them as the
 * requester of its lead analysis, which is why the order is fixed rather than
 * whatever Postgres happens to return.
 *
 * THROWS on a failed read, like every reader in this file. A failed read is
 * not "nobody to tell": answering [] would make "this business has no owner"
 * and "the alert was lost to an error" the same silence. The caller decides
 * what a lost alert costs (both lead routes log it and carry on, because the
 * visitor's submission has already succeeded).
 *
 * `roles` is non-empty by type. `.in("role", [])` asks PostgREST for
 * `role=in.()`, and a caller that built its list wrong should fail to compile,
 * not quietly bell nobody.
 */
export async function listBusinessMemberUserIds(
  businessId: string,
  roles: readonly [BusinessMemberRole, ...BusinessMemberRole[]],
): Promise<string[]> {
  const { data, error } = await getClient()
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .in("role", roles)
    .order("created_at", { ascending: true })
    .order("user_id", { ascending: true })
  if (error) throw new Error(`listBusinessMemberUserIds failed (${error.code}): ${error.message}`)
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
}

/**
 * Idempotent by construction. business_members is
 * `primary key (business_id, user_id)`, so two concurrent accepts of the same
 * invite race: read first, and treat a 23505 from the insert as "the other one
 * won". Deliberately NOT `.upsert(..., { onConflict })`, which answers 42P10
 * against a partial unique index -- a trap this repo has already paid for.
 */
export async function addBusinessMember(
  businessId: string,
  userId: string,
  role: BusinessMemberRole,
): Promise<"added" | "already"> {
  const supabase = getClient()
  const { data: existing, error: readError } = await supabase
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()
  // A FAILED READ IS NOT "NO ROW". Falling through to the insert on a failed
  // read turns a real error into a confusing 23505.
  if (readError) throw new Error(`addBusinessMember read failed (${readError.code}): ${readError.message}`)
  if (existing) return "already"

  const { error } = await supabase
    .from("business_members")
    .insert({ business_id: businessId, user_id: userId, role })
    .select()
    .single()
  if (error) {
    if (error.code === "23505") return "already"
    throw new Error(`addBusinessMember failed (${error.code}): ${error.message}`)
  }
  return "added"
}

/** Cheap head-count for the "don't remove the last member" guard in the route. */
export async function countBusinessMembers(businessId: string): Promise<number> {
  const { count, error } = await getClient()
    .from("business_members")
    .select("*", { count: "exact", head: true })
    .eq("business_id", businessId)
  if (error) throw new Error(`countBusinessMembers failed (${error.code}): ${error.message}`)
  return count ?? 0
}

export async function removeBusinessMember(businessId: string, userId: string): Promise<void> {
  const { error } = await getClient()
    .from("business_members")
    .delete()
    .eq("business_id", businessId)
    .eq("user_id", userId)
  if (error) throw new Error(`removeBusinessMember failed (${error.code}): ${error.message}`)
}

/**
 * Fills in the host row's user_id once the coach's login exists.
 *
 * create_business writes a host with a NULL user_id, because the business is
 * created before the coach has an account. This claims EVERY currently
 * unclaimed host row of this business, not just one -- there is no `.limit()`
 * on a PostgREST update. That is correct today because a business has exactly
 * one host; if a business ever gets a second host before its first coach's
 * invite is accepted, this would hand both to the same person. The
 * `.is("user_id", null)` predicate is what stops it from stealing a host that
 * already belongs to someone else.
 */
export async function linkHostToUser(businessId: string, userId: string): Promise<void> {
  const { error } = await getClient()
    .from("booking_hosts")
    .update({ user_id: userId })
    .eq("business_id", businessId)
    .is("user_id", null)
  if (error) throw new Error(`linkHostToUser failed (${error.code}): ${error.message}`)
}

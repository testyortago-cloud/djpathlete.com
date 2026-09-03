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
 * created before the coach has an account. Only the FIRST unclaimed host row
 * is linked, and `.is("user_id", null)` is what stops a second coach's accept
 * from stealing a host that already belongs to someone.
 */
export async function linkHostToUser(businessId: string, userId: string): Promise<void> {
  const { error } = await getClient()
    .from("booking_hosts")
    .update({ user_id: userId })
    .eq("business_id", businessId)
    .is("user_id", null)
  if (error) throw new Error(`linkHostToUser failed (${error.code}): ${error.message}`)
}

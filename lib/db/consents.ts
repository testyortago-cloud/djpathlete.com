import { createServiceRoleClient } from "@/lib/supabase"
import type { UserConsent, ConsentType } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createConsent(consent: {
  user_id: string
  consent_type: ConsentType
  legal_document_id?: string | null
  program_id?: string | null
  ip_address?: string | null
  user_agent?: string | null
  guardian_name?: string | null
  guardian_email?: string | null
}) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("user_consents")
    .insert(consent)
    .select()
    .single()
  if (error) throw error
  return data as UserConsent
}

export async function getUserConsents(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("user_consents")
    .select("*")
    .eq("user_id", userId)
    .order("consented_at", { ascending: false })
  if (error) throw error
  return data as UserConsent[]
}

export async function getActiveConsent(
  userId: string,
  type: ConsentType,
  programId?: string
) {
  const supabase = getClient()
  let query = supabase
    .from("user_consents")
    .select("*")
    .eq("user_id", userId)
    .eq("consent_type", type)
    .is("revoked_at", null)

  if (programId) {
    query = query.eq("program_id", programId)
  }

  const { data, error } = await query.order("consented_at", { ascending: false }).limit(1).single()
  if (error) return null
  return data as UserConsent
}

export async function hasActiveWaiver(userId: string, programId: string) {
  const consent = await getActiveConsent(userId, "liability_waiver", programId)
  return consent !== null
}

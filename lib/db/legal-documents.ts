import { createServiceRoleClient } from "@/lib/supabase"
import type { LegalDocument, LegalDocumentType } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getActiveDocument(type: LegalDocumentType) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("legal_documents")
    .select("*")
    .eq("document_type", type)
    .eq("is_active", true)
    .single()
  if (error) return null
  return data as LegalDocument
}

export async function getDocumentById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("legal_documents").select("*").eq("id", id).single()
  if (error) throw error
  return data as LegalDocument
}

export async function getAllDocuments() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("legal_documents")
    .select("*")
    .order("document_type")
    .order("version", { ascending: false })
  if (error) throw error
  return data as LegalDocument[]
}

export async function createDocument(doc: {
  document_type: LegalDocumentType
  title: string
  content: string
  effective_date: string
}) {
  const supabase = getClient()

  // Get the latest version for this type
  const { data: latest } = await supabase
    .from("legal_documents")
    .select("version")
    .eq("document_type", doc.document_type)
    .order("version", { ascending: false })
    .limit(1)
    .single()

  const nextVersion = (latest?.version ?? 0) + 1

  // Deactivate current active document of this type
  await supabase
    .from("legal_documents")
    .update({ is_active: false })
    .eq("document_type", doc.document_type)
    .eq("is_active", true)

  // Insert new version as active
  const { data, error } = await supabase
    .from("legal_documents")
    .insert({
      ...doc,
      version: nextVersion,
      is_active: true,
    })
    .select()
    .single()

  if (error) throw error
  return data as LegalDocument
}

export async function updateDocument(
  id: string,
  updates: { title?: string; content?: string; effective_date?: string },
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("legal_documents").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as LegalDocument
}

export async function getConsentCountsByDocument() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("user_consents")
    .select("legal_document_id, consent_type")
    .is("revoked_at", null)
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const key = row.legal_document_id ?? row.consent_type
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

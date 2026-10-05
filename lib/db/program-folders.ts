import { createServiceRoleClient } from "@/lib/supabase"
import type { ProgramFolder } from "@/types/database"

/** Service-role client: called only from admin routes and pages, which resolve the tenant first. */
function getClient() {
  return createServiceRoleClient()
}

/** Postgres error code off a raw PostgREST error object (the DALs rethrow it as-is). */
export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined
}

export async function listProgramFolders(businessId: string): Promise<ProgramFolder[]> {
  const { data, error } = await getClient()
    .from("program_folders")
    .select("*")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  if (error) throw error
  return (data ?? []) as ProgramFolder[]
}

export async function getProgramFolder(businessId: string, id: string): Promise<ProgramFolder | null> {
  const { data, error } = await getClient()
    .from("program_folders")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as ProgramFolder | null) ?? null
}

/** Throws a 23505 error when this business already has a folder with that name (case-insensitive). */
export async function createProgramFolder(businessId: string, name: string): Promise<ProgramFolder> {
  const { data, error } = await getClient()
    .from("program_folders")
    .insert({ business_id: businessId, name: name.trim() })
    .select()
    .single()
  if (error) throw error
  return data as ProgramFolder
}

export async function renameProgramFolder(businessId: string, id: string, name: string): Promise<ProgramFolder | null> {
  const { data, error } = await getClient()
    .from("program_folders")
    .update({ name: name.trim() })
    .eq("business_id", businessId)
    .eq("id", id)
    .select()
    .maybeSingle()
  if (error) throw error
  return (data as ProgramFolder | null) ?? null
}

/**
 * False when this business has no such folder. Throws a 23503 error while the
 * folder still holds programs (programs.folder_id is ON DELETE RESTRICT).
 */
export async function deleteProgramFolder(businessId: string, id: string): Promise<boolean> {
  const { data, error } = await getClient()
    .from("program_folders")
    .delete()
    .eq("business_id", businessId)
    .eq("id", id)
    .select("id")
  if (error) throw error
  return (data ?? []).length > 0
}

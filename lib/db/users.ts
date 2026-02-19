import { createServerSupabaseClient } from "@/lib/supabase"
import type { User } from "@/types/database"

export async function getUsers() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as User[]
}

export async function getUserById(id: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .single()
  if (error) throw error
  return data as User
}

export async function getUserByEmail(email: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single()
  if (error) return null
  return data as User
}

export async function createUser(user: {
  email: string
  password_hash: string
  first_name: string
  last_name: string
  role?: string
}) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("users")
    .insert(user)
    .select()
    .single()
  if (error) throw error
  return data as User
}

export async function updateUser(id: string, updates: Partial<User>) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as User
}

export async function getUsersCount() {
  const supabase = await createServerSupabaseClient()
  const { count, error } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
  if (error) throw error
  return count ?? 0
}

export async function getUsersPaginated(
  page: number,
  perPage: number,
  search?: string
) {
  const supabase = await createServerSupabaseClient()
  const from = (page - 1) * perPage
  const to = from + perPage - 1
  let query = supabase
    .from("users")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to)
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`
    )
  }
  const { data, count, error } = await query
  if (error) throw error
  return { users: data as User[], total: count ?? 0 }
}

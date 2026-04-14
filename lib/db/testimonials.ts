import { createServiceRoleClient } from "@/lib/supabase"
import type { Testimonial } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getTestimonials(activeOnly = true) {
  const supabase = getClient()
  let query = supabase.from("testimonials").select("*").order("display_order", { ascending: true })

  if (activeOnly) {
    query = query.eq("is_active", true)
  }

  const { data, error } = await query
  if (error) throw error
  return data as Testimonial[]
}

export async function getFeaturedTestimonials() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("testimonials")
    .select("*")
    .eq("is_active", true)
    .eq("is_featured", true)
    .order("display_order", { ascending: true })

  if (error) throw error
  return data as Testimonial[]
}

export async function getTestimonialById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("testimonials").select("*").eq("id", id).single()

  if (error) throw error
  return data as Testimonial
}

export async function createTestimonial(input: Omit<Testimonial, "id" | "created_at" | "updated_at" | "user_id">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("testimonials").insert(input).select().single()

  if (error) throw error
  return data as Testimonial
}

export async function updateTestimonial(id: string, updates: Partial<Omit<Testimonial, "id" | "created_at">>) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("testimonials")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return data as Testimonial
}

export async function deleteTestimonial(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("testimonials").delete().eq("id", id)

  if (error) throw error
}

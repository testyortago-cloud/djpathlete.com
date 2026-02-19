import { createServerSupabaseClient } from "@/lib/supabase"
import type { Testimonial } from "@/types/database"

export async function getTestimonials(activeOnly = true) {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from("testimonials")
    .select("*")
    .order("display_order", { ascending: true })

  if (activeOnly) {
    query = query.eq("is_active", true)
  }

  const { data, error } = await query
  if (error) throw error
  return data as Testimonial[]
}

export async function getFeaturedTestimonials() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("testimonials")
    .select("*")
    .eq("is_active", true)
    .eq("is_featured", true)
    .order("display_order", { ascending: true })

  if (error) throw error
  return data as Testimonial[]
}

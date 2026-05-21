// lib/db/faqs.ts — DAL for the faqs table (00158). The admin FAQ CMS owns
// writes; ManagedFaqSection reads published rows per page.
import { createServiceRoleClient } from "@/lib/supabase"
import type { Faq } from "@/types/database"
import type { FaqInput } from "@/lib/validators/faq"

export async function listFaqsForPage(
  pageKey: string,
  opts: { publishedOnly?: boolean } = {},
): Promise<Faq[]> {
  const supabase = createServiceRoleClient()
  let q = supabase.from("faqs").select("*").eq("page_key", pageKey)
  if (opts.publishedOnly) q = q.eq("status", "published")
  const { data, error } = await q.order("sort_order", { ascending: true })
  if (error) throw new Error(`listFaqsForPage(${pageKey}): ${error.message}`)
  return (data ?? []) as Faq[]
}

/**
 * FAQ counts keyed by page_key, across every status. One lightweight query —
 * powers the admin page picker so the coach sees which pages already have FAQs.
 */
export async function getFaqCountsByPage(): Promise<Record<string, number>> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.from("faqs").select("page_key")
  if (error) throw new Error(`getFaqCountsByPage: ${error.message}`)
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const key = (row as { page_key: string }).page_key
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

export async function createFaq(input: FaqInput): Promise<Faq> {
  const supabase = createServiceRoleClient()
  // New FAQ goes to the end of its page list.
  const existing = await listFaqsForPage(input.page_key)
  const sort_order = existing.length
  const { data, error } = await supabase
    .from("faqs")
    .insert({ ...input, sort_order })
    .select("*")
    .single()
  if (error) throw new Error(`createFaq: ${error.message}`)
  return data as Faq
}

export async function updateFaq(id: string, input: FaqInput): Promise<Faq> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("faqs")
    .update(input)
    .eq("id", id)
    .select("*")
    .single()
  if (error) throw new Error(`updateFaq(${id}): ${error.message}`)
  return data as Faq
}

export async function deleteFaq(id: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from("faqs").delete().eq("id", id)
  if (error) throw new Error(`deleteFaq(${id}): ${error.message}`)
}

/** Persist a new ordering. `orderedIds` is the full id list for one page. */
export async function reorderFaqs(orderedIds: string[]): Promise<void> {
  const supabase = createServiceRoleClient()
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("faqs").update({ sort_order: index }).eq("id", id),
    ),
  )
}

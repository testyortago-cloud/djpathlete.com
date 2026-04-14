import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export async function addSubscriber(email: string, source = "website"): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("newsletter_subscribers")
    .upsert({ email: email.toLowerCase().trim(), source, unsubscribed_at: null }, { onConflict: "email" })
  if (error) throw error
}

export async function removeSubscriber(email: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("newsletter_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("email", email.toLowerCase().trim())
  if (error) throw error
}

export async function getActiveSubscribers(): Promise<{ email: string }[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .select("email")
    .is("unsubscribed_at", null)
    .order("subscribed_at", { ascending: true })
  if (error) throw error
  return data ?? []
}

export interface Subscriber {
  id: string
  email: string
  source: string
  subscribed_at: string
  unsubscribed_at: string | null
}

export async function getAllSubscribers(): Promise<Subscriber[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .select("id, email, source, subscribed_at, unsubscribed_at")
    .order("subscribed_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as Subscriber[]
}

export async function importSubscribers(
  emails: string[],
  source = "csv_import",
): Promise<{ added: number; skipped: number }> {
  const supabase = getClient()
  let added = 0
  let skipped = 0

  // Batch upsert — onConflict re-activates unsubscribed emails
  const rows = emails.map((email) => ({
    email: email.toLowerCase().trim(),
    source,
    unsubscribed_at: null,
  }))

  // Upsert in batches of 100
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    const { data, error } = await supabase
      .from("newsletter_subscribers")
      .upsert(batch, { onConflict: "email", count: "exact" })
      .select("id")
    if (error) throw error
    added += data?.length ?? 0
  }

  skipped = emails.length - added
  return { added, skipped }
}

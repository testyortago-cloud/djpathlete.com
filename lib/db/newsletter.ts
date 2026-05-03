import { createServiceRoleClient } from "@/lib/supabase"
import { getUnclaimedAttribution, claimAttribution } from "@/lib/db/marketing-attribution"
import { setMarketingConsent } from "@/lib/db/marketing-consent"

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
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
}

export async function getAllSubscribers(): Promise<Subscriber[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .select("id, email, source, subscribed_at, unsubscribed_at, gclid, gbraid, wbraid, fbclid")
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

export interface AddSubscriberWithAttributionInput {
  email: string
  session_id: string | undefined
  consent_marketing: boolean
  ip_address: string | null
  user_agent: string | null
}

export interface AddSubscriberWithAttributionResult {
  subscriber_id: string
}

/**
 * Add a newsletter subscriber and back-fill gclid + tracking params from the
 * caller's djp_attr cookie session. If the session has an unclaimed attribution
 * row we copy gclid/gbraid/wbraid/fbclid onto the subscriber row.
 *
 * Consent is recorded in the marketing_consent_log only if the subscriber has
 * a corresponding users row (i.e., is also a registered user). Anonymous
 * subscribers track consent via the consent_marketing boolean only — they
 * promote to a fully-logged consent state when they create an account.
 */
export async function addSubscriberWithAttribution(
  input: AddSubscriberWithAttributionInput,
): Promise<AddSubscriberWithAttributionResult> {
  const supabase = getClient()
  const email = input.email.toLowerCase().trim()

  let attribution = null
  if (input.session_id) {
    attribution = await getUnclaimedAttribution(input.session_id).catch(() => null)
  }

  const { data: subscriber, error } = await supabase
    .from("newsletter_subscribers")
    .upsert(
      {
        email,
        source: "website",
        unsubscribed_at: null,
        gclid: attribution?.gclid ?? null,
        gbraid: attribution?.gbraid ?? null,
        wbraid: attribution?.wbraid ?? null,
        fbclid: attribution?.fbclid ?? null,
      },
      { onConflict: "email" },
    )
    .select("id")
    .single()
  if (error) throw error
  const subscriberId = (subscriber as { id: string }).id

  // If this subscriber is also a registered user, log consent + claim attribution.
  const { data: userRow } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle()

  if (userRow) {
    if (input.consent_marketing) {
      await setMarketingConsent({
        user_id: (userRow as { id: string }).id,
        granted: true,
        source: "newsletter_signup",
        ip_address: input.ip_address,
        user_agent: input.user_agent,
      }).catch((e) => console.warn("[newsletter] consent log failed:", (e as Error).message))
    }
    if (attribution && !attribution.claimed_at) {
      await claimAttribution(attribution.id, (userRow as { id: string }).id).catch((e) =>
        console.warn("[newsletter] attribution claim failed:", (e as Error).message),
      )
    }
  }

  return { subscriber_id: subscriberId }
}

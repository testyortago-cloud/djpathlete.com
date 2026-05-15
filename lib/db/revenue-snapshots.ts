// lib/db/revenue-snapshots.ts
// DAL for revenue_snapshots + the source queries the weekly digest needs.
// All sources are DB-only (per the Phase 2 reconcile note) — no Stripe API.

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  normalizeMonthlyCents,
  type RevenueInputs,
  type RevenueOutput,
} from "@/lib/automation/revenue-aggregator"

const SEVEN_DAYS_MS = 7 * 86_400_000

interface SubscriptionRow {
  id: string
  user_id: string | null
  stripe_subscription_id: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  programs: { price_cents: number | null; billing_interval: string | null } | null
  users: { email: string | null } | null
}

interface PaymentRow {
  id: string
  user_id: string | null
  amount_cents: number
  created_at: string
  users: { email: string | null } | null
}

/** Pull every input the aggregator needs in a single helper. */
export async function fetchRevenueInputs(supabase: SupabaseClient): Promise<RevenueInputs> {
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()

  // 1) Active-ish subscriptions (status mirrors Stripe; we treat
  //    active/trialing/past_due as MRR-contributing).
  const { data: subsRaw, error: subErr } = await supabase
    .from("subscriptions")
    .select(
      "id, user_id, stripe_subscription_id, current_period_end, cancel_at_period_end, programs:program_id (price_cents, billing_interval), users:user_id (email)",
    )
    .in("status", ["active", "trialing", "past_due"])
  if (subErr) throw new Error(`fetchRevenueInputs.subs: ${subErr.message}`)

  const active_subscriptions = (subsRaw ?? [])
    .map((row) => {
      const r = row as unknown as SubscriptionRow
      const price = r.programs?.price_cents ?? 0
      const interval = r.programs?.billing_interval ?? null
      const monthly_cents = normalizeMonthlyCents(price, interval)
      const email = r.users?.email ?? ""
      const renewal = r.current_period_end ?? new Date(Date.now() + 30 * 86_400_000).toISOString()
      return {
        id: r.id,
        customer_id: r.user_id ?? "",
        customer_email: email,
        monthly_cents,
        current_period_end: renewal,
        cancel_at_period_end: r.cancel_at_period_end,
      }
    })
    // Drop rows we can't price (e.g., missing program or one-time charges).
    .filter((s) => s.monthly_cents > 0)

  // 2) Failed payments in the last 7 days.
  const { data: failedRaw, error: failedErr } = await supabase
    .from("payments")
    .select("id, user_id, amount_cents, created_at, users:user_id (email)")
    .eq("status", "failed")
    .gte("created_at", sevenDaysAgo)
  if (failedErr) throw new Error(`fetchRevenueInputs.failed: ${failedErr.message}`)

  const failed_payments_last_7d = (failedRaw ?? []).map((row) => {
    const r = row as unknown as PaymentRow
    return {
      id: r.id,
      customer_email: r.users?.email ?? "",
      amount_cents: r.amount_cents,
      created_at: r.created_at,
    }
  })

  // 3) New customers in last 7d (subscription created).
  const { count: newCountRaw } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sevenDaysAgo)

  // 4) Churned customers in last 7d (canceled_at within window).
  const { count: churnedCountRaw } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .gte("canceled_at", sevenDaysAgo)

  // 5) Previous MRR — most recent prior snapshot.
  const { data: prevSnap } = await supabase
    .from("revenue_snapshots")
    .select("mrr_cents")
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle()
  const previous_mrr_cents = (prevSnap?.mrr_cents as number | undefined) ?? 0

  return {
    active_subscriptions,
    failed_payments_last_7d,
    previous_mrr_cents,
    new_customers_7d: newCountRaw ?? 0,
    churned_customers_7d: churnedCountRaw ?? 0,
  }
}

/** Compute Monday of the week containing the given date (UTC). */
export function isoMondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun, 1=Mon ... 6=Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

export interface SnapshotInsert {
  week_of: string
  raw?: Record<string, unknown>
}

export async function insertSnapshot(
  supabase: SupabaseClient,
  insert: SnapshotInsert & RevenueOutput,
): Promise<void> {
  const { error } = await supabase
    .from("revenue_snapshots")
    .upsert(
      {
        week_of: insert.week_of,
        mrr_cents: insert.mrr_cents,
        mrr_delta_cents: insert.mrr_delta_cents,
        new_customers: insert.new_customers,
        churned_customers: insert.churned_customers,
        failed_payments_7d: insert.failed_payments_7d,
        failed_payment_value_cents: insert.failed_payment_value_cents,
        upcoming_renewals_14d: insert.upcoming_renewals_14d,
        upcoming_renewals_value_cents: insert.upcoming_renewals_value_cents,
        top_at_risk_subscriptions: insert.top_at_risk_subscriptions,
        raw: insert.raw ?? {},
      },
      { onConflict: "week_of" },
    )
  if (error) throw new Error(`insertSnapshot: ${error.message}`)
}

export interface RevenueSnapshotRow extends RevenueOutput {
  id: string
  week_of: string
  generated_at: string
  raw: Record<string, unknown>
}

export async function listRecentSnapshots(
  supabase: SupabaseClient,
  weeks = 12,
): Promise<RevenueSnapshotRow[]> {
  const { data, error } = await supabase
    .from("revenue_snapshots")
    .select("*")
    .order("week_of", { ascending: false })
    .limit(weeks)
  if (error) throw new Error(`listRecentSnapshots: ${error.message}`)
  return (data ?? []) as RevenueSnapshotRow[]
}

export async function latestSnapshot(
  supabase: SupabaseClient,
): Promise<RevenueSnapshotRow | null> {
  const { data } = await supabase
    .from("revenue_snapshots")
    .select("*")
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as RevenueSnapshotRow | null) ?? null
}

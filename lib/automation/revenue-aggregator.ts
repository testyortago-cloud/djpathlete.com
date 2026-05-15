// Pure aggregator that turns raw subscription + payment inputs into the
// shape that revenue_snapshots wants. No DB, no network — trivially unit
// tested. Used by the weekly revenue digest cron.

export type BillingInterval = "week" | "month" | "year" | string | null

export interface RevenueInputs {
  active_subscriptions: Array<{
    id: string
    customer_id: string
    customer_email: string
    monthly_cents: number       // already normalized by caller via normalizeMonthlyCents
    current_period_end: string  // ISO
    cancel_at_period_end: boolean
  }>
  failed_payments_last_7d: Array<{
    id: string
    customer_email: string
    amount_cents: number
    created_at: string
  }>
  previous_mrr_cents: number
  new_customers_7d: number
  churned_customers_7d: number
}

export interface AtRiskRow {
  subscription_id: string
  customer_email: string
  mrr_cents: number
  renewal_at: string
  reason: "cancel_at_period_end" | "failed_payment"
}

export interface RevenueOutput {
  mrr_cents: number
  mrr_delta_cents: number
  new_customers: number
  churned_customers: number
  failed_payments_7d: number
  failed_payment_value_cents: number
  upcoming_renewals_14d: number
  upcoming_renewals_value_cents: number
  top_at_risk_subscriptions: AtRiskRow[]
}

const FOURTEEN_DAYS_MS = 14 * 86_400_000
const AT_RISK_CAP = 5
const WEEK_TO_MONTH_FACTOR = 4.33

/**
 * Normalize a billing-interval-anchored price to its monthly equivalent (cents).
 * Anything that isn't a recurring monthly/weekly/yearly price returns 0 — those
 * are one-time charges and don't contribute to MRR.
 */
export function normalizeMonthlyCents(price_cents: number, interval: BillingInterval): number {
  if (price_cents <= 0) return 0
  switch (interval) {
    case "month":
      return price_cents
    case "year":
      return Math.round(price_cents / 12)
    case "week":
      return Math.round(price_cents * WEEK_TO_MONTH_FACTOR)
    default:
      return 0
  }
}

export function aggregateRevenue(input: RevenueInputs): RevenueOutput {
  const mrr_cents = input.active_subscriptions.reduce((sum, s) => sum + s.monthly_cents, 0)
  const failed_emails = new Set(input.failed_payments_last_7d.map((p) => p.customer_email))
  const renewalCutoff = Date.now() + FOURTEEN_DAYS_MS

  const upcoming = input.active_subscriptions.filter(
    (s) => new Date(s.current_period_end).getTime() <= renewalCutoff,
  )

  const at_risk_unranked = input.active_subscriptions
    .map((s): AtRiskRow | null => {
      let reason: AtRiskRow["reason"] | null = null
      if (s.cancel_at_period_end) reason = "cancel_at_period_end"
      else if (failed_emails.has(s.customer_email)) reason = "failed_payment"
      if (!reason) return null
      return {
        subscription_id: s.id,
        customer_email: s.customer_email,
        mrr_cents: s.monthly_cents,
        renewal_at: s.current_period_end,
        reason,
      }
    })
    .filter((row): row is AtRiskRow => row !== null)

  const top_at_risk_subscriptions = at_risk_unranked
    .sort((a, b) => b.mrr_cents - a.mrr_cents)
    .slice(0, AT_RISK_CAP)

  return {
    mrr_cents,
    mrr_delta_cents: mrr_cents - input.previous_mrr_cents,
    new_customers: input.new_customers_7d,
    churned_customers: input.churned_customers_7d,
    failed_payments_7d: input.failed_payments_last_7d.length,
    failed_payment_value_cents: input.failed_payments_last_7d.reduce(
      (sum, p) => sum + p.amount_cents,
      0,
    ),
    upcoming_renewals_14d: upcoming.length,
    upcoming_renewals_value_cents: upcoming.reduce((sum, s) => sum + s.monthly_cents, 0),
    top_at_risk_subscriptions,
  }
}

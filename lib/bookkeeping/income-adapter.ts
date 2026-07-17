// lib/bookkeeping/income-adapter.ts
// Pure: unions the platform's money-of-record tables into reviewable ledger
// drafts. Zero IO — the caller reads rows (paginated) and passes plain arrays.
// Encodes the design's D3 rules: gross amounts, refund-aware, honest about the
// membership gap. Every draft carries a stable source_ref so re-running the
// import never double-posts (the ledger's UNIQUE(book_id,source,source_ref)).

import type { IncomeSourceRows, IncomeAdapterResult, LedgerEntryDraft } from "./types"

const SHOP_REVENUE_STATUSES = new Set([
  "paid", "draft", "confirmed", "in_production", "shipped", "fulfilled_digital",
])
const MEMBERSHIP_ACTIVE = new Set(["active", "trialing", "past_due"])

/** YYYY-MM-DD from an ISO timestamp. */
function isoDate(ts: string): string {
  return ts.slice(0, 10)
}

/** Best-effort service-line tag for a raw Stripe payment. */
function paymentServiceLine(description: string | null, metadata: Record<string, unknown>): string {
  const d = (description ?? "").toLowerCase()
  if (metadata.type === "session_fee") return "other"
  if (metadata.source === "external") return "other"
  if (d.includes("program") || d.includes("week")) return "performance_training"
  return "other"
}

export function buildIncomeDrafts(input: IncomeSourceRows): IncomeAdapterResult {
  const drafts: LedgerEntryDraft[] = []
  const warnings: string[] = []

  for (const p of input.payments) {
    if (p.status === "refunded") {
      warnings.push(`Payment ${p.id} is refunded — skipped (gross income reversed).`)
      continue
    }
    if (p.status !== "succeeded") continue
    // Stripe-paid session packs and event signups write a `payments` row
    // (revenue mirror) IN ADDITION TO their own client_packages / event_signups
    // row. Those source tables carry the product/event name + correct service
    // line, so we count them there and skip the mirror here — otherwise a single
    // Stripe pack/camp sale posts TWICE (the payments source_ref differs from the
    // pack/event source_ref, so the ledger UNIQUE cannot dedupe it). Cash/offline
    // packs never create a payments row, so they are unaffected.
    const mirrorType = p.metadata?.type
    if (mirrorType === "session_pack" || mirrorType === "event_signup") continue
    const email = typeof p.metadata?.customerEmail === "string" ? p.metadata.customerEmail : null
    if (!p.user_id && !email) {
      warnings.push(`Payment ${p.id} has no user and no customer email — counterparty unknown.`)
    }
    drafts.push({
      direction: "income",
      amount_cents: p.amount_cents,
      occurred_on: isoDate(p.created_at),
      memo: p.description ?? "Platform payment",
      counterparty: email ?? p.description ?? null,
      service_line: paymentServiceLine(p.description, p.metadata ?? {}),
      source: "platform_import",
      source_ref: `payments:${p.id}`,
    })
  }

  for (const o of input.shopOrders) {
    if (!SHOP_REVENUE_STATUSES.has(o.status)) continue
    drafts.push({
      direction: "income",
      amount_cents: o.total_cents,
      occurred_on: isoDate(o.created_at),
      memo: `Shop order ${o.order_number}`,
      counterparty: o.customer_name,
      service_line: "shop",
      source: "platform_import",
      source_ref: `shop_orders:${o.id}`,
    })
  }

  for (const pk of input.clientPackages) {
    if (pk.payment_status !== "paid") continue
    drafts.push({
      direction: "income",
      amount_cents: pk.price_cents,
      occurred_on: isoDate(pk.purchased_at),
      memo: pk.product_name ?? pk.session_type ?? "Session pack",
      counterparty: null,
      service_line: "session_packs",
      source: "platform_import",
      source_ref: `client_packages:${pk.id}`,
    })
  }

  for (const s of input.eventSignups) {
    if (s.signup_type !== "paid" || s.status !== "confirmed" || s.amount_paid_cents == null) continue
    drafts.push({
      direction: "income",
      amount_cents: s.amount_paid_cents,
      occurred_on: isoDate(s.created_at),
      memo: s.event_title ?? "Event signup",
      counterparty: s.parent_name ?? null,
      service_line: "camps",
      source: "platform_import",
      source_ref: `event_signups:${s.id}`,
    })
  }

  for (const m of input.memberships) {
    if (!MEMBERSHIP_ACTIVE.has(m.status)) continue
    warnings.push(
      `Membership ${m.id} recurring revenue is not recorded in the database ` +
      `(lives in Stripe invoices) — import via statement/payout ingestion (Phase 6).`,
    )
  }

  drafts.sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : 0))
  return { drafts, warnings }
}

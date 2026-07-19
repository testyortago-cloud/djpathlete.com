// lib/bookkeeping/income-adapter.ts
// Pure: unions the platform's money-of-record tables into reviewable ledger
// drafts. Zero IO. Encodes the design's D3 rules (gross amounts, refund-aware,
// honest membership gap) plus two 2026-07-19 upgrades: maximally-detailed
// memos/counterparties (program + athlete + pack product), and the
// orphaned-mirror fallback — a pack/event mirror payment whose source row was
// deleted is counted from the payment itself instead of silently dropped
// (real $340 undercount found in prod-cloned data). Every draft carries a
// stable source_ref so re-running the import never double-posts.

import type { IncomeSourceRows, IncomeAdapterResult, LedgerEntryDraft } from "./types"

const SHOP_REVENUE_STATUSES = new Set([
  "paid", "draft", "confirmed", "in_production", "shipped", "fulfilled_digital",
])
const MEMBERSHIP_ACTIVE = new Set(["active", "trialing", "past_due"])
const ORPHAN_PAIR_WINDOW_DAYS = 7

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

type EnrichedPayment = IncomeSourceRows["payments"][number]

function paymentMemo(p: EnrichedPayment, meta: Record<string, unknown>): string {
  if (p.program_name) {
    const week = meta.weekNumber
    return week != null && week !== ""
      ? `${p.program_name} — week ${week} access`
      : `${p.program_name} — program purchase`
  }
  if (meta.type === "session_fee") return "Session fee"
  return p.description ?? "Platform payment"
}

function paymentCounterparty(p: EnrichedPayment, meta: Record<string, unknown>): string | null {
  const email = typeof meta.customerEmail === "string" ? meta.customerEmail : null
  return p.payer_name ?? email ?? p.payer_email ?? p.description ?? null
}

/** Mutable pairing candidate for the orphaned-mirror check. */
interface MirrorCandidate {
  amount_cents: number
  occurred_on: string
  consumed: boolean
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000))
}

/** Greedy one-to-one pairing: equal cents, ≤7 days; smallest diff wins,
 *  tie → earliest candidate date. Returns true when a candidate was consumed. */
function consumeCandidate(candidates: MirrorCandidate[], amountCents: number, date: string): boolean {
  let best = -1
  let bestDiff = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (c.consumed || c.amount_cents !== amountCents) continue
    const diff = dayDiff(c.occurred_on, date)
    if (diff > ORPHAN_PAIR_WINDOW_DAYS) continue
    if (diff < bestDiff || (diff === bestDiff && best >= 0 && c.occurred_on < candidates[best].occurred_on)) {
      best = i
      bestDiff = diff
    }
  }
  if (best < 0) return false
  candidates[best].consumed = true
  return true
}

export function buildIncomeDrafts(input: IncomeSourceRows, window?: { from: string; to: string }): IncomeAdapterResult {
  const drafts: LedgerEntryDraft[] = []
  const warnings: string[] = []

  // Source tables FIRST — they are both the richer record and the pairing
  // candidates the mirror check consumes.
  const packCandidates: MirrorCandidate[] = []
  for (const pk of input.clientPackages) {
    if (pk.payment_status !== "paid") continue
    const occurred = isoDate(pk.purchased_at)
    packCandidates.push({ amount_cents: pk.price_cents, occurred_on: occurred, consumed: false })
    const base = pk.product_name ?? pk.session_type ?? "Session pack"
    drafts.push({
      direction: "income",
      amount_cents: pk.price_cents,
      occurred_on: occurred,
      memo: pk.credits_total != null ? `${base} (${pk.credits_total} sessions)` : base,
      counterparty: pk.client_name ?? null,
      service_line: "session_packs",
      source: "platform_import",
      source_ref: `client_packages:${pk.id}`,
    })
  }

  const signupCandidates: MirrorCandidate[] = []
  for (const s of input.eventSignups) {
    if (s.signup_type !== "paid" || s.status !== "confirmed" || s.amount_paid_cents == null) continue
    const occurred = isoDate(s.created_at)
    signupCandidates.push({ amount_cents: s.amount_paid_cents, occurred_on: occurred, consumed: false })
    drafts.push({
      direction: "income",
      amount_cents: s.amount_paid_cents,
      occurred_on: occurred,
      memo: `${s.event_title ?? "Event"} — signup`,
      counterparty: s.parent_name ?? null,
      service_line: "camps",
      source: "platform_import",
      source_ref: `event_signups:${s.id}`,
    })
  }

  let orphanPacks = 0
  let orphanSignups = 0
  for (const p of input.payments) {
    if (p.status === "refunded") {
      warnings.push(`Payment ${p.id} is refunded — skipped (gross income reversed).`)
      continue
    }
    if (p.status !== "succeeded") continue
    const meta = (p.metadata ?? {}) as Record<string, unknown>
    const mirrorType = meta.type
    if (mirrorType === "session_pack" || mirrorType === "event_signup") {
      // Mirror row: normally the source table carries this sale — but when the
      // pack/signup row was deleted, dropping the mirror silently undercounts
      // revenue. Pair one-to-one; unpaired mirrors post from the payment.
      const paired =
        mirrorType === "session_pack"
          ? consumeCandidate(packCandidates, p.amount_cents, isoDate(p.created_at))
          : consumeCandidate(signupCandidates, p.amount_cents, isoDate(p.created_at))
      if (paired) continue
      if (mirrorType === "session_pack") orphanPacks++
      else orphanSignups++
      drafts.push({
        direction: "income",
        amount_cents: p.amount_cents,
        occurred_on: isoDate(p.created_at),
        memo: mirrorType === "session_pack" ? "Session pack (record deleted)" : "Camp/event signup (record deleted)",
        counterparty: paymentCounterparty(p, meta),
        service_line: mirrorType === "session_pack" ? "session_packs" : "camps",
        source: "platform_import",
        source_ref: `payments:${p.id}`,
      })
      continue
    }
    if (!p.user_id && typeof meta.customerEmail !== "string") {
      warnings.push(`Payment ${p.id} has no user and no customer email — counterparty unknown.`)
    }
    drafts.push({
      direction: "income",
      amount_cents: p.amount_cents,
      occurred_on: isoDate(p.created_at),
      memo: paymentMemo(p, meta),
      counterparty: paymentCounterparty(p, meta),
      service_line: paymentServiceLine(p.description, meta),
      source: "platform_import",
      source_ref: `payments:${p.id}`,
    })
  }

  if (orphanPacks > 0) {
    warnings.push(`${orphanPacks} session-pack payment(s) counted directly — the pack records no longer exist.`)
  }
  if (orphanSignups > 0) {
    warnings.push(`${orphanSignups} event-signup payment(s) counted directly — the signup records no longer exist.`)
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

  const activeInWindow = input.memberships.filter((m) => MEMBERSHIP_ACTIVE.has(m.status))
  if (activeInWindow.length > 0) {
    const w = window ? ` during ${window.from}…${window.to}` : ""
    warnings.push(
      `${activeInWindow.length} membership(s) were active${w}, but recurring membership revenue is not in the database ` +
      `(it lives in Stripe invoices) — import it via statement/payout ingestion (Phase 6).`,
    )
  }

  drafts.sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : 0))
  return { drafts, warnings }
}

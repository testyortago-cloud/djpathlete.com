// lib/bookkeeping/income-adapter.ts
// Pure: unions the platform's money-of-record tables into reviewable ledger
// drafts. Zero IO. Encodes the design's D3 rules (gross amounts, refund-aware,
// honest membership gap) plus two 2026-07-19 upgrades: maximally-detailed
// memos/counterparties (program + athlete + pack product), and the
// orphaned-mirror fallback — a pack/event mirror payment whose source row was
// deleted is counted from the payment itself instead of silently dropped
// (real $340 undercount found in prod-cloned data). Every draft carries a
// stable source_ref so re-running the import never double-posts.
//
// Final-review upgrade (2026-07-20): id-first pairing. Every mirror payment
// has carried the exact source id in metadata (client_package_id / event_
// signup_id) since the mirrors' introducing commits — the amount±7day
// heuristic below is a legacy fallback for mirrors written before that (or
// missing the id for any other reason). id-based pairing ignores amount and
// date entirely (a promo-code/price-edit divergence still pairs), and stamps
// `alt_ref` on both sides of a pairing so a re-import after the OTHER side's
// deletion can be recognized as the same sale by the DAL's cross-run dedupe
// instead of double-posting.

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

/** service_line for the non-mirror payments draft: a program-linked payment
 *  (e.g. a "Subscription renewal" description) always prefills Performance
 *  Training, even when the description text alone wouldn't match. */
function nonMirrorServiceLine(p: EnrichedPayment, meta: Record<string, unknown>): string {
  return p.program_name ? "performance_training" : paymentServiceLine(p.description, meta)
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

/** Mutable pairing candidate for the orphaned-mirror check. `sourceId` (the
 *  client_packages/event_signups row id) drives id-first pairing;
 *  `heuristicEligible` gates the legacy amount±7day fallback only —
 *  id-based pairing (step b in buildIncomeDrafts) ignores it entirely. */
interface MirrorCandidate {
  sourceId: string
  amount_cents: number
  occurred_on: string
  consumed: boolean
  heuristicEligible: boolean
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000))
}

/** Greedy one-to-one pairing: equal cents, ≤7 days; smallest diff wins,
 *  tie → earliest candidate date. Only considers unconsumed, heuristic-
 *  eligible candidates (id-less legacy mirrors only — id-based pairing in
 *  buildIncomeDrafts never calls this). Returns true when a candidate was
 *  consumed. */
function consumeCandidate(candidates: MirrorCandidate[], amountCents: number, date: string): boolean {
  let best = -1
  let bestDiff = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (c.consumed || !c.heuristicEligible || c.amount_cents !== amountCents) continue
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
  // candidates the mirror check consumes. draftIndexBySourceRef lets the
  // mirror loop below stamp `alt_ref` back onto the already-emitted
  // source-table draft when an id-based pairing succeeds.
  const draftIndexBySourceRef = new Map<string, number>()

  const packCandidates: MirrorCandidate[] = []
  for (const pk of input.clientPackages) {
    if (pk.payment_status !== "paid") continue
    const occurred = isoDate(pk.purchased_at)
    // Every paid pack is an id-pairing candidate (a mirror's client_package_id
    // can reference it regardless of payment method). heuristicEligible stays
    // Stripe-only: cash/offline packs never wrote a mirror payment, so letting
    // them absorb an id-LESS orphaned mirror via the amount/date heuristic
    // would silently drop that mirror's revenue.
    const heuristicEligible = pk.stripe_session_id != null || pk.stripe_payment_id != null
    packCandidates.push({ sourceId: pk.id, amount_cents: pk.price_cents, occurred_on: occurred, consumed: false, heuristicEligible })
    const base = pk.product_name ?? pk.session_type ?? "Session pack"
    const source_ref = `client_packages:${pk.id}`
    drafts.push({
      direction: "income",
      amount_cents: pk.price_cents,
      occurred_on: occurred,
      memo: pk.credits_total != null ? `${base} (${pk.credits_total} sessions)` : base,
      counterparty: pk.client_name ?? null,
      service_line: "session_packs",
      source: "platform_import",
      source_ref,
      alt_ref: null,
    })
    draftIndexBySourceRef.set(source_ref, drafts.length - 1)
  }

  const signupCandidates: MirrorCandidate[] = []
  for (const s of input.eventSignups) {
    if (s.signup_type !== "paid" || s.status !== "confirmed" || s.amount_paid_cents == null) continue
    const occurred = isoDate(s.created_at)
    signupCandidates.push({ sourceId: s.id, amount_cents: s.amount_paid_cents, occurred_on: occurred, consumed: false, heuristicEligible: true })
    const source_ref = `event_signups:${s.id}`
    drafts.push({
      direction: "income",
      amount_cents: s.amount_paid_cents,
      occurred_on: occurred,
      memo: `${s.event_title ?? "Event"} — signup`,
      counterparty: s.parent_name ?? null,
      service_line: "camps",
      source: "platform_import",
      source_ref,
      alt_ref: null,
    })
    draftIndexBySourceRef.set(source_ref, drafts.length - 1)
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
      // revenue. Prefer id-based pairing (exact — ignores amount/date, so a
      // promo-code/price-edit divergence still pairs); fall back to the
      // legacy amount±7day heuristic only when the mirror carries no id.
      const isPack = mirrorType === "session_pack"
      const candidates = isPack ? packCandidates : signupCandidates
      const sourceRefPrefix = isPack ? "client_packages" : "event_signups"
      const srcId =
        typeof meta.client_package_id === "string" ? meta.client_package_id
        : typeof meta.event_signup_id === "string" ? meta.event_signup_id
        : null

      if (srcId != null) {
        const candidate = candidates.find((c) => c.sourceId === srcId)
        if (candidate) {
          // id pairing ignores amount/date — mark consumed regardless of the
          // heuristic-eligibility flag (that flag only gates the id-LESS path).
          candidate.consumed = true
          const sourceRef = `${sourceRefPrefix}:${srcId}`
          const idx = draftIndexBySourceRef.get(sourceRef)
          if (idx != null) drafts[idx].alt_ref = `payments:${p.id}`
          continue
        }
        // Orphan WITH an id: the source row was deleted after the mirror was
        // written. alt_ref points at the (now-gone) source ref so a re-import
        // after the source row somehow reappears — or after this exact orphan
        // draft was already posted under a prior form — never double-posts.
        if (isPack) orphanPacks++
        else orphanSignups++
        drafts.push({
          direction: "income",
          amount_cents: p.amount_cents,
          occurred_on: isoDate(p.created_at),
          memo: isPack ? "Session pack (record deleted)" : "Camp/event signup (record deleted)",
          counterparty: paymentCounterparty(p, meta),
          service_line: isPack ? "session_packs" : "camps",
          source: "platform_import",
          source_ref: `payments:${p.id}`,
          alt_ref: `${sourceRefPrefix}:${srcId}`,
        })
        continue
      }

      // Legacy id-less mirror: amount±7day heuristic over unconsumed,
      // heuristic-eligible candidates only.
      const paired = consumeCandidate(candidates, p.amount_cents, isoDate(p.created_at))
      if (paired) continue
      if (isPack) orphanPacks++
      else orphanSignups++
      drafts.push({
        direction: "income",
        amount_cents: p.amount_cents,
        occurred_on: isoDate(p.created_at),
        memo: isPack ? "Session pack (record deleted)" : "Camp/event signup (record deleted)",
        counterparty: paymentCounterparty(p, meta),
        service_line: isPack ? "session_packs" : "camps",
        source: "platform_import",
        source_ref: `payments:${p.id}`,
        alt_ref: null,
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
      service_line: nonMirrorServiceLine(p, meta),
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

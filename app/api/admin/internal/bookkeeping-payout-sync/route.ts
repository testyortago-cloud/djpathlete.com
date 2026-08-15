// Called by functions bookkeepingPayoutSyncCron (daily 05:15 UTC). READS the
// Stripe API (payouts + per-payout balance transactions) into the
// bookkeeping_payouts mirror — never the webhook, never payments, never any
// ledger table (reconcile-by-read only). Idempotent: merge upserts on plain
// UNIQUE stripe_payout_id / stripe_balance_txn_id, so status flips land.
// SINGLE cron_runs owner under "bookkeepingPayoutSyncCron" — functions/ must not log.
import { NextRequest, NextResponse } from "next/server"
import type Stripe from "stripe"
import { stripe } from "@/lib/stripe"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import {
  listBooks, latestPayoutArrivalDate, listNonTerminalPayouts, upsertPayouts, upsertPayoutLines,
} from "@/lib/db/bookkeeping"
import { computePayoutSyncWindow } from "@/lib/bookkeeping/payout-sync-window"
import { recordAudit } from "@/lib/audit/record"
import type { BookkeepingPayoutStatus, NewBookkeepingPayout, NewBookkeepingPayoutLine } from "@/types/database"

export const runtime = "nodejs"
export const maxDuration = 300

const WARNINGS_CAP = 20
// Backlog discipline: per-run cap on payout line-fetches; oldest-first, so a
// capped cold start resumes exactly where it stopped (watermark = stored
// max(arrival_date)). more_pending surfaces the remainder in detail.
const MAX_PAYOUTS_PER_RUN = 200
const PAYOUT_STATUSES: readonly string[] = ["in_transit", "paid", "failed", "canceled", "pending"]

function epochToIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}

/**
 * Stripe REJECTS a per-payout balance-transaction filter for a manual payout —
 * "Balance transaction history can only be filtered on automatic transfers, not
 * manual." It does not return an empty list, which is what this route was
 * written to expect, and what its test mocked.
 *
 * Matched narrowly on purpose. A blanket catch around that call would turn a
 * Stripe outage into a run full of payouts stored with zero fees, each looking
 * exactly like one we had successfully inspected.
 */
function isManualPayoutFilterError(e: unknown): boolean {
  const err = e as { type?: string; rawType?: string; message?: string }
  const invalidRequest =
    err?.type === "StripeInvalidRequestError" || err?.rawType === "invalid_request_error"
  const message = err?.message ?? ""
  return invalidRequest && /automatic/i.test(message) && /manual/i.test(message)
}

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_bookkeeping_payout_sync_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingPayoutSyncCron")
  try {
    const books = await listBooks()
    const book = books.find((b) => b.is_primary && b.book_kind === "business")
    if (!book) throw new Error("No primary business book found")

    const today = new Date().toISOString().slice(0, 10)
    // A pending/in_transit payout's arrival_date is Stripe's ESTIMATED FUTURE
    // date, so max(arrival_date) can sit ahead of today; clamping keeps the
    // full 14-day overlap instead of silently shortening (or collapsing) it.
    const watermark = await latestPayoutArrivalDate(book.id)
    const syncWindow = computePayoutSyncWindow(watermark && watermark > today ? today : watermark, today)

    const listed: Stripe.Payout[] = await stripe.payouts
      .list({
        limit: 100,
        ...(syncWindow.fromEpochSeconds != null ? { arrival_date: { gte: syncWindow.fromEpochSeconds } } : {}),
      })
      .autoPagingToArray({ limit: 10000 })

    // Eligibility arm (the income-sync watermark lesson — key on eligibility,
    // not creation time): re-pull every stored non-terminal payout by id, so
    // an in_transit→paid or paid→failed flip can never strand outside the
    // arrival-date window.
    const warnings: string[] = []
    const listedIds = new Set(listed.map((p) => p.id))
    const nonTerminal = await listNonTerminalPayouts(book.id)
    for (const stored of nonTerminal) {
      if (listedIds.has(stored.stripe_payout_id)) continue
      try {
        const fresh = await stripe.payouts.retrieve(stored.stripe_payout_id)
        listed.push(fresh)
        listedIds.add(fresh.id)
      } catch (e) {
        // One unresolvable stored id (key rotation, account change, a row from
        // a historical backfill) must NOT wedge the cron: nothing ever updates
        // that row's status, so a throw here would fail every run forever.
        warnings.push(`payout ${stored.stripe_payout_id}: retrieve failed — ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    listed.sort((a, b) => a.arrival_date - b.arrival_date) // oldest-first
    const morePending = listed.length > MAX_PAYOUTS_PER_RUN
    const batch = listed.slice(0, MAX_PAYOUTS_PER_RUN)

    let upserted = 0
    let upsertedLines = 0
    let unreconciled = 0
    let skippedCurrency = 0
    const bookCurrency = (book.currency ?? "usd").toLowerCase()
    for (const p of batch) {
      // amount_cents is a bare integer of the payout's own MINOR UNITS. A CAD or
      // JPY payout summed into a USD book would add unconverted minor units to
      // the fee total (and JPY has no cents at all). No FX rate lives in this
      // system, so the only correct move is to skip and say so — before spending
      // a Stripe call on lines we would have to throw away anyway.
      if (p.currency.toLowerCase() !== bookCurrency) {
        skippedCurrency += 1
        warnings.push(`payout ${p.id}: currency ${p.currency} ≠ book currency ${bookCurrency} — skipped (no FX conversion in this system)`)
        continue
      }
      // Stripe enumerates constituent balance transactions for AUTOMATIC
      // payouts only. `payout.automatic` is the documented, structured signal
      // for that ("false if it's requested manually"), so a manual payout is
      // never asked about — cheaper than provoking a rejection and far more
      // robust than parsing one. The catch is only a backstop for a payload
      // without the field; it must stay narrow (see isManualPayoutFilterError).
      let txns: Stripe.BalanceTransaction[] = []
      let linesUnavailable = p.automatic === false
      if (!linesUnavailable) {
        try {
          txns = await stripe.balanceTransactions
            .list({ payout: p.id, limit: 100 })
            .autoPagingToArray({ limit: 10000 })
        } catch (e) {
          if (!isManualPayoutFilterError(e)) throw e
          linesUnavailable = true
        }
      }
      // Landmine: the payout's own type:"payout" balance txn appears in this
      // listing — it is the transfer itself, not a constituent line.
      const lines = txns.filter((t) => t.type !== "payout")
      const gross = lines.reduce((s, t) => s + t.amount, 0)
      const fee = lines.reduce((s, t) => s + t.fee, 0)
      // The gross−fee−net reconciliation identity, now PERSISTED (00194) rather
      // than only whispered into cron_runs.detail. A MANUAL payout ("Pay out
      // now") can never be broken down — Stripe refuses the query — so its real
      // fees never enter the mirror. Storing that as fees_reconciled false is
      // what lets the report layer say "fees incomplete for N of M payouts"
      // instead of printing a clean — and false — net number.
      const delta = gross - fee - p.amount
      if (delta !== 0) {
        unreconciled += 1
        warnings.push(
          linesUnavailable
            ? `payout ${p.id}: manual payout — Stripe breaks down automatic payouts only, so fees are unknown for net ${p.amount}`
            : lines.length === 0
              ? `payout ${p.id}: no constituent balance transactions (Stripe enumerates them for automatic payouts only) — fees unknown for net ${p.amount}`
              : `payout ${p.id}: gross ${gross} − fee ${fee} = ${gross - fee} ≠ payout net ${p.amount}`,
        )
      }
      const status: BookkeepingPayoutStatus = PAYOUT_STATUSES.includes(p.status)
        ? (p.status as BookkeepingPayoutStatus)
        : "pending"
      const payoutRow: NewBookkeepingPayout = {
        stripe_payout_id: p.id, book_id: book.id, amount_cents: p.amount,
        gross_cents: gross, fee_cents: fee,
        arrival_date: epochToIsoDate(p.arrival_date), status,
        currency: p.currency,
        fees_reconciled: delta === 0, reconcile_delta_cents: delta,
        raw: p as unknown as Record<string, unknown>,
      }
      // Write ONE payout with its own lines before moving on. A two-phase batch
      // write (all payouts, then all lines) would commit the payout rows —
      // which ARE the watermark — while losing the whole batch's fee lines if
      // the line write failed; those payouts are then terminal + stored, so
      // neither the arrival-date window nor the eligibility arm ever re-lists
      // them and the fees are gone for good. Oldest-first + per-payout means a
      // mid-run failure leaves a consistent prefix, and the failing payout's
      // own arrival_date becomes the watermark, so the 14-day overlap re-lists
      // it on the next run. It also keeps a balance txn shared by two payouts
      // (failed payout re-paid on a replacement) in SEPARATE upsert calls —
      // one statement can only touch a conflict key once (Postgres 21000) —
      // with the newer payout writing last, which is the correct attribution.
      const [stored] = await upsertPayouts([payoutRow])
      if (!stored) {
        warnings.push(`payout ${p.id}: upsert returned no row — ${lines.length} line(s) dropped`)
        continue
      }
      upserted += 1
      const lineRows: NewBookkeepingPayoutLine[] = lines.map((t) => ({
        payout_id: stored.id,
        stripe_balance_txn_id: t.id, type: t.type, amount_cents: t.amount,
        fee_cents: t.fee, net_cents: t.net, txn_date: epochToIsoDate(t.created),
        description: t.description ?? null,
        source_ref: typeof t.source === "string" ? t.source : (t.source?.id ?? null),
      }))
      upsertedLines += await upsertPayoutLines(lineRows)
    }

    const detail = {
      upserted, upserted_lines: upsertedLines,
      unreconciled, skipped_currency: skippedCurrency,
      listed: listed.length, more_pending: morePending,
      window_from: syncWindow.fromDate, window_to: syncWindow.to,
      // The cap keeps one bad night from writing a megabyte into cron_runs, but a
      // silent truncation understates the blast radius to the watchdog reading it.
      warnings: warnings.slice(0, WARNINGS_CAP),
      warnings_total: warnings.length,
      warnings_truncated: warnings.length > WARNINGS_CAP,
    }
    if (upserted > 0) {
      void recordAudit({
        action: "bookkeeping.payout_synced",
        category: "commerce",
        outcome: "success",
        actor: { id: null, email: "bookkeepingPayoutSyncCron", role: "system" },
        target: { type: "bookkeeping_book", id: book.id },
        metadata: detail,
      })
    }
    await logCronEnd(supabase, runId, "success", detail)
    return NextResponse.json({ ok: true, ...detail })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-payout-sync] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

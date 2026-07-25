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
    const watermark = await latestPayoutArrivalDate(book.id)
    const syncWindow = computePayoutSyncWindow(watermark, today)

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
      const fresh = await stripe.payouts.retrieve(stored.stripe_payout_id)
      listed.push(fresh)
      listedIds.add(fresh.id)
    }

    listed.sort((a, b) => a.arrival_date - b.arrival_date) // oldest-first
    const morePending = listed.length > MAX_PAYOUTS_PER_RUN
    const batch = listed.slice(0, MAX_PAYOUTS_PER_RUN)

    const payoutRows: NewBookkeepingPayout[] = []
    const lineRowsByPayout = new Map<string, Array<Omit<NewBookkeepingPayoutLine, "payout_id">>>()
    for (const p of batch) {
      const txns: Stripe.BalanceTransaction[] = await stripe.balanceTransactions
        .list({ payout: p.id, limit: 100 })
        .autoPagingToArray({ limit: 10000 })
      // Landmine: the payout's own type:"payout" balance txn appears in this
      // listing — it is the transfer itself, not a constituent line.
      const lines = txns.filter((t) => t.type !== "payout")
      const gross = lines.reduce((s, t) => s + t.amount, 0)
      const fee = lines.reduce((s, t) => s + t.fee, 0)
      if (gross - fee !== p.amount) {
        // The gross−fee−net reconciliation trace — warn, never fail the run.
        warnings.push(`payout ${p.id}: gross ${gross} − fee ${fee} = ${gross - fee} ≠ payout net ${p.amount}`)
      }
      const status: BookkeepingPayoutStatus = PAYOUT_STATUSES.includes(p.status)
        ? (p.status as BookkeepingPayoutStatus)
        : "pending"
      payoutRows.push({
        stripe_payout_id: p.id, book_id: book.id, amount_cents: p.amount,
        gross_cents: gross, fee_cents: fee,
        arrival_date: epochToIsoDate(p.arrival_date), status,
        currency: p.currency, raw: p as unknown as Record<string, unknown>,
      })
      lineRowsByPayout.set(p.id, lines.map((t) => ({
        stripe_balance_txn_id: t.id, type: t.type, amount_cents: t.amount,
        fee_cents: t.fee, net_cents: t.net, txn_date: epochToIsoDate(t.created),
        description: t.description ?? null,
        source_ref: typeof t.source === "string" ? t.source : (t.source?.id ?? null),
      })))
    }

    const upserted = await upsertPayouts(payoutRows)
    const idByStripeId = new Map(upserted.map((r) => [r.stripe_payout_id, r.id]))
    const lineRows: NewBookkeepingPayoutLine[] = []
    for (const [stripePayoutId, rows] of lineRowsByPayout) {
      const payoutId = idByStripeId.get(stripePayoutId)
      if (!payoutId) continue
      for (const r of rows) lineRows.push({ ...r, payout_id: payoutId })
    }
    const upsertedLines = await upsertPayoutLines(lineRows)

    const detail = {
      upserted: upserted.length, upserted_lines: upsertedLines,
      listed: listed.length, more_pending: morePending,
      window_from: syncWindow.fromDate, window_to: syncWindow.to,
      warnings: warnings.slice(0, WARNINGS_CAP),
    }
    if (upserted.length > 0) {
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

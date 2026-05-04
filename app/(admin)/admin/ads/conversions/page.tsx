import Link from "next/link"
import { listConversionActions } from "@/lib/db/google-ads-conversion-actions"
import {
  getConversionUploadStatusCounts,
  listRecentConversionUploads,
} from "@/lib/db/google-ads-conversion-uploads"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { ConversionActionForm } from "./ConversionActionForm"
import type {
  GoogleAdsConversionAction,
  GoogleAdsConversionTrigger,
} from "@/types/database"

export const metadata = { title: "Google Ads — Conversions" }
export const dynamic = "force-dynamic"

const STATUS_TONE: Record<string, string> = {
  uploaded: "bg-success/10 text-success",
  pending: "bg-accent/10 text-accent",
  failed: "bg-error/10 text-error",
  skipped: "bg-muted/40 text-muted-foreground",
}

const TYPE_LABEL: Record<string, string> = {
  click: "Click",
  adjustment: "Adjust",
}

function fmtCurrency(micros: number, currency: string): string {
  if (micros === 0) return "—"
  return `$${(micros / 1_000_000).toFixed(2)} ${currency}`
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export default async function ConversionsPage() {
  const [actions, accounts, uploads, counts] = await Promise.all([
    listConversionActions(),
    listGoogleAdsAccounts(),
    listRecentConversionUploads(50),
    getConversionUploadStatusCounts(),
  ])

  const customerIds = accounts.filter((a) => a.is_active).map((a) => a.customer_id)
  const byTrigger = {
    booking_created: actions.find((a) => a.trigger_type === "booking_created"),
    payment_succeeded: actions.find((a) => a.trigger_type === "payment_succeeded"),
  } as Record<GoogleAdsConversionTrigger, GoogleAdsConversionAction | undefined>

  const tokenSet = Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Conversions</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Booking webhooks enqueue offline click conversions; Stripe payment success enqueues a
          RESTATE adjustment that lifts the conversion value to actual revenue. The worker drains
          the queue every 15 minutes — Smart Bidding learns true LTV instead of a placeholder.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CountTile label="Pending" value={counts.pending} tone="bg-accent/10 text-accent" />
        <CountTile label="Uploaded" value={counts.uploaded} tone="bg-success/10 text-success" />
        <CountTile label="Failed" value={counts.failed} tone="bg-error/10 text-error" />
        <CountTile label="Skipped" value={counts.skipped} tone="bg-muted/40 text-muted-foreground" />
      </div>

      {!tokenSet && counts.pending > 0 ? (
        <div className="border border-warning/40 bg-warning/5 text-warning rounded-lg p-4 text-sm">
          <p className="font-medium">{counts.pending} pending uploads waiting on Developer Token.</p>
          <p className="text-xs mt-1 opacity-90">
            Set <code className="font-mono">GOOGLE_ADS_DEVELOPER_TOKEN</code> in env (locally + Vercel) and
            as a Firebase Secret. The worker will drain the queue on its next pass (every 15 min).
          </p>
        </div>
      ) : null}

      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ Conversion actions
        </h2>
        <ConversionActionForm customerIds={customerIds} existingByTrigger={byTrigger} />
      </section>

      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ Recent uploads
        </h2>
        {uploads.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-6 bg-card text-center text-sm text-muted-foreground">
            No conversions uploaded yet. Once a booking with a gclid lands and a conversion action
            is configured, rows show up here. Stripe payments add value adjustments after the
            click conversion is uploaded.
          </div>
        ) : (
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-3 w-20">When</th>
                  <th className="text-left p-3 w-20">Type</th>
                  <th className="text-left p-3 w-24">Status</th>
                  <th className="text-left p-3 w-24">Value</th>
                  <th className="text-left p-3">Source</th>
                  <th className="text-left p-3 w-16">Tries</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id} className="border-t border-border/60 align-top">
                    <td
                      className="p-3 font-mono text-xs text-muted-foreground"
                      title={new Date(u.created_at).toLocaleString()}
                    >
                      {relativeTime(u.created_at)}
                    </td>
                    <td className="p-3 text-xs font-mono">
                      {TYPE_LABEL[u.upload_type] ?? u.upload_type}
                      {u.adjustment_type ? ` (${u.adjustment_type})` : ""}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_TONE[u.status] ?? "bg-muted/40 text-muted-foreground"}`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {fmtCurrency(u.value_micros, u.currency)}
                    </td>
                    <td className="p-3 text-xs">
                      <span className="font-mono">{u.source_table}</span>{" "}
                      <span className="font-mono text-muted-foreground">
                        {u.source_id.slice(0, 8)}…
                      </span>
                      {u.error_message ? (
                        <p className="text-error text-[11px] mt-1 leading-snug">
                          {u.error_message.slice(0, 200)}
                        </p>
                      ) : null}
                    </td>
                    <td className="p-3 font-mono text-xs">{u.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Worker drains pending rows every 15 minutes via the{" "}
        <code className="font-mono">processGoogleAdsConversions</code> Cloud Function. Manual
        retry isn't wired in this UI yet — failed rows retry automatically up to 5 attempts. View
        the audit trail in <Link href="/admin/ads/automation-log" className="underline hover:text-accent">automation log</Link>.
      </p>
    </div>
  )
}

function CountTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-2xl font-heading mt-1">{value.toLocaleString()}</p>
    </div>
  )
}

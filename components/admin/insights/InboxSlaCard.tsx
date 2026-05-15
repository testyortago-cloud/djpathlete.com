"use client"

import type { InboxSlaSnapshot } from "@/lib/db/inbox-sla"

interface Props {
  latest: InboxSlaSnapshot | null
  history: InboxSlaSnapshot[]
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function InboxSlaCard({ latest, history }: Props) {
  if (!latest) {
    return (
      <p className="text-sm text-muted-foreground">
        No snapshots yet. <code>inboxSlaCron</code> runs Mon–Fri at 06:00 UTC. Trigger manually:{" "}
        <code>POST /api/admin/internal/inbox-sla</code>.
      </p>
    )
  }

  const degraded = latest.fetch_status !== "ok"
  const responseHours = latest.mean_response_minutes_7d
    ? Math.round((latest.mean_response_minutes_7d / 60) * 10) / 10
    : null

  return (
    <div className="space-y-6">
      {degraded && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          GHL fetch status: <strong>{latest.fetch_status}</strong>. Numbers below may be empty —
          check GHL_API_KEY / GHL_LOCATION_ID.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Counter label="Unread" value={String(latest.unread_count)} />
        <Counter
          label="Awaiting > 24h"
          value={String(latest.awaiting_reply_over_24h)}
          warn={latest.awaiting_reply_over_24h > 0}
        />
        <Counter
          label="Awaiting > 48h"
          value={String(latest.awaiting_reply_over_48h)}
          warn={latest.awaiting_reply_over_48h > 0}
        />
        <Counter
          label="Mean response 7d"
          value={responseHours === null ? "—" : `${responseHours}h`}
          warn={responseHours !== null && responseHours > 24}
        />
      </div>

      {latest.oldest_unanswered.length > 0 && (
        <div>
          <h2 className="mb-2 font-heading text-sm uppercase tracking-wider text-muted-foreground">
            Oldest unanswered
          </h2>
          <ul className="space-y-2 text-sm">
            {latest.oldest_unanswered.map((c) => (
              <li key={c.conversation_id} className="rounded border border-border p-3">
                <p className="font-medium">{c.contact_name}</p>
                <p className="text-xs text-muted-foreground">
                  Waiting {Math.round(c.hours_waiting)}h since {fmtTime(c.last_inbound_at)}
                </p>
                {c.snippet && <p className="mt-1 text-sm italic text-muted-foreground">"{c.snippet}"</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 1 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            14-day history ({history.length} snapshots)
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {history.map((s) => (
              <li key={s.id}>
                {fmtTime(s.snapshot_at)} · unread {s.unread_count} · &gt;24h{" "}
                {s.awaiting_reply_over_24h} · status {s.fetch_status}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Counter({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-heading text-base ${warn ? "text-red-700" : "text-primary"}`}>{value}</p>
    </div>
  )
}

"use client"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ClientEngagementSnapshot, RiskTier } from "@/types/database"

export interface ClientRiskTableRow extends ClientEngagementSnapshot {
  client_name: string
  client_email: string
}

const TIER_STYLES: Record<RiskTier, string> = {
  high: "bg-red-100 text-red-900 border-red-300",
  medium: "bg-amber-100 text-amber-900 border-amber-300",
  low: "bg-blue-100 text-blue-900 border-blue-300",
  none: "bg-emerald-100 text-emerald-900 border-emerald-300",
}

const REASON_LABELS: Record<string, string> = {
  no_session_7d: "no session 7d+",
  no_session_14d: "no session 14d+",
  no_session_30d: "no session 30d+",
  frequency_lt_50: "freq <50%",
  frequency_lt_25: "freq <25%",
  form_review_stale_5d: "form review 5d+",
  form_review_stale_10d: "form review 10d+",
  perf_assessment_stale_10d: "perf assess 10d+",
  renewal_unstarted: "renewal unstarted",
}

function labelReason(code: string): string {
  return REASON_LABELS[code] ?? code
}

function pct(value: number | null): string {
  if (value === null) return "—"
  return `${Math.round(value)}%`
}

function days(value: number | null): string {
  if (value === null) return "—"
  return `${value}d`
}

export function ClientRiskTable({ rows }: { rows: ClientRiskTableRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No snapshot rows yet. Wait for the next clientRiskScanCron (05:00 UTC) or trigger the
        route manually: <code>POST /api/admin/internal/client-risk-scan</code>.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Client</TableHead>
          <TableHead>Tier</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead>Reasons</TableHead>
          <TableHead className="text-right">Last session</TableHead>
          <TableHead className="text-right">Freq 14d</TableHead>
          <TableHead className="text-right">Open review</TableHead>
          <TableHead className="text-right">Ends in</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <div className="font-medium">{row.client_name}</div>
              <div className="text-xs text-muted-foreground">{row.client_email}</div>
            </TableCell>
            <TableCell>
              <Badge variant="outline" className={TIER_STYLES[row.risk_tier]}>
                {row.risk_tier}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-mono">{row.risk_score}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {row.reasons.map((code) => (
                  <span
                    key={code}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs"
                  >
                    {labelReason(code)}
                  </span>
                ))}
              </div>
            </TableCell>
            <TableCell className="text-right">{days(row.days_since_last_session)}</TableCell>
            <TableCell className="text-right">{pct(row.session_frequency_pct_14d)}</TableCell>
            <TableCell className="text-right">{days(row.open_form_review_days)}</TableCell>
            <TableCell className="text-right">{days(row.program_ending_in_days)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

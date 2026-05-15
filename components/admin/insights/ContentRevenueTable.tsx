"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AttributionRow } from "@/lib/db/content-attribution"

interface Props {
  rows: AttributionRow[]
}

function fmtMoney(cents: number): string {
  const d = cents / 100
  if (Math.abs(d) >= 1_000) return `$${(d / 1_000).toFixed(1)}K`
  return `$${d.toFixed(2)}`
}

export function ContentRevenueTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No attribution snapshots yet. The cron runs Sunday 22:00 UTC. Trigger manually:{" "}
        <code>POST /api/admin/internal/content-attribution</code>.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Post</TableHead>
          <TableHead>Week</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="text-right">Clicks</TableHead>
          <TableHead className="text-right">Impressions</TableHead>
          <TableHead className="text-right">Sessions</TableHead>
          <TableHead className="text-right">$/click</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const clicks = Math.max(row.gsc_clicks_7d, 1)
          const rpc = row.revenue_attributed_cents / clicks
          return (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">{row.blog_posts?.title ?? "(missing)"}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  /blog/{row.blog_posts?.slug ?? "?"}
                </div>
              </TableCell>
              <TableCell className="text-xs font-mono">{row.week_of}</TableCell>
              <TableCell className="text-right font-mono font-semibold">
                {fmtMoney(row.revenue_attributed_cents)}
              </TableCell>
              <TableCell className="text-right">{row.gsc_clicks_7d}</TableCell>
              <TableCell className="text-right">{row.gsc_impressions_7d}</TableCell>
              <TableCell className="text-right">{row.sessions_from_post_7d}</TableCell>
              <TableCell className="text-right font-mono">{fmtMoney(Math.round(rpc))}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

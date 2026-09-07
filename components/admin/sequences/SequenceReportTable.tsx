import Link from "next/link"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
import type { SequenceReportRow } from "@/lib/db/sequence-reporting"

const STATUS_TONE: Record<string, DataTableBadgeTone> = {
  active: "success",
  paused: "warning",
  draft: "neutral",
  archived: "neutral",
}

const STATUS_LABEL: Record<string, string> = {
  active: "On",
  paused: "Paused",
  draft: "Not started",
  archived: "Archived",
}

/**
 * Why nobody has entered this sequence — in words a non-programmer can act on.
 *
 * A page of zeros reads as broken. On production today eight of the nine
 * sequences have never run, and for two of them the reason is simply that they
 * are paused — which is a thirty-second fix if you can see it, and invisible if
 * you cannot.
 */
function whyEmpty(row: SequenceReportRow): string {
  if (row.status === "paused") return "Paused, so nobody new is being added."
  if (row.status === "draft") return "Not switched on yet."
  if (row.status === "archived") return "Archived."
  if (!row.trigger_source) return "Nobody yet — people are only added to this one by hand."
  if (row.trigger_source === "funnel_form") return "Nobody yet — waiting on a funnel form."
  if (row.trigger_source === "quiz") return "Nobody yet — waiting on a quiz result."
  if (row.trigger_source === "newsletter") return "Nobody yet — waiting on a newsletter sign-up."
  if (row.trigger_source === "lead_magnet") return "Nobody yet — waiting on a download."
  return "Nobody has entered this one yet."
}

export function SequenceReportTable({ rows }: { rows: SequenceReportRow[] }) {
  return (
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Sequence</DataTableHead>
          <DataTableHead align="right">Entered</DataTableHead>
          <DataTableHead align="right">Still going</DataTableHead>
          <DataTableHead align="right">Bought</DataTableHead>
          <DataTableHead align="right">Booked a call</DataTableHead>
          <DataTableHead align="right">Opted out</DataTableHead>
          <DataTableHead align="right">Reached the end</DataTableHead>
          <DataTableHead align="right">Didn&apos;t send</DataTableHead>
        </DataTableHeader>
        <tbody>
          {rows.length === 0 ? (
            <DataTableEmpty colSpan={8}>No sequences have been set up yet.</DataTableEmpty>
          ) : (
            rows.map((row) => (
              <DataTableRow key={row.id}>
                <DataTableCell>
                  <Link href={`/admin/sequences/${row.key}`} className="font-medium text-primary hover:underline">
                    {row.name}
                  </Link>
                  <div className="mt-1 flex items-center gap-2">
                    <DataTableBadge tone={STATUS_TONE[row.status] ?? "neutral"}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </DataTableBadge>
                    {row.entered === 0 ? <span className="text-xs text-muted-foreground">{whyEmpty(row)}</span> : null}
                  </div>
                </DataTableCell>
                <DataTableCell align="right" className="font-medium">
                  {row.entered}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.in_progress === 0}>
                  {row.buckets.in_progress}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.bought === 0}>
                  {row.buckets.bought}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.booked === 0}>
                  {row.buckets.booked}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.opted_out === 0}>
                  {row.buckets.opted_out}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.finished === 0}>
                  {row.buckets.finished}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.failed === 0}>
                  {row.buckets.failed}
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}

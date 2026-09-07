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
import type { OutcomeBucket, SequenceRunRowForReport } from "@/lib/db/sequence-reporting"

const BUCKET_TONE: Record<OutcomeBucket, DataTableBadgeTone> = {
  in_progress: "info",
  bought: "success",
  booked: "success",
  opted_out: "warning",
  finished: "neutral",
  failed: "danger",
  other: "neutral",
}

const BUCKET_LABEL: Record<OutcomeBucket, string> = {
  in_progress: "Still going",
  bought: "Bought",
  booked: "Booked a call",
  opted_out: "Opted out",
  finished: "Reached the end",
  failed: "Something went wrong",
  other: "Something else",
}

/**
 * The three ways of saying "stop contacting me", separated again.
 *
 * The list page collapses them into one column. Here they stay apart, because
 * they are three different things: they clicked the link in an email, they
 * replied STOP to a text, or they were already on the do-not-contact list
 * before we reached them — which is not a decision they made about THIS
 * sequence at all.
 */
function exitDetail(run: SequenceRunRowForReport): string | null {
  switch (run.exitReason) {
    case "unsubscribed":
      return "Clicked unsubscribe in an email"
    case "sms_stop":
      return "Replied STOP to a text"
    case "suppressed":
      return "Was already on your do-not-contact list"
    case "payment":
      return "Bought something"
    case "booking":
      return "Booked a call"
    case null:
      return null
    default:
      return run.exitReason
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function SequenceRunsTable({ runs }: { runs: SequenceRunRowForReport[] }) {
  return (
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Person</DataTableHead>
          <DataTableHead>Entered</DataTableHead>
          <DataTableHead>What happened</DataTableHead>
          <DataTableHead>Left on</DataTableHead>
        </DataTableHeader>
        <tbody>
          {runs.length === 0 ? (
            <DataTableEmpty colSpan={4}>Nobody has entered this sequence yet.</DataTableEmpty>
          ) : (
            runs.map((run) => {
              const detail = exitDetail(run)
              return (
                <DataTableRow key={run.id}>
                  <DataTableCell>
                    <Link href={`/admin/contacts/${run.contactId}`} className="text-primary hover:underline">
                      {run.contactName ?? run.contactEmail ?? "Someone with no name on file"}
                    </Link>
                    {run.contactName && run.contactEmail ? (
                      <div className="text-xs text-muted-foreground">{run.contactEmail}</div>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell muted>{formatDate(run.enteredAt)}</DataTableCell>
                  <DataTableCell>
                    <DataTableBadge tone={BUCKET_TONE[run.bucket]}>{BUCKET_LABEL[run.bucket]}</DataTableBadge>
                    {/* Only render the detail line when it ADDS information. "booking"
                        and "payment" map to a detail string identical to their bucket
                        label ("Booked a call", "Bought"), so showing both would say the
                        same thing twice under one person's row. The opt-out reasons
                        (unsubscribed / sms_stop / suppressed) all collapse to one badge
                        ("Opted out") but stay three different detail strings, so those
                        keep rendering. */}
                    {detail && detail !== BUCKET_LABEL[run.bucket] ? (
                      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell muted>{formatDate(run.completedAt)}</DataTableCell>
                </DataTableRow>
              )
            })
          )}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}

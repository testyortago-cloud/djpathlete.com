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
import { exitReasonSentence } from "@/lib/lead-engine/sequence-exit-reasons"

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
 * Why nothing was sent to this person.
 *
 * The database records one reason per failure and this shows it as written. No
 * attempt is made to tidy it up: it is the only answer there is, and a coach can
 * do something about "the darrenjpaul.com domain is not verified" and nothing at
 * all about a blank space.
 */
function failureNote(run: SequenceRunRowForReport): string {
  if (!run.lastError) return "Nothing was sent, and no reason was recorded."
  return `Nothing was sent. The reason recorded was: "${run.lastError}"`
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
              // The reason -> sentence mapping is shared with
              // components/admin/contacts/ContactDetail.tsx, which shows the
              // exact same run from the contact's side — see
              // lib/lead-engine/sequence-exit-reasons.ts's header for why that
              // sharing exists and what every known reason maps to.
              const detail = exitReasonSentence(run.exitReason)
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
                    {/* A failure has no exit reason at all — a failure is not an exit —
                        so it needs its own line. Without it "Something went wrong" is
                        the whole of what the screen can tell you, and that reads as a
                        fault in the report rather than in the sending. */}
                    {run.bucket === "failed" ? (
                      <div className="mt-1 text-xs text-muted-foreground">{failureNote(run)}</div>
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
